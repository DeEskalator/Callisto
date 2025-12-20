import type { Logger } from '@aws-lambda-powertools/logger';
import type { AuditStore, ConfigStore, PracticeConfig, SlotStore, UserStore } from '@callisto/data';
import {
  type AnnouncementPreset,
  AnnouncementPresetInputSchema,
  type AppointmentCategory,
  AppointmentCategoryInputSchema,
  addDays,
  bookedSlotsInClosedTimes,
  type Closure,
  ClosureInputSchema,
  eachDate,
  fromZoned,
  LocalDateSchema,
  ManualSlotInputSchema,
  MINUTES_PER_DAY,
  minutesOf,
  newId,
  OpeningHoursSchema,
  openingStateAt,
  PracticeSettingsSchema,
  type Slot,
  type SlotTemplate,
  SlotTemplateInputSchema,
  slotId,
  timeOf,
  toZoned,
} from '@callisto/domain';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { auditor, corsFor, errorHandler, notFoundHandler } from '../lib/app';
import { authenticate, requirePermission } from '../lib/auth';
import {
  ApiError,
  type AppEnv,
  conflict,
  notFound,
  unprocessable,
  validateJson,
  validateQuery,
} from '../lib/http';
import { reconcileSlots } from '../scheduling/reconcile';

export interface AdminDeps {
  config: ConfigStore;
  users: UserStore;
  slots: SlotStore;
  audit: AuditStore;
  allowedOrigins: string[];
  logger: Logger;
}

/** Longest period the calendar can request at once. */
const MAX_SLOT_RANGE_DAYS = 62;

function assertPresetExists(practice: PracticeConfig, presetId: string | undefined): void {
  if (presetId && !practice.presets.some((preset) => preset.id === presetId)) {
    throw unprocessable('Das ausgewählte Ansage-Preset existiert nicht');
  }
}

function categoryOf(practice: PracticeConfig, categoryId: string): AppointmentCategory {
  const category = practice.categories.find((candidate) => candidate.id === categoryId);
  if (!category) {
    throw unprocessable('Die ausgewählte Kategorie existiert nicht');
  }
  return category;
}

/**
 * Everything the practice plans with: settings, opening hours, closures, announcement presets,
 * appointment categories, slot templates and the slots derived from them. Reading is open to
 * every signed-in user of the practice.
 */
