import { toZoned } from '@callisto/domain';
import { Link } from '@tanstack/react-router';
import { TriangleAlert } from 'lucide-react';
import { useConfig, useConflicts, useStatus } from '../../app/queries';
import { formatDateRange, formatLongDate, formatShortDay } from '../../lib/format';
import { refreshCommand } from '../../shell/commands';
import { ViewFrame } from '../../shell/ViewFrame';
import { QueryState } from '../../ui/QueryState';

const MODE_TEXT = {
  open: 'Die Praxis ist geöffnet',
  closed: 'Die Praxis ist geschlossen',
  holiday: 'Heute ist ein Feiertag',
  vacation: 'Die Praxis ist geschlossen',
} as const;

/** The state of the practice at a glance. Calls and inquiries of the day will be added here. */
export function OverviewView() {
  const status = useStatus();
  const config = useConfig();
  const conflicts = useConflicts().data ?? [];

  if (!status.data || !config.data) {
    return (
      <ViewFrame title="Übersicht">
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
      title="Übersicht"
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
          <h2 className="card__title">Jetzt</h2>
          <p className="overview__headline">
            <span className={`dot dot--${state.mode === 'open' ? 'success' : 'warning'}`} />
            {MODE_TEXT[state.mode]}
          </p>
          <dl className="props">
            <dt>Datum</dt>
            <dd>{formatLongDate(state.localDate)}</dd>
            {state.holiday && (
              <>
                <dt>Feiertag</dt>
                <dd>{state.holiday.name}</dd>
              </>
            )}
            {state.closure && (
              <>
                <dt>Grund</dt>
                <dd>{state.closure.title}</dd>
              </>
            )}
            <dt>Heute geöffnet</dt>
            <dd>
              {state.todayRanges.length > 0
                ? state.todayRanges.map((range) => `${range.from} – ${range.to} Uhr`).join(', ')
                : 'Geschlossen'}
            </dd>
            {state.nextOpening && (
              <>
                <dt>Nächste Öffnung</dt>
                <dd>
                  {state.nextOpening.date === state.localDate
                    ? 'Heute'
                    : formatShortDay(state.nextOpening.date)}{' '}
                  um {state.nextOpening.from} Uhr
                </dd>
              </>
            )}
          </dl>
        </section>

        <section className="card">
          <h2 className="card__title">Was der Assistent gerade sagt</h2>
          <dl className="props">
            <dt>Begrüßung</dt>
            <dd>{settings.greeting}</dd>
            <dt>Ansage</dt>
            <dd>
              {preset?.name ?? 'Unbekannt'}
              {preset?.announcement ? `: ${preset.announcement}` : ''}
            </dd>
            <dt>Erlaubt</dt>
            <dd>
              {preset
                ? [
                    preset.capabilities.appointments && 'Termine vergeben',
                    preset.capabilities.prescriptions && 'Rezeptwünsche aufnehmen',
                    preset.capabilities.callbacks && 'Rückrufe notieren',
                    preset.capabilities.transfer && 'Zur Praxis verbinden',
                  ]
                    .filter(Boolean)
                    .join(', ') || 'Nur Auskunft'
                : '–'}
            </dd>
          </dl>
        </section>

        {conflicts.length > 0 && (
          <div className="notice overview__wide">
            <TriangleAlert />
            <div>
              <strong>
                {conflicts.length === 1
                  ? 'Ein gebuchter Termin liegt'
                  : `${conflicts.length} gebuchte Termine liegen`}{' '}
                in einer Schließzeit oder an einem Feiertag.
              </strong>{' '}
              Bitte nehmen Sie Kontakt mit den Patienten auf.{' '}
              <Link to="/kalender">Zum Kalender</Link>
            </div>
          </div>
        )}

        <section className="card overview__wide">
          <h2 className="card__title">Kommende Schließzeiten</h2>
          {upcoming.length > 0 ? (
            <dl className="props">
              {upcoming.map((closure) => (
                <div key={closure.id} style={{ display: 'contents' }}>
                  <dt>{formatDateRange(closure.from, closure.to)}</dt>
                  <dd>
                    {closure.title}
                    {closure.allDay ? '' : ` (${closure.fromTime} – ${closure.toTime} Uhr)`}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="card__empty">Es sind keine Schließzeiten eingetragen.</p>
          )}
        </section>
      </div>
    </ViewFrame>
  );
}
