import {
  type CallStore,
  expiryAfterDays,
  type PracticeConfig,
  type SlotStore,
} from '@callisto/data';
import {
  addDays,
  type Inquiry,
  type InquiryDetails,
  LocalDateSchema,
  laterDate,
  minutesOf,
  newId,
  type Patient,
  type PresetCapabilities,
  type Slot,
  toZoned,
  weekdayOf,
} from '@callisto/domain';
import type { ToolSpec } from './model';

/** What a tool call means for the conversation beyond its answer to the model. */
export type ToolEffect = 'transfer' | 'emergency' | 'hangup';

export interface ToolOutcome {
  /** Handed back to the model as the result of the call. */
  result: Record<string, unknown>;
  effect?: ToolEffect;
}

export interface ToolContext {
  practice: PracticeConfig;
  capabilities: PresetCapabilities;
  call: { id: string; callerNumber?: string | undefined; test: boolean };
  calls: CallStore;
  slots: SlotStore;
  now: () => Date;
  /** Called with the id of every inquiry a tool creates. */
  onInquiry: (inquiryId: string) => void;
}

const WEEKDAY_NAMES = {
  mon: 'Montag',
  tue: 'Dienstag',
  wed: 'Mittwoch',
  thu: 'Donnerstag',
  fri: 'Freitag',
  sat: 'Samstag',
  sun: 'Sonntag',
} as const;

const patientProperties = {
  firstName: { type: 'string', description: 'Vorname des Patienten' },
  lastName: { type: 'string', description: 'Nachname des Patienten' },
  dateOfBirth: { type: 'string', description: 'Geburtsdatum im Format JJJJ-MM-TT' },
  phone: { type: 'string', description: 'Rückrufnummer, falls der Anrufer eine nennt' },
};

const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  properties,
  required,
});

/**
 * The tools the assistant has in a conversation. Which ones are offered depends on the active
 * announcement preset: what a preset does not allow is not even shown to the model, and the
 * executor refuses it as well.
 */
