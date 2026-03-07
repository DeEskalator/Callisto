import { MemoryCallStore, MemoryConfigStore, MemorySlotStore } from '@callisto/data/memory';
import { type AppointmentCategory, generateSlots, type SlotTemplate } from '@callisto/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { KeywordEmergencyMonitor } from '../src/emergency';
import { ScriptedModel } from '../src/scripted-model';
import { type CallerLink, ConversationSession, type EndReason } from '../src/session';

const PRACTICE = 'main';
// A Monday at 09:00 in Berlin: the practice is open.
const MONDAY_MORNING = new Date('2026-11-16T08:00:00Z');
// The Saturday before at 10:00: closed.
const SATURDAY = new Date('2026-11-14T09:00:00Z');

const checkup: AppointmentCategory = {
  id: 'checkup',
  name: 'Vorsorge',
  description: 'Vorsorgeuntersuchungen',
  durationMinutes: 30,
  patientHint: 'Bitte bringen Sie Ihren Impfpass mit.',
  color: '#1d4ed8',
  active: true,
};
const template: SlotTemplate = {
  id: 'tpl',
  name: 'Vorsorge',
  categoryId: 'checkup',
  weekdays: ['tue'],
  from: '15:00',
  to: '16:00',
  capacity: 1,
  validFrom: '2026-11-01',
  active: true,
};

async function setup(now: Date) {
  const config = MemoryConfigStore.withPractice(PRACTICE, 'Praxis Test', 'NW');
  const loaded = await config.load(PRACTICE);
  if (loaded) {
    // The practice's second line, which is not forwarded to the assistant.
    await config.putSettings(PRACTICE, { ...loaded.settings, transferNumber: '+4930123456' });
  }
  await config.putItem(PRACTICE, 'categories', checkup);
  await config.putItem(PRACTICE, 'templates', template);
  const slots = new MemorySlotStore();
  const practice = await config.load(PRACTICE);
  await slots.create(
    PRACTICE,
    generateSlots({
      templates: [template],
      categories: [checkup],
      closures: [],
      settings: practice?.settings ?? { timeZone: 'Europe/Berlin', federalState: 'NW' },
      from: '2026-11-16',
      to: '2026-11-30',
    }),
  );
  const calls = new MemoryCallStore();

  const lines: Array<{ role: string; text: string }> = [];
  let ended: EndReason | undefined;
  let waiting: (() => void) | undefined;
  const link: CallerLink = {
    transcript: (role, text) => {
      lines.push({ role, text });
      waiting?.();
    },
    audio: () => {},
    clearAudio: () => {},
    ended: (reason) => {
      ended = reason;
      waiting?.();
    },
  };
  const session = await ConversationSession.start(
    { practiceId: PRACTICE, channel: 'test_text' },
    {
      config,
      calls,
      slots,
      model: new ScriptedModel(),
      emergency: new KeywordEmergencyMonitor(),
      now: () => now,
    },
    link,
  );

  /** Sends a line as the caller and waits for the assistant's answer or the end of the call. */
  const say = async (text: string) => {
    const before = lines.filter((line) => line.role === 'assistant').length;
    session.receiveText(text);
    while (lines.filter((line) => line.role === 'assistant').length === before && !ended) {
      await new Promise<void>((resolve) => {
        waiting = resolve;
        setTimeout(resolve, 50);
      });
    }
    return lines.at(-1)?.text ?? '';
  };
  const untilEnded = async () => {
    while (!ended) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return ended;
  };
  const call = () => calls.calls.get(session.callId);
  return { session, calls, slots, lines, say, untilEnded, call };
}

