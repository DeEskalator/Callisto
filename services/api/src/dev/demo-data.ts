import {
  type CallStore,
  type ConfigStore,
  expiryAfterDays,
  type PracticeConfig,
  type SlotStore,
  type UserStore,
} from '@callisto/data';
import {
  type AppointmentCategory,
  addDays,
  type Call,
  fromZoned,
  type Inquiry,
  type InquiryDetails,
  type Patient,
  type SlotTemplate,
  toZoned,
} from '@callisto/domain';
import { reconcileSlots } from '../scheduling/reconcile';

export const DEMO_PRACTICE_ID = 'main';
export const DEMO_ADMIN_ID = 'dev-admin';
const TIME_ZONE = 'Europe/Berlin';

interface Stores {
  config: ConfigStore;
  users: UserStore;
  slots: SlotStore;
  calls: CallStore;
}

const CATEGORIES: AppointmentCategory[] = [
  {
    id: 'acute',
    name: 'Akutsprechstunde',
    description: 'Akute Beschwerden, die am selben oder nächsten Tag angesehen werden sollen.',
    durationMinutes: 10,
    color: '#c2410c',
    active: true,
  },
  {
    id: 'checkup',
    name: 'Vorsorge',
    description: 'Check-up, Hautkrebsscreening und andere Vorsorgeuntersuchungen.',
    durationMinutes: 30,
    patientHint: 'Bitte bringen Sie Ihren Impfpass mit.',
    color: '#1d4ed8',
    active: true,
  },
  {
    id: 'blood',
    name: 'Blutabnahme',
    description: 'Blutabnahme und Laborkontrollen.',
    durationMinutes: 10,
    patientHint: 'Bitte kommen Sie nüchtern.',
    color: '#7e22ce',
    active: true,
  },
];

const templatesFrom = (today: string): SlotTemplate[] => [
  {
    id: 'acute-morning',
    name: 'Akut vormittags',
    categoryId: 'acute',
    weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    from: '08:00',
    to: '09:00',
    capacity: 1,
    validFrom: today,
    active: true,
  },
  {
    id: 'blood-early',
    name: 'Labor früh',
    categoryId: 'blood',
    weekdays: ['mon', 'wed', 'fri'],
    from: '07:30',
    to: '08:30',
    capacity: 2,
    validFrom: today,
    active: true,
  },
  {
    id: 'checkup-afternoon',
    name: 'Vorsorge nachmittags',
    categoryId: 'checkup',
    weekdays: ['tue', 'thu'],
    from: '15:00',
    to: '17:00',
    capacity: 1,
    validFrom: today,
    active: true,
  },
];

interface DemoCall {
  /** Wall-clock start on the given day. */
  date: string;
  time: string;
  minutes: number;
  status: Call['status'];
  callerNumber?: string;
  summary: string;
  lines: Array<['caller' | 'assistant', string]>;
  inquiry?: { patient: Patient; details: InquiryDetails; status?: Inquiry['status'] };
}

