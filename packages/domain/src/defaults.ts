import type { FederalState } from './holidays';
import type { AnnouncementPreset, OpeningHours, PracticeSettings } from './practice';

const EMERGENCY_SERVICE_HINT =
  'In dringenden Fällen erreichen Sie den ärztlichen Bereitschaftsdienst unter der 116 117.';

/** Presets every practice starts with; they can be edited but give a sensible first setup. */
export const DEFAULT_PRESETS: AnnouncementPreset[] = [
  {
    id: 'open',
    name: 'Sprechzeit',
    announcement: '',
    capabilities: { appointments: true, prescriptions: true, callbacks: true, transfer: true },
  },
  {
    id: 'closed',
    name: 'Außerhalb der Sprechzeiten',
    announcement: `Unsere Praxis ist im Moment geschlossen. ${EMERGENCY_SERVICE_HINT} Termine und Rezeptwünsche nehme ich gerne trotzdem für Sie auf.`,
    capabilities: { appointments: true, prescriptions: true, callbacks: true, transfer: false },
  },
  {
    id: 'holiday',
    name: 'Feiertag',
    announcement: `Heute ist ein Feiertag, unsere Praxis ist geschlossen. ${EMERGENCY_SERVICE_HINT} Termine und Rezeptwünsche nehme ich gerne trotzdem für Sie auf.`,
    capabilities: { appointments: true, prescriptions: true, callbacks: true, transfer: false },
  },
  {
    id: 'vacation',
    name: 'Urlaub',
    announcement: `Unsere Praxis ist zurzeit im Urlaub. ${EMERGENCY_SERVICE_HINT} Termine für die Zeit danach und Rezeptwünsche nehme ich gerne für Sie auf.`,
    capabilities: { appointments: true, prescriptions: true, callbacks: true, transfer: false },
  },
];

export const DEFAULT_OPENING_HOURS: OpeningHours = {
  mon: [
    { from: '08:00', to: '12:00' },
    { from: '15:00', to: '18:00' },
  ],
  tue: [
    { from: '08:00', to: '12:00' },
    { from: '15:00', to: '18:00' },
  ],
  wed: [{ from: '08:00', to: '12:00' }],
  thu: [
    { from: '08:00', to: '12:00' },
    { from: '15:00', to: '18:00' },
  ],
  fri: [{ from: '08:00', to: '12:00' }],
  sat: [],
  sun: [],
};

export function defaultPracticeSettings(
  name: string,
  federalState: FederalState,
): PracticeSettings {
  return {
    name,
    timeZone: 'Europe/Berlin',
    federalState,
    greeting: `Guten Tag, hier ist der digitale Assistent der ${name}. Ich bin ein KI-Assistent und nehme Ihr Anliegen gerne auf.`,
    presetAssignments: { open: 'open', closed: 'closed', holiday: 'holiday', vacation: 'vacation' },
    bookingHorizonDays: 56,
    bookingLeadMinutes: 120,
    retention: { transcriptDays: 90, inquiryDays: 180 },
  };
}