export function toolSpecs(capabilities: PresetCapabilities): ToolSpec[] {
  const tools: ToolSpec[] = [];
  if (capabilities.appointments) {
    tools.push(
      {
        name: 'freie_termine_suchen',
        description:
          'Sucht die nächsten freien Termine einer Kategorie. Vor jedem Terminangebot aufrufen; nie Termine nennen, die nicht aus diesem Ergebnis stammen.',
        inputSchema: object(
          {
            categoryId: { type: 'string', description: 'Kennung der Terminkategorie' },
            earliestDate: {
              type: 'string',
              description: 'Frühestes gewünschtes Datum im Format JJJJ-MM-TT (optional)',
            },
            timeOfDay: {
              type: 'string',
              enum: ['morning', 'afternoon'],
              description: 'Gewünschte Tageszeit (optional)',
            },
          },
          ['categoryId'],
        ),
      },
      {
        name: 'termin_buchen',
        description:
          'Bucht einen freien Termin verbindlich. Erst aufrufen, wenn der Anrufer den Termin bestätigt hat und Vorname, Nachname und Geburtsdatum vorliegen.',
        inputSchema: object(
          {
            slotId: { type: 'string', description: 'slotId aus freie_termine_suchen' },
            ...patientProperties,
            reason: { type: 'string', description: 'Anlass des Termins in Stichworten (optional)' },
          },
          ['slotId', 'firstName', 'lastName', 'dateOfBirth'],
        ),
      },
    );
  }
  if (capabilities.prescriptions) {
    tools.push({
      name: 'rezept_bestellen',
      description:
        'Nimmt einen Rezeptwunsch für die Praxis auf. Erst aufrufen, wenn Vorname, Nachname, Geburtsdatum und mindestens ein Medikament vorliegen.',
      inputSchema: object(
        {
          ...patientProperties,
          medications: {
            type: 'array',
            description: 'Die gewünschten Medikamente',
            items: object(
              {
                name: { type: 'string', description: 'Name des Medikaments' },
                strength: { type: 'string', description: 'Wirkstärke, z. B. 5 mg (optional)' },
                packageSize: { type: 'string', description: 'Packungsgröße (optional)' },
              },
              ['name'],
            ),
          },
          note: { type: 'string', description: 'Ergänzender Hinweis des Anrufers (optional)' },
        },
        ['firstName', 'lastName', 'dateOfBirth', 'medications'],
      ),
    });
  }
  if (capabilities.callbacks) {
    tools.push({
      name: 'rueckruf_notieren',
      description:
        'Notiert eine Rückrufbitte für das Praxisteam, wenn ein Anliegen nicht sofort geklärt werden kann.',
      inputSchema: object(
        {
          ...patientProperties,
          topic: { type: 'string', description: 'Worum es geht, in ein bis zwei Sätzen' },
          preferredTime: { type: 'string', description: 'Wann der Rückruf passt (optional)' },
        },
        ['lastName', 'topic'],
      ),
    });
  }
  if (capabilities.transfer) {
    tools.push({
      name: 'mit_praxis_verbinden',
      description:
        'Verbindet den Anrufer mit dem Praxisteam. Vorher das Anliegen erfragen und hier zusammenfassen.',
      inputSchema: object(
        {
          ...patientProperties,
          summary: { type: 'string', description: 'Das Anliegen in ein bis zwei Sätzen' },
        },
        ['summary'],
      ),
    });
  }
  tools.push(
    {
      name: 'notfall_melden',
      description:
        'Sofort aufrufen, wenn der Anrufer einen medizinischen Notfall schildert (z. B. Brustschmerz, Atemnot, Bewusstlosigkeit, Lähmung, starke Blutung, Suizidgedanken). Nichts anderes mehr fragen.',
      inputSchema: object({}, []),
    },
    {
      name: 'gespraech_beenden',
      description: 'Beendet das Gespräch, nachdem sich der Anrufer verabschiedet hat.',
      inputSchema: object({}, []),
    },
  );
  return tools;
}

const failure = (message: string): ToolOutcome => ({ result: { ok: false, message } });

function patientOf(input: Record<string, unknown>, fallbackPhone?: string): Patient {
  const text = (key: string) =>
    typeof input[key] === 'string' && input[key].trim() ? input[key].trim() : undefined;
  const patient: Patient = {};
  const firstName = text('firstName');
  const lastName = text('lastName');
  const dateOfBirth = text('dateOfBirth');
  const phone = text('phone') ?? fallbackPhone;
  if (firstName) patient.firstName = firstName;
  if (lastName) patient.lastName = lastName;
  if (dateOfBirth && LocalDateSchema.safeParse(dateOfBirth).success)
    patient.dateOfBirth = dateOfBirth;
  if (phone) patient.phone = phone;
  return patient;
}

/** The fields of a complete identification that are still missing, in German for the model. */
function missingIdentity(patient: Patient): string[] {
  return [
    patient.firstName ? '' : 'Vorname',
    patient.lastName ? '' : 'Nachname',
    patient.dateOfBirth ? '' : 'Geburtsdatum (JJJJ-MM-TT)',
  ].filter(Boolean);
}

async function createInquiry(
  context: ToolContext,
  patient: Patient,
  details: InquiryDetails,
): Promise<Inquiry> {
  const now = context.now();
  const inquiry: Inquiry = {
    id: newId(),
    practiceId: context.practice.practiceId,
    status: 'new',
    date: toZoned(now, context.practice.settings.timeZone).date,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    callId: context.call.id,
    patient,
    details,
    test: context.call.test,
  };
  await context.calls.putInquiry(
    inquiry,
    expiryAfterDays(context.practice.settings.retention.inquiryDays, now),
  );
  context.onInquiry(inquiry.id);
  return inquiry;
}

