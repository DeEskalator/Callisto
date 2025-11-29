import type { Logger } from '@aws-lambda-powertools/logger';
import type { AuditStore, ConfigStore, PracticeConfig, UserStore } from '@callisto/data';
import {
  type AnnouncementPreset,
  AnnouncementPresetInputSchema,
  type AppointmentCategory,
  AppointmentCategoryInputSchema,
  type Closure,
  ClosureInputSchema,
  newId,
  OpeningHoursSchema,
  openingStateAt,
  PracticeSettingsSchema,
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

export interface AdminDeps {
  config: ConfigStore;
  users: UserStore;
  audit: AuditStore;
  allowedOrigins: string[];
  logger: Logger;
}

function assertPresetExists(practice: PracticeConfig, presetId: string | undefined): void {
  if (presetId && !practice.presets.some((preset) => preset.id === presetId)) {
    throw unprocessable('Das ausgewählte Ansage-Preset existiert nicht');
  }
}

/**
 * Practice configuration: settings, opening hours, closures, announcement presets and
 * appointment categories. Reading is open to every signed-in user of the practice.
 */
export function createAdminApp(deps: AdminDeps) {
  const { config } = deps;
  const record = auditor(deps.audit);

  const loadPractice = async (c: Context<AppEnv>): Promise<PracticeConfig> => {
    const practice = await config.load(c.get('user').profile.practiceId);
    if (!practice) {
      throw new ApiError(500, 'practice_missing', 'Die Praxis ist noch nicht eingerichtet');
    }
    return practice;
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
        return c.json(settings);
      },
    )

    .put(
      '/opening-hours',
      requirePermission('settings.manage'),
      validateJson(OpeningHoursSchema),
      async (c) => {
        const hours = c.req.valid('json');
        const { practiceId } = c.get('user').profile;
        await config.putHours(practiceId, hours);
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
      return c.body(null, 204);
    })

    // ── Ansage-Presets ───────────────────────────────────────────────────────

    .post(
      '/presets',
      requirePermission('settings.manage'),
      validateJson(AnnouncementPresetInputSchema),
      async (c) => {
        const { practiceId } = c.get('user').profile;
        const preset: AnnouncementPreset = { id: newId(), ...c.req.valid('json') };
        await config.putItem(practiceId, 'presets', preset);
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
        const { practiceId } = c.get('user').profile;
        const category: AppointmentCategory = { id: newId(), ...c.req.valid('json') };
        await config.putItem(practiceId, 'categories', category);
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

    // ── Audit-Log ────────────────────────────────────────────────────────────

    .get(
      '/audit',
      requirePermission('audit.view'),
      validateQuery(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) })),
      async (c) => {
        const { practiceId } = c.get('user').profile;
        return c.json(await deps.audit.listMonth(practiceId, c.req.valid('query').month));
      },
    );

  app.onError(errorHandler(deps.logger));
  app.notFound(notFoundHandler);
  return app;
}

export type AdminApp = ReturnType<typeof createAdminApp>;
