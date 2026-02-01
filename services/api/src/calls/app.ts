import type { Logger } from '@aws-lambda-powertools/logger';
import {
  type AuditStore,
  type CallStore,
  type ConfigStore,
  expiryAfterDays,
  type SlotStore,
  type UserStore,
} from '@callisto/data';
import { type Inquiry, InquiryStatusSchema, LocalDateSchema } from '@callisto/domain';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { auditor, corsFor, errorHandler, notFoundHandler } from '../lib/app';
import { authenticate, requirePermission } from '../lib/auth';
import { ApiError, type AppEnv, notFound, validateJson, validateQuery } from '../lib/http';

export interface CallsDeps {
  calls: CallStore;
  slots: SlotStore;
  config: ConfigStore;
  users: UserStore;
  audit: AuditStore;
  allowedOrigins: string[];
  logger: Logger;
}

const InquiryUpdateSchema = z.object({
  status: InquiryStatusSchema.optional(),
  note: z.string().trim().max(2000).optional(),
});

/** Either the inquiries of one day or everything that is still open. */
const InquiryQuerySchema = z.object({
  date: LocalDateSchema.optional(),
  open: z.literal('true').optional(),
});

/**
 * What callers left with the assistant: the calls with their transcripts and the inquiries the
 * practice has to act on. This is the only part of the API that touches patient data.
 */
export function createCallsApp(deps: CallsDeps) {
  const { calls, slots } = deps;
  const record = auditor(deps.audit);

  const practiceIdOf = (c: Context<AppEnv>) => c.get('user').profile.practiceId;
  const may = (c: Context<AppEnv>, permission: 'transcripts.view') =>
    c.get('user').role.permissions.includes(permission);

  const loadInquiry = async (c: Context<AppEnv>, id: string): Promise<Inquiry> => {
    const inquiry = await calls.getInquiry(id);
    if (!inquiry || inquiry.practiceId !== practiceIdOf(c)) {
      throw notFound('Das Anliegen');
    }
    return inquiry;
  };

  const app = new Hono<AppEnv>()
    .basePath('/v1')
    .use(corsFor(deps.allowedOrigins))
    .use(authenticate(deps))

    .get(
      '/calls',
      requirePermission('calls.view'),
      validateQuery(z.object({ date: LocalDateSchema })),
      async (c) => c.json(await calls.listCallsByDate(practiceIdOf(c), c.req.valid('query').date)),
    )

    .get('/calls/:id', requirePermission('calls.view'), async (c) => {
      const call = await calls.getCall(c.req.param('id'));
      if (!call || call.practiceId !== practiceIdOf(c)) {
        throw notFound('Der Anruf');
      }
      const inquiries = (
        await Promise.all(call.inquiryIds.map((id) => calls.getInquiry(id)))
      ).filter((inquiry) => inquiry !== undefined);
      // The wording of a conversation is more sensitive than the fact that it took place: it
      // needs its own permission, and reading it is recorded.
      if (!may(c, 'transcripts.view')) {
        return c.json({ call, inquiries, turns: null });
      }
      const turns = await calls.listTurns(call.id);
      if (call.status !== 'in_progress') {
        await record(c, 'transcript.viewed', 'Transkript eines Anrufs geöffnet', call.id);
      }
      return c.json({ call, inquiries, turns });
    })

    .get(
      '/inquiries',
      requirePermission('dashboard.view'),
      validateQuery(InquiryQuerySchema),
      async (c) => {
        const { date, open } = c.req.valid('query');
        if (open) {
          return c.json(await calls.listOpenInquiries(practiceIdOf(c)));
        }
        if (!date) {
          throw new ApiError(400, 'missing_filter', 'Es wird ein Datum oder „open=true“ erwartet');
        }
        return c.json(await calls.listInquiriesByDate(practiceIdOf(c), date));
      },
    )

    .patch(
      '/inquiries/:id',
      requirePermission('inquiries.manage'),
      validateJson(InquiryUpdateSchema),
      async (c) => {
        const changes = c.req.valid('json');
        const inquiry = await loadInquiry(c, c.req.param('id'));
        const updated: Inquiry = {
          ...inquiry,
          status: changes.status ?? inquiry.status,
          updatedAt: new Date().toISOString(),
        };
        if (changes.note !== undefined) {
          if (changes.note) {
            updated.note = changes.note;
          } else {
            delete updated.note;
          }
        }

        // Cancelling an appointment gives its slot back to the assistant.
        const { details } = inquiry;
        if (
          details.type === 'appointment' &&
          updated.status === 'cancelled' &&
          inquiry.status !== 'cancelled'
        ) {
          const slot = await slots.get(inquiry.practiceId, details.slotId);
          if (slot?.status === 'booked' && slot.inquiryId === inquiry.id) {
            await slots.changeStatus(inquiry.practiceId, slot, 'free');
          }
        }

        const practice = await deps.config.load(inquiry.practiceId);
        const keepDays = practice?.settings.retention.inquiryDays ?? 180;
        await calls.putInquiry(updated, expiryAfterDays(keepDays));
        if (updated.status !== inquiry.status) {
          await record(
            c,
            'inquiry.updated',
            `Anliegen auf „${updated.status}“ gesetzt`,
            inquiry.id,
          );
        }
        return c.json(updated);
      },
    );

  app.onError(errorHandler(deps.logger));
  app.notFound(notFoundHandler);
  return app;
}

export type CallsApp = ReturnType<typeof createCallsApp>;