async function findFreeSlots(
  context: ToolContext,
  input: Record<string, unknown>,
): Promise<ToolOutcome> {
  const { practice } = context;
  const category = practice.categories.find(
    (candidate) => candidate.id === input.categoryId && candidate.active,
  );
  if (!category) {
    return failure('Diese Terminkategorie gibt es nicht.');
  }
  const { timeZone, bookingLeadMinutes, bookingHorizonDays } = practice.settings;
  // Nothing is offered that starts sooner than the lead time or lies beyond the horizon.
  const earliest = toZoned(
    new Date(context.now().getTime() + bookingLeadMinutes * 60_000),
    timeZone,
  );
  const today = toZoned(context.now(), timeZone).date;
  const wanted = typeof input.earliestDate === 'string' ? input.earliestDate : earliest.date;
  const from =
    laterDate(wanted, earliest.date) === earliest.date
      ? { date: earliest.date, time: earliest.time }
      : { date: wanted, time: '00:00' };
  const lastDate = addDays(today, bookingHorizonDays);

  const candidates = await context.slots.findFree(practice.practiceId, category.id, from, 60);
  const offered: Slot[] = [];
  const seen = new Set<string>();
  for (const slot of candidates) {
    const minutes = minutesOf(slot.startTime);
    const fitsTimeOfDay =
      input.timeOfDay === 'morning'
        ? minutes < 12 * 60
        : input.timeOfDay === 'afternoon'
          ? minutes >= 12 * 60
          : true;
    const key = `${slot.date}T${slot.startTime}`;
    if (slot.date > lastDate || !fitsTimeOfDay || seen.has(key)) {
      continue;
    }
    seen.add(key);
    offered.push(slot);
    if (offered.length === 3) {
      break;
    }
  }
  if (offered.length === 0) {
    return {
      result: {
        ok: true,
        slots: [],
        message: 'Für diesen Wunsch ist in nächster Zeit kein Termin frei.',
      },
    };
  }
  return {
    result: {
      ok: true,
      category: category.name,
      slots: offered.map((slot) => ({
        slotId: slot.id,
        date: slot.date,
        weekday: WEEKDAY_NAMES[weekdayOf(slot.date)],
        time: slot.startTime,
      })),
    },
  };
}

async function bookAppointment(
  context: ToolContext,
  input: Record<string, unknown>,
): Promise<ToolOutcome> {
  const { practice } = context;
  const patient = patientOf(input, context.call.callerNumber);
  const missing = missingIdentity(patient);
  if (missing.length > 0) {
    return failure(`Es fehlt noch: ${missing.join(', ')}.`);
  }
  const slot =
    typeof input.slotId === 'string'
      ? await context.slots.get(practice.practiceId, input.slotId)
      : undefined;
  const category = practice.categories.find((candidate) => candidate.id === slot?.categoryId);
  if (!slot || !category) {
    return failure('Diesen Termin gibt es nicht. Bitte suche erneut nach freien Terminen.');
  }

  // The slot is taken first, with a condition on its status: if two callers want the same slot
  // at the same moment, exactly one of them gets it.
  const inquiryId = newId();
  if (
    slot.status !== 'free' ||
    !(await context.slots.changeStatus(practice.practiceId, slot, 'booked', inquiryId))
  ) {
    return failure('Dieser Termin wurde gerade vergeben. Bitte biete einen anderen an.');
  }
  const now = context.now();
  const inquiry: Inquiry = {
    id: inquiryId,
    practiceId: practice.practiceId,
    status: 'new',
    date: toZoned(now, practice.settings.timeZone).date,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    callId: context.call.id,
    patient,
    details: {
      type: 'appointment',
      slotId: slot.id,
      categoryId: category.id,
      categoryName: category.name,
      date: slot.date,
      startTime: slot.startTime,
      endTime: slot.endTime,
      ...(typeof input.reason === 'string' && input.reason ? { reason: input.reason } : {}),
    },
    test: context.call.test,
  };
  try {
    await context.calls.putInquiry(
      inquiry,
      expiryAfterDays(practice.settings.retention.inquiryDays, now),
    );
  } catch (error) {
    // Without the inquiry nobody would know who the slot belongs to; give it back.
    await context.slots.changeStatus(practice.practiceId, { ...slot, status: 'booked' }, 'free');
    throw error;
  }
  context.onInquiry(inquiry.id);
  return {
    result: {
      ok: true,
      booked: {
        category: category.name,
        date: slot.date,
        weekday: WEEKDAY_NAMES[weekdayOf(slot.date)],
        time: slot.startTime,
      },
      ...(category.patientHint ? { hintForPatient: category.patientHint } : {}),
    },
  };
}

