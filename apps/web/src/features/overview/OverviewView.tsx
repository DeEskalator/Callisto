import { toZoned } from '@callisto/domain';
import { Link } from '@tanstack/react-router';
import { TriangleAlert } from 'lucide-react';
import { useConfig, useConflicts, useStatus } from '../../app/queries';
import { formatDateRange, formatLongDate, formatShortDay } from '../../lib/format';
import { localized } from '../../lib/i18n';
import { refreshCommand } from '../../shell/commands';
import { ViewFrame } from '../../shell/ViewFrame';
import { QueryState } from '../../ui/QueryState';

const t = localized({
  de: {
    modes: {
      open: 'Die Praxis ist geöffnet',
      closed: 'Die Praxis ist geschlossen',
      holiday: 'Heute ist ein Feiertag',
      vacation: 'Die Praxis ist geschlossen',
    },
    title: 'Status',
    now: 'Jetzt',
    date: 'Datum',
    holiday: 'Feiertag',
    reason: 'Grund',
    openToday: 'Heute geöffnet',
    timeRange: (from: string, to: string) => `${from} – ${to} Uhr`,
    closed: 'Geschlossen',
    nextOpening: 'Nächste Öffnung',
    today: 'Heute',
    at: (time: string) => `um ${time} Uhr`,
    saying: 'Was der Assistent gerade sagt',
    greeting: 'Begrüßung',
    announcement: 'Ansage',
    unknown: 'Unbekannt',
    allowed: 'Erlaubt',
    appointments: 'Termine vergeben',
    prescriptions: 'Rezeptwünsche aufnehmen',
    callbacks: 'Rückrufe notieren',
    transfer: 'Zur Praxis verbinden',
    infoOnly: 'Nur Auskunft',
    conflicts: (count: number) =>
      `${count === 1 ? 'Ein gebuchter Termin liegt' : `${count} gebuchte Termine liegen`} in einer Schließzeit oder an einem Feiertag.`,
    contact: 'Bitte nehmen Sie Kontakt mit den Patienten auf.',
    toCalendar: 'Zum Kalender',
    upcoming: 'Kommende Schließzeiten',
    noClosures: 'Es sind keine Schließzeiten eingetragen.',
  },
  en: {
    modes: {
      open: 'The practice is open',
      closed: 'The practice is closed',
      holiday: 'Today is a public holiday',
      vacation: 'The practice is closed',
    },
    title: 'Status',
    now: 'Now',
    date: 'Date',
    holiday: 'Public holiday',
    reason: 'Reason',
    openToday: 'Open today',
    timeRange: (from: string, to: string) => `${from} – ${to}`,
    closed: 'Closed',
    nextOpening: 'Next opening',
    today: 'Today',
    at: (time: string) => `at ${time}`,
    saying: 'What the assistant is saying right now',
    greeting: 'Greeting',
    announcement: 'Announcement',
    unknown: 'Unknown',
    allowed: 'Allowed',
    appointments: 'Book appointments',
    prescriptions: 'Take prescription requests',
    callbacks: 'Note callbacks',
    transfer: 'Put through to the practice',
    infoOnly: 'Information only',
    conflicts: (count: number) =>
      `${count === 1 ? 'A booked appointment falls' : `${count} booked appointments fall`} into a closure or onto a public holiday.`,
    contact: 'Please get in touch with the patients.',
    toCalendar: 'Go to the calendar',
    upcoming: 'Upcoming closures',
    noClosures: 'No closures are entered.',
  },
});
const MODE_TEXT = t.modes;

/** The state of the practice at a glance. Calls and inquiries of the day will be added here. */
export function OverviewView() {
  const status = useStatus();
  const config = useConfig();
  const conflicts = useConflicts().data ?? [];

  if (!status.data || !config.data) {
    return (
      <ViewFrame title={t.title}>
        <QueryState query={status.data ? config : status} />
      </ViewFrame>
    );
  }

  const state = status.data;
  const { closures, presets, settings } = config.data;
  const today = toZoned(new Date(), settings.timeZone).date;
  const preset = presets.find((candidate) => candidate.id === state.presetId);
  const upcoming = closures.filter((closure) => closure.to >= today).slice(0, 5);

  return (
    <ViewFrame
      title={t.title}
      padded
      commands={[
        refreshCommand(() => {
          void status.refetch();
          void config.refetch();
        }),
      ]}
    >
      <div className="overview">
        <section className="card">
          <h2 className="card__title">{t.now}</h2>
          <p className="overview__headline">
            <span className={`dot dot--${state.mode === 'open' ? 'success' : 'warning'}`} />
            {MODE_TEXT[state.mode]}
          </p>
          <dl className="props">
            <dt>{t.date}</dt>
            <dd>{formatLongDate(state.localDate)}</dd>
            {state.holiday && (
              <>
                <dt>{t.holiday}</dt>
                <dd>{state.holiday.name}</dd>
              </>
            )}
            {state.closure && (
              <>
                <dt>{t.reason}</dt>
                <dd>{state.closure.title}</dd>
              </>
            )}
            <dt>{t.openToday}</dt>
            <dd>
              {state.todayRanges.length > 0
                ? state.todayRanges.map((range) => t.timeRange(range.from, range.to)).join(', ')
                : t.closed}
            </dd>
            {state.nextOpening && (
              <>
                <dt>{t.nextOpening}</dt>
                <dd>
                  {state.nextOpening.date === state.localDate
                    ? t.today
                    : formatShortDay(state.nextOpening.date)}{' '}
                  {t.at(state.nextOpening.from)}
                </dd>
              </>
            )}
          </dl>
        </section>

        <section className="card">
          <h2 className="card__title">{t.saying}</h2>
          <dl className="props">
            <dt>{t.greeting}</dt>
            <dd>{settings.greeting}</dd>
            <dt>{t.announcement}</dt>
            <dd>
              {preset?.name ?? t.unknown}
              {preset?.announcement ? `: ${preset.announcement}` : ''}
            </dd>
            <dt>{t.allowed}</dt>
            <dd>
              {preset
                ? [
                    preset.capabilities.appointments && t.appointments,
                    preset.capabilities.prescriptions && t.prescriptions,
                    preset.capabilities.callbacks && t.callbacks,
                    preset.capabilities.transfer && t.transfer,
                  ]
                    .filter(Boolean)
                    .join(', ') || t.infoOnly
                : '–'}
            </dd>
          </dl>
        </section>

        {conflicts.length > 0 && (
          <div className="notice overview__wide">
            <TriangleAlert />
            <div>
              <strong>{t.conflicts(conflicts.length)}</strong> {t.contact}{' '}
              <Link to="/einstellungen/kalender">{t.toCalendar}</Link>
            </div>
          </div>
        )}

        <section className="card overview__wide">
          <h2 className="card__title">{t.upcoming}</h2>
          {upcoming.length > 0 ? (
            <dl className="props">
              {upcoming.map((closure) => (
                <div key={closure.id} style={{ display: 'contents' }}>
                  <dt>{formatDateRange(closure.from, closure.to)}</dt>
                  <dd>
                    {closure.title}
                    {closure.allDay
                      ? ''
                      : ` (${t.timeRange(closure.fromTime ?? '', closure.toTime ?? '')})`}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="card__empty">{t.noClosures}</p>
          )}
        </section>
      </div>
    </ViewFrame>
  );
}