export function createAdminApp(deps: AdminDeps) {
  const { config, slots } = deps;
  const record = auditor(deps.audit);

  const practiceIdOf = (c: Context<AppEnv>) => c.get('user').profile.practiceId;

  const loadPractice = async (c: Context<AppEnv>): Promise<PracticeConfig> => {
    const practice = await config.load(practiceIdOf(c));
    if (!practice) {
      throw new ApiError(500, 'practice_missing', 'Die Praxis ist noch nicht eingerichtet');
    }
    return practice;
  };

  /** Re-derives the slots after a change to anything they depend on. */
  const syncSlots = async (c: Context<AppEnv>) => {
    const changes = await reconcileSlots(await loadPractice(c), slots);
    deps.logger.info('Slots reconciled', { ...changes });
    return changes;
  };

  const loadSlot = async (c: Context<AppEnv>, id: string): Promise<Slot> => {
    const slot = await slots.get(practiceIdOf(c), id);
    if (!slot) {
      throw notFound('Der Termin-Slot');
    }
    return slot;
  };

  const app = new Hono<AppEnv>()
    .basePath('/v1')
    .use(corsFor(deps.allowedOrigins))
    .use(authenticate(deps))

    .get('/config', async (c) => {
      const { roles: _roles, ...practice } = await loadPractice(c);
      return c.json(practice);
    })

    .get('/status', async (c) => {
      const practice = await loadPractice(c);
      return c.json({
        practiceName: practice.settings.name,
        ...openingStateAt(new Date(), practice),
      });
    })

    // ── Einstellungen und Sprechzeiten ───────────────────────────────────────

    .put(
      '/settings',
      requirePermission('settings.manage'),
      validateJson(PracticeSettingsSchema),
      async (c) => {
        const settings = c.req.valid('json');
        const practice = await loadPractice(c);
        for (const presetId of Object.values(settings.presetAssignments)) {
          assertPresetExists(practice, presetId);
        }
        await config.putSettings(practice.practiceId, settings);
        await record(c, 'settings.updated', 'Praxiseinstellungen geändert');
        // The booking horizon and the federal state (public holidays) shape the slots.
        await syncSlots(c);
        return c.json(settings);
      },
    )

    .put(
      '/opening-hours',
      requirePermission('settings.manage'),
      validateJson(OpeningHoursSchema),
      async (c) => {
        const hours = c.req.valid('json');
        await config.putHours(practiceIdOf(c), hours);
        await record(c, 'hours.updated', 'Sprechzeiten geändert');
        return c.json(hours);
      },
    )

    // ── Urlaub und Schließzeiten ─────────────────────────────────────────────

    .post(
      '/closures',
      requirePermission('settings.manage'),
      validateJson(ClosureInputSchema),
      async (c) => {
        const practice = await loadPractice(c);
        const closure: Closure = { id: newId(), ...c.req.valid('json') };
        assertPresetExists(practice, closure.presetId);
        await config.putItem(practice.practiceId, 'closures', closure);
        await record(c, 'closure.created', `Schließzeit „${closure.title}“ angelegt`, closure.id);
        await syncSlots(c);
        return c.json(closure, 201);
      },
    )

    .put(
      '/closures/:id',
      requirePermission('settings.manage'),
      validateJson(ClosureInputSchema),
      async (c) => {
        const practice = await loadPractice(c);
        const closure: Closure = { id: c.req.param('id'), ...c.req.valid('json') };
        if (!practice.closures.some((existing) => existing.id === closure.id)) {
          throw notFound('Die Schließzeit');
        }
        assertPresetExists(practice, closure.presetId);
        await config.putItem(practice.practiceId, 'closures', closure);
        await record(c, 'closure.updated', `Schließzeit „${closure.title}“ geändert`, closure.id);
        await syncSlots(c);
        return c.json(closure);
      },
    )

    .delete('/closures/:id', requirePermission('settings.manage'), async (c) => {
      const practice = await loadPractice(c);
      const closure = practice.closures.find((existing) => existing.id === c.req.param('id'));
      if (!closure) {
        throw notFound('Die Schließzeit');
      }
      await config.deleteItem(practice.practiceId, 'closures', closure.id);
      await record(c, 'closure.deleted', `Schließzeit „${closure.title}“ gelöscht`, closure.id);
      await syncSlots(c);
      return c.body(null, 204);
    })

    // ── Ansage-Presets ───────────────────────────────────────────────────────

    .post(
      '/presets',
      requirePermission('settings.manage'),
      validateJson(AnnouncementPresetInputSchema),
      async (c) => {
        const preset: AnnouncementPreset = { id: newId(), ...c.req.valid('json') };
        await config.putItem(practiceIdOf(c), 'presets', preset);
        await record(c, 'preset.created', `Ansage-Preset „${preset.name}“ angelegt`, preset.id);
        return c.json(preset, 201);
      },
    )

    .put(
      '/presets/:id',
      requirePermission('settings.manage'),
      validateJson(AnnouncementPresetInputSchema),
      async (c) => {
        const practice = await loadPractice(c);
        const preset: AnnouncementPreset = { id: c.req.param('id'), ...c.req.valid('json') };
        if (!practice.presets.some((existing) => existing.id === preset.id)) {
          throw notFound('Das Ansage-Preset');
        }
        await config.putItem(practice.practiceId, 'presets', preset);
        await record(c, 'preset.updated', `Ansage-Preset „${preset.name}“ geändert`, preset.id);
        return c.json(preset);
      },
    )

    .delete('/presets/:id', requirePermission('settings.manage'), async (c) => {
      const practice = await loadPractice(c);
      const preset = practice.presets.find((existing) => existing.id === c.req.param('id'));
      if (!preset) {
        throw notFound('Das Ansage-Preset');
      }
      if (Object.values(practice.settings.presetAssignments).includes(preset.id)) {
        throw conflict(
          'Das Preset ist einem Betriebszustand zugeordnet und kann nicht gelöscht werden',
        );
      }
      if (practice.closures.some((closure) => closure.presetId === preset.id)) {
        throw conflict(
          'Das Preset wird von einer Schließzeit verwendet und kann nicht gelöscht werden',
        );
      }
      await config.deleteItem(practice.practiceId, 'presets', preset.id);
      await record(c, 'preset.deleted', `Ansage-Preset „${preset.name}“ gelöscht`, preset.id);
      return c.body(null, 204);
    })

    // ── Terminkategorien ─────────────────────────────────────────────────────

    .post(
      '/categories',
      requirePermission('schedule.manage'),
      validateJson(AppointmentCategoryInputSchema),
      async (c) => {
        const category: AppointmentCategory = { id: newId(), ...c.req.valid('json') };
        await config.putItem(practiceIdOf(c), 'categories', category);
        await record(c, 'category.created', `Kategorie „${category.name}“ angelegt`, category.id);
        return c.json(category, 201);
      },
    )

    .put(
      '/categories/:id',
      requirePermission('schedule.manage'),
      validateJson(AppointmentCategoryInputSchema),
      async (c) => {
        const practice = await loadPractice(c);
        const category: AppointmentCategory = { id: c.req.param('id'), ...c.req.valid('json') };
        if (!practice.categories.some((existing) => existing.id === category.id)) {
          throw notFound('Die Kategorie');
        }
        await config.putItem(practice.practiceId, 'categories', category);
        await record(c, 'category.updated', `Kategorie „${category.name}“ geändert`, category.id);
        // Duration and the active flag decide which slots exist and how long they are.
        await syncSlots(c);
        return c.json(category);
      },
    )

    .delete('/categories/:id', requirePermission('schedule.manage'), async (c) => {
      const practice = await loadPractice(c);
      const category = practice.categories.find((existing) => existing.id === c.req.param('id'));
      if (!category) {
        throw notFound('Die Kategorie');
      }
      if (practice.templates.some((template) => template.categoryId === category.id)) {
        throw conflict(
          'Für die Kategorie gibt es noch Slot-Vorlagen. Bitte zuerst die Vorlagen löschen oder die Kategorie deaktivieren.',
        );
      }
      await config.deleteItem(practice.practiceId, 'categories', category.id);
      await record(c, 'category.deleted', `Kategorie „${category.name}“ gelöscht`, category.id);
      return c.body(null, 204);
    })

    // ── Slot-Vorlagen ────────────────────────────────────────────────────────

    .post(
      '/slot-templates',
      requirePermission('schedule.manage'),
      validateJson(SlotTemplateInputSchema),
      async (c) => {
        const practice = await loadPractice(c);
        const template: SlotTemplate = { id: newId(), ...c.req.valid('json') };
        categoryOf(practice, template.categoryId);
        await config.putItem(practice.practiceId, 'templates', template);
        await record(
          c,
          'template.created',
          `Slot-Vorlage „${template.name}“ angelegt`,
          template.id,
        );
        await syncSlots(c);
        return c.json(template, 201);
      },
    )

    .put(
      '/slot-templates/:id',
      requirePermission('schedule.manage'),
      validateJson(SlotTemplateInputSchema),
      async (c) => {
        const practice = await loadPractice(c);
        const template: SlotTemplate = { id: c.req.param('id'), ...c.req.valid('json') };
        if (!practice.templates.some((existing) => existing.id === template.id)) {
          throw notFound('Die Slot-Vorlage');
        }
        categoryOf(practice, template.categoryId);
        await config.putItem(practice.practiceId, 'templates', template);
        await record(
          c,
          'template.updated',
          `Slot-Vorlage „${template.name}“ geändert`,
          template.id,
        );
        await syncSlots(c);
        return c.json(template);
      },
    )

    .delete('/slot-templates/:id', requirePermission('schedule.manage'), async (c) => {
      const practice = await loadPractice(c);
      const template = practice.templates.find((existing) => existing.id === c.req.param('id'));
      if (!template) {
        throw notFound('Die Slot-Vorlage');
      }
      await config.deleteItem(practice.practiceId, 'templates', template.id);
      await record(c, 'template.deleted', `Slot-Vorlage „${template.name}“ gelöscht`, template.id);
      await syncSlots(c);
      return c.body(null, 204);
    })

    // ── Terminslots ──────────────────────────────────────────────────────────

    .get(
      '/slots',
      validateQuery(z.object({ from: LocalDateSchema, to: LocalDateSchema })),
      async (c) => {
        const { from, to } = c.req.valid('query');
        if (to < from || eachDate(from, to).length > MAX_SLOT_RANGE_DAYS) {
          throw new ApiError(
            400,
            'invalid_range',
            `Der Zeitraum muss zwischen 1 und ${MAX_SLOT_RANGE_DAYS} Tagen lang sein`,
          );
        }
        return c.json(await slots.listRange(practiceIdOf(c), from, to));
      },
    )

    // Booked appointments that lie in a closure or on a public holiday.
    .get('/slots/conflicts', async (c) => {
      const practice = await loadPractice(c);
      const today = toZoned(new Date(), practice.settings.timeZone).date;
      const upcoming = await slots.listRange(
        practice.practiceId,
        today,
        addDays(today, practice.settings.bookingHorizonDays),
      );
      return c.json(bookedSlotsInClosedTimes(upcoming, practice.closures, practice.settings));
    })

    .post('/slots/reconcile', requirePermission('schedule.manage'), async (c) =>
      c.json(await syncSlots(c)),
    )

    .post(
      '/slots',
      requirePermission('schedule.manage'),
      validateJson(ManualSlotInputSchema),
      async (c) => {
        const input = c.req.valid('json');
        const practice = await loadPractice(c);
        const category = categoryOf(practice, input.categoryId);
        const end = minutesOf(input.startTime) + category.durationMinutes;
        if (end > MINUTES_PER_DAY) {
          throw unprocessable('Der Termin würde über Mitternacht hinausgehen');
        }
        const slot: Slot = {
          id: slotId(input.date, input.startTime, `manual-${newId().slice(0, 8)}`, 0),
          categoryId: category.id,
          date: input.date,
          startTime: input.startTime,
          endTime: timeOf(end),
          startsAt: fromZoned(
            input.date,
            input.startTime,
            practice.settings.timeZone,
          ).toISOString(),
          status: 'free',
        };
        await slots.create(practice.practiceId, [slot]);
        await record(
          c,
          'slot.created',
          `Einzelner Slot am ${slot.date} um ${slot.startTime} angelegt`,
          slot.id,
        );
        return c.json(slot, 201);
      },
    )

    .patch(
      '/slots/:id',
      requirePermission('schedule.manage'),
      validateJson(z.object({ status: z.enum(['free', 'blocked']) })),
      async (c) => {
        const { status } = c.req.valid('json');
        const slot = await loadSlot(c, c.req.param('id'));
        if (slot.status === 'booked') {
          throw conflict('Ein gebuchter Slot kann nicht gesperrt oder freigegeben werden');
        }
        if (slot.status !== status) {
          if (!(await slots.changeStatus(practiceIdOf(c), slot, status))) {
            throw conflict('Der Slot wurde in der Zwischenzeit geändert');
          }
          const verb = status === 'blocked' ? 'gesperrt' : 'freigegeben';
          await record(
            c,
            'slot.updated',
            `Slot am ${slot.date} um ${slot.startTime} ${verb}`,
            slot.id,
          );
        }
        return c.json({ ...slot, status });
      },
    )

    .delete('/slots/:id', requirePermission('schedule.manage'), async (c) => {
      const slot = await loadSlot(c, c.req.param('id'));
      if (slot.templateId) {
        // It would simply be generated again; blocking is the way to take it out.
        throw conflict('Slots aus einer Vorlage können nicht gelöscht, nur gesperrt werden');
      }
      if (slot.status === 'booked' || !(await slots.deleteUnbooked(practiceIdOf(c), [slot]))) {
        throw conflict('Ein gebuchter Slot kann nicht gelöscht werden');
      }
      await record(
        c,
        'slot.deleted',
        `Einzelner Slot am ${slot.date} um ${slot.startTime} gelöscht`,
        slot.id,
      );
      return c.body(null, 204);
    })

    // ── Audit-Log ────────────────────────────────────────────────────────────

    .get(
      '/audit',
      requirePermission('audit.view'),
      validateQuery(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) })),
      async (c) => c.json(await deps.audit.listMonth(practiceIdOf(c), c.req.valid('query').month)),
    );

  app.onError(errorHandler(deps.logger));
  app.notFound(notFoundHandler);
  return app;
}

export type AdminApp = ReturnType<typeof createAdminApp>;