async function orderPrescription(
  context: ToolContext,
  input: Record<string, unknown>,
): Promise<ToolOutcome> {
  const patient = patientOf(input, context.call.callerNumber);
  const missing = missingIdentity(patient);
  const medications = (Array.isArray(input.medications) ? input.medications : [])
    .filter(
      (entry): entry is { name: string; strength?: string; packageSize?: string } =>
        typeof entry?.name === 'string' && entry.name.trim() !== '',
    )
    .map((entry) => ({
      name: entry.name.trim(),
      ...(entry.strength ? { strength: String(entry.strength) } : {}),
      ...(entry.packageSize ? { packageSize: String(entry.packageSize) } : {}),
    }));
  if (medications.length === 0) {
    missing.push('mindestens ein Medikament');
  }
  if (missing.length > 0) {
    return failure(`Es fehlt noch: ${missing.join(', ')}.`);
  }
  await createInquiry(context, patient, {
    type: 'prescription',
    medications,
    ...(typeof input.note === 'string' && input.note ? { note: input.note } : {}),
  });
  return {
    result: {
      ok: true,
      message: 'Der Rezeptwunsch ist notiert. Die Praxis prüft ihn; eine Zusage ist das nicht.',
    },
  };
}

async function noteCallback(
  context: ToolContext,
  input: Record<string, unknown>,
): Promise<ToolOutcome> {
  const patient = patientOf(input, context.call.callerNumber);
  const topic = typeof input.topic === 'string' ? input.topic.trim() : '';
  if (!patient.lastName || !topic) {
    return failure('Es fehlt noch: Nachname und Anliegen.');
  }
  if (!patient.phone) {
    return failure('Es fehlt noch: eine Rückrufnummer.');
  }
  await createInquiry(context, patient, {
    type: 'callback',
    topic,
    ...(typeof input.preferredTime === 'string' && input.preferredTime
      ? { preferredTime: input.preferredTime }
      : {}),
  });
  return { result: { ok: true, message: 'Die Rückrufbitte ist notiert.' } };
}

async function transferToPractice(
  context: ToolContext,
  input: Record<string, unknown>,
): Promise<ToolOutcome> {
  const summary = typeof input.summary === 'string' ? input.summary.trim() : '';
  if (!summary) {
    return failure('Bitte zuerst das Anliegen erfragen und zusammenfassen.');
  }
  await createInquiry(context, patientOf(input, context.call.callerNumber), {
    type: 'other',
    summary,
    transferred: true,
  });
  return { result: { ok: true }, effect: 'transfer' };
}

/** Runs a tool the model asked for. Unknown tools and tools the preset does not allow fail. */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolOutcome> {
  if (!toolSpecs(context.capabilities).some((tool) => tool.name === name)) {
    return failure('Das ist im Moment nicht möglich.');
  }
  switch (name) {
    case 'freie_termine_suchen':
      return findFreeSlots(context, input);
    case 'termin_buchen':
      return bookAppointment(context, input);
    case 'rezept_bestellen':
      return orderPrescription(context, input);
    case 'rueckruf_notieren':
      return noteCallback(context, input);
    case 'mit_praxis_verbinden':
      return transferToPractice(context, input);
    case 'notfall_melden':
      return { result: { ok: true }, effect: 'emergency' };
    case 'gespraech_beenden':
      return { result: { ok: true }, effect: 'hangup' };
    default:
      return failure('Das ist im Moment nicht möglich.');
  }
}