describe('a conversation', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  describe('during opening hours', () => {
    beforeEach(async () => {
      ctx = await setup(MONDAY_MORNING);
    });

    it('starts with the greeting that names the AI assistant', () => {
      expect(ctx.lines[0]).toEqual({
        role: 'assistant',
        text: expect.stringContaining('KI-Assistent'),
      });
      expect(ctx.call()).toMatchObject({
        status: 'in_progress',
        openingMode: 'open',
        channel: 'test_text',
        date: '2026-11-16',
      });
    });

    it('books an appointment and records it as an inquiry', async () => {
      await ctx.say('Ich hätte gern einen Termin zur Vorsorge');
      expect(ctx.lines.at(-1)?.text).toContain('Dienstag, 17.11. um 15:00 Uhr');
      await ctx.say('Der erste passt');
      const confirmation = await ctx.say('Erika Mustermann, 12.08.1964');
      expect(confirmation).toContain('Ihr Termin ist gebucht');
      expect(confirmation).toContain('Impfpass');

      const [inquiry] = [...ctx.calls.inquiries.values()];
      expect(inquiry).toMatchObject({
        status: 'new',
        test: true,
        callId: ctx.session.callId,
        patient: { firstName: 'Erika', lastName: 'Mustermann', dateOfBirth: '1964-08-12' },
        details: { type: 'appointment', date: '2026-11-17', startTime: '15:00' },
      });
      const slot = await ctx.slots.get(PRACTICE, '2026-11-17T1500_tpl_0');
      expect(slot).toMatchObject({ status: 'booked', inquiryId: inquiry?.id });
      // The dashboard sees the inquiry while the call is still running.
      expect(ctx.call()?.inquiryIds).toEqual([inquiry?.id]);
    });

    it('does not book without a date of birth', async () => {
      await ctx.say('Termin Vorsorge bitte');
      await ctx.say('ja');
      const answer = await ctx.say('Erika Mustermann');
      expect(answer).toContain('Geburtsdatum');
      expect(ctx.calls.inquiries.size).toBe(0);
    });

    it('takes a prescription request', async () => {
      await ctx.say('Ich brauche ein Rezept');
      await ctx.say('Ramipril und Metformin');
      await ctx.say('Max Beispiel, 3.4.1950');
      const [inquiry] = [...ctx.calls.inquiries.values()];
      expect(inquiry?.details).toMatchObject({
        type: 'prescription',
        medications: [{ name: 'Ramipril' }, { name: 'Metformin' }],
      });
    });

    it('transfers other concerns to the practice with a summary', async () => {
      ctx.session.receiveText('Ich habe eine Frage zu meiner Überweisung');
      expect(await ctx.untilEnded()).toBe('transferred');
      expect(ctx.call()).toMatchObject({ status: 'transferred' });
      expect([...ctx.calls.inquiries.values()][0]?.details).toMatchObject({
        type: 'other',
        transferred: true,
        summary: 'Ich habe eine Frage zu meiner Überweisung',
      });
    });

    it('recognises an emergency, names 112 and ends the call', async () => {
      ctx.session.receiveText('Mein Mann bekommt keine Luft mehr');
      expect(await ctx.untilEnded()).toBe('emergency');
      expect(ctx.lines.at(-1)?.text).toContain('112');
      expect(ctx.call()).toMatchObject({
        status: 'emergency',
        summary: expect.stringContaining('112'),
      });
    });

    it('keeps the transcript in spoken order and closes the call when the caller hangs up', async () => {
      await ctx.say('Wann haben Sie geöffnet?');
      await ctx.session.hangUp();
      const turns = await ctx.calls.listTurns(ctx.session.callId);
      expect(turns.map((turn) => turn.role)).toEqual(['assistant', 'caller', 'assistant']);
      expect(ctx.call()).toMatchObject({ status: 'completed', endedAt: expect.any(String) });
    });

    it('marks a call without a word from the caller as abandoned', async () => {
      await ctx.session.hangUp();
      expect(ctx.call()?.status).toBe('abandoned');
    });
  });

  describe('outside opening hours', () => {
    beforeEach(async () => {
      ctx = await setup(SATURDAY);
    });

    it('adds the announcement of the preset to the greeting', () => {
      expect(ctx.lines[0]?.text).toContain('116 117');
      expect(ctx.call()).toMatchObject({ openingMode: 'closed', presetId: 'closed' });
    });

    it('does not transfer, but notes a callback', async () => {
      const answer = await ctx.say('Ich habe eine Frage zu meiner Überweisung');
      expect(answer).toContain('Rückrufbitte');
      await ctx.say('Frau Schmidt, 0171 2345678');
      expect([...ctx.calls.inquiries.values()][0]).toMatchObject({
        patient: { lastName: 'Schmidt', phone: '01712345678' },
        details: { type: 'callback', topic: 'Ich habe eine Frage zu meiner Überweisung' },
      });
    });
  });
});

describe('the emergency monitor', () => {
  const monitor = new KeywordEmergencyMonitor();

  it('reacts to acute situations', async () => {
    expect(await monitor.isEmergency('Ich kriege keine Luft')).toBe(true);
    expect(await monitor.isEmergency('Meine Mutter ist nicht mehr ansprechbar')).toBe(true);
    expect(await monitor.isEmergency('Ich will nicht mehr leben')).toBe(false);
    expect(await monitor.isEmergency('Ich will mich umbringen')).toBe(true);
  });

  it('stays quiet for history and routine requests', async () => {
    expect(
      await monitor.isEmergency('Ich hatte letztes Jahr einen Herzinfarkt und brauche ein Rezept'),
    ).toBe(false);
    expect(await monitor.isEmergency('Ich brauche einen Termin zur Blutabnahme')).toBe(false);
  });
});