/** Fills the in-memory stores with a practice and a day's worth of invented calls. */
export async function seedDemoData(stores: Stores): Promise<void> {
  const { config, users, slots, calls } = stores;
  const today = toZoned(new Date(), TIME_ZONE).date;
  const yesterday = addDays(today, -1);
  const createdAt = new Date().toISOString();

  await users.put({
    id: DEMO_ADMIN_ID,
    practiceId: DEMO_PRACTICE_ID,
    email: 'leitung@praxis.example',
    name: 'Praxisleitung (Demo)',
    roleId: 'admin',
    status: 'active',
    createdAt,
  });
  await users.put({
    id: 'dev-staff',
    practiceId: DEMO_PRACTICE_ID,
    email: 'empfang@praxis.example',
    name: 'Empfang (Demo)',
    roleId: 'staff',
    status: 'active',
    createdAt,
  });
  for (const category of CATEGORIES) {
    await config.putItem(DEMO_PRACTICE_ID, 'categories', category);
  }
  for (const template of templatesFrom(today)) {
    await config.putItem(DEMO_PRACTICE_ID, 'templates', template);
  }
  await config.putItem(DEMO_PRACTICE_ID, 'closures', {
    id: 'bridge-day',
    title: 'Brückentag',
    from: addDays(today, 20),
    to: addDays(today, 20),
    allDay: true,
  });
  const practice = (await config.load(DEMO_PRACTICE_ID)) as PracticeConfig;
  await reconcileSlots(practice, slots);

  // One free check-up slot is turned into a booked appointment for the first demo call.
  const [checkupSlot] = await slots.findFree(
    DEMO_PRACTICE_ID,
    'checkup',
    { date: today, time: '00:00' },
    1,
  );
  const greeting = practice.settings.greeting;

  const demoCalls: DemoCall[] = [
    {
      date: today,
      time: '08:12',
      minutes: 3,
      status: 'completed',
      callerNumber: '+4917612345601',
      summary: 'Termin gebucht: Vorsorge.',
      lines: [
        ['assistant', greeting],
        ['caller', 'Guten Morgen, ich möchte einen Termin für einen Check-up.'],
        ['assistant', 'Gern. Ich habe einen Termin zur Vorsorge frei. Passt Ihnen der?'],
        ['caller', 'Ja, der passt.'],
        ['assistant', 'Nennen Sie mir bitte Vorname, Nachname und Geburtsdatum.'],
        ['caller', 'Helga Brandt, geboren am 4. Mai 1958.'],
        ['assistant', 'Ihr Termin ist gebucht. Bitte bringen Sie Ihren Impfpass mit.'],
      ],
      ...(checkupSlot
        ? {
            inquiry: {
              patient: {
                firstName: 'Helga',
                lastName: 'Brandt',
                dateOfBirth: '1958-05-04',
                phone: '+4917612345601',
              },
              details: {
                type: 'appointment' as const,
                slotId: checkupSlot.id,
                categoryId: 'checkup',
                categoryName: 'Vorsorge',
                date: checkupSlot.date,
                startTime: checkupSlot.startTime,
                endTime: checkupSlot.endTime,
                reason: 'Check-up',
              },
            },
          }
        : {}),
    },
    {
      date: today,
      time: '08:47',
      minutes: 2,
      status: 'completed',
      callerNumber: '+4915112345602',
      summary: 'Rezeptwunsch: Ramipril, Metformin.',
      lines: [
        ['assistant', greeting],
        ['caller', 'Ich brauche ein neues Rezept für meine Tabletten.'],
        ['assistant', 'Gern. Welche Medikamente benötigen Sie?'],
        ['caller', 'Ramipril fünf Milligramm und Metformin tausend.'],
        ['assistant', 'Danke. Nennen Sie mir bitte Vorname, Nachname und Geburtsdatum.'],
        ['caller', 'Dieter Kowalski, 19. Januar 1949.'],
        ['assistant', 'Der Rezeptwunsch ist notiert. Die Praxis prüft ihn.'],
      ],
      inquiry: {
        patient: { firstName: 'Dieter', lastName: 'Kowalski', dateOfBirth: '1949-01-19' },
        details: {
          type: 'prescription',
          medications: [
            { name: 'Ramipril', strength: '5 mg' },
            { name: 'Metformin', strength: '1000 mg' },
          ],
        },
      },
    },
    {
      date: today,
      time: '09:20',
      minutes: 1,
      status: 'transferred',
      callerNumber: '+4930123456703',
      summary: 'Verbunden: Frage zu einer Überweisung zum Kardiologen.',
      lines: [
        ['assistant', greeting],
        ['caller', 'Ich habe eine Frage zu meiner Überweisung zum Kardiologen.'],
        ['assistant', 'Einen Moment bitte, ich verbinde Sie mit der Praxis.'],
      ],
      inquiry: {
        patient: { lastName: 'Yilmaz' },
        details: {
          type: 'other',
          summary: 'Frage zu einer Überweisung zum Kardiologen.',
          transferred: true,
        },
        status: 'done',
      },
    },
    {
      date: today,
      time: '09:58',
      minutes: 1,
      status: 'emergency',
      summary: 'Notfall erkannt, auf den Notruf 112 verwiesen.',
      lines: [
        ['assistant', greeting],
        ['caller', 'Mein Mann hat plötzlich starke Schmerzen in der Brust und bekommt kaum Luft.'],
        [
          'assistant',
          'Das klingt nach einem Notfall. Bitte legen Sie jetzt auf und wählen Sie sofort den Notruf 112.',
        ],
      ],
    },
    {
      date: today,
      time: '10:31',
      minutes: 1,
      status: 'abandoned',
      callerNumber: '+4917012345605',
      summary: 'Kein Anliegen aufgenommen.',
      lines: [['assistant', greeting]],
    },
    {
      date: yesterday,
      time: '18:40',
      minutes: 2,
      status: 'completed',
      callerNumber: '+4916212345606',
      summary: 'Rückrufbitte: Befund der Blutuntersuchung besprechen.',
      lines: [
        ['assistant', greeting],
        ['caller', 'Ich wollte nach meinen Blutwerten fragen.'],
        ['assistant', 'Dazu notiere ich gern eine Rückrufbitte. Wie ist Ihr Name?'],
        ['caller', 'Petra Lindner, Sie erreichen mich unter dieser Nummer.'],
        ['assistant', 'Die Rückrufbitte ist notiert.'],
      ],
      inquiry: {
        patient: { firstName: 'Petra', lastName: 'Lindner', phone: '+4916212345606' },
        details: {
          type: 'callback',
          topic: 'Befund der Blutuntersuchung besprechen.',
          preferredTime: 'vormittags',
        },
      },
    },
  ];

  const expiresAt = expiryAfterDays(90);
  for (const [index, demo] of demoCalls.entries()) {
    const startedAt = fromZoned(demo.date, demo.time, TIME_ZONE);
    const callId = `demo-call-${index + 1}`;
    const inquiryId = `demo-inquiry-${index + 1}`;
    const state = { mode: demo.date === yesterday ? ('closed' as const) : ('open' as const) };
    const call: Call = {
      id: callId,
      practiceId: DEMO_PRACTICE_ID,
      channel: 'phone',
      status: demo.status,
      date: demo.date,
      startedAt: startedAt.toISOString(),
      endedAt: new Date(startedAt.getTime() + demo.minutes * 60_000).toISOString(),
      openingMode: state.mode,
      presetId: state.mode,
      summary: demo.summary,
      inquiryIds: demo.inquiry ? [inquiryId] : [],
      ...(demo.callerNumber ? { callerNumber: demo.callerNumber } : {}),
    };
    await calls.putCall(call, expiresAt);
    for (const [seq, [role, text]] of demo.lines.entries()) {
      const at = new Date(startedAt.getTime() + seq * 12_000).toISOString();
      await calls.appendTurn(callId, { seq: seq + 1, role, text, at }, expiresAt);
    }
    if (demo.inquiry) {
      const { details } = demo.inquiry;
      await calls.putInquiry(
        {
          id: inquiryId,
          practiceId: DEMO_PRACTICE_ID,
          status: demo.inquiry.status ?? 'new',
          date: demo.date,
          createdAt: call.endedAt ?? call.startedAt,
          updatedAt: call.endedAt ?? call.startedAt,
          callId,
          patient: demo.inquiry.patient,
          details,
          test: false,
        },
        expiresAt,
      );
      if (details.type === 'appointment' && checkupSlot) {
        await slots.changeStatus(DEMO_PRACTICE_ID, checkupSlot, 'booked', inquiryId);
      }
    }
  }
}
