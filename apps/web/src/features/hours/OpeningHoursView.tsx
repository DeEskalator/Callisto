import {
  germanHolidays,
  type OpeningHours,
  OpeningHoursSchema,
  toZoned,
  type Weekday,
} from '@callisto/domain';
import { Link } from '@tanstack/react-router';
import { Undo } from 'lucide-react';
import { useState } from 'react';
import { useApi } from '../../app/api';
import { useConfig, useHasPermission, useInvalidatePlanning } from '../../app/queries';
import { formatShortDay, WEEKDAY_NAMES } from '../../lib/format';
import { localized } from '../../lib/i18n';
import { discardCommand, saveCommand } from '../../shell/commands';
import { ViewFrame } from '../../shell/ViewFrame';
import { QueryState } from '../../ui/QueryState';
import { useEditablePage } from '../../ui/useEditablePage';
import { HoursGrid, type Resolution } from './HoursGrid';

const t = localized({
  de: {
    title: 'Sprechzeiten',
    saved: 'Die Sprechzeiten wurden gespeichert',
    unsaved: 'Ungespeicherte Änderungen',
    undo: 'Rückgängig',
    grid: 'Raster',
    halfHour: '30 Min.',
    hour: '1 Std.',
    intro:
      'In diesen Zeiten ist die Praxis telefonisch erreichbar. Der Assistent verbindet nur dann mit dem Praxisteam und sagt außerhalb dieser Zeiten die dafür hinterlegte Ansage an. Ziehen Sie über das Raster, um Zeiten zu öffnen oder zu schließen.',
    holidays: 'Feiertage',
    holidaysText:
      'An gesetzlichen Feiertagen gilt die Praxis automatisch als geschlossen. Die nächsten sind:',
    federalStateIn: 'Das Bundesland legen Sie unter',
    practice: 'Praxis',
    vacationIn: ' fest, Urlaub und Brückentage unter',
    closures: 'Urlaub & Schließzeiten',
  },
  en: {
    title: 'Opening hours',
    saved: 'The opening hours were saved',
    unsaved: 'Unsaved changes',
    undo: 'Undo',
    grid: 'Grid',
    halfHour: '30 min',
    hour: '1 hr',
    intro:
      'During these hours the practice can be reached by phone. Only then does the assistant put callers through to the practice team; outside of them it plays the announcement set up for that. Drag across the grid to open or close times.',
    holidays: 'Public holidays',
    holidaysText:
      'On public holidays the practice counts as closed automatically. The next ones are:',
    federalStateIn: 'You set the federal state under',
    practice: 'Practice',
    vacationIn: ', vacation and bridge days under',
    closures: 'Vacation & closures',
  },
});

/** The regular weekly opening hours of the practice. */
export function OpeningHoursView() {
  const config = useConfig();
  if (!config.data) {
    return (
      <ViewFrame title={t.title}>
        <QueryState query={config} />
      </ViewFrame>
    );
  }
  return <OpeningHoursEditor hours={config.data.hours} settings={config.data.settings} />;
}

function OpeningHoursEditor(props: {
  hours: OpeningHours;
  settings: { federalState: Parameters<typeof germanHolidays>[1]; timeZone: string };
}) {
  const api = useApi();
  const invalidate = useInvalidatePlanning();
  const canManage = useHasPermission('settings.manage');

  const page = useEditablePage({
    server: props.hours,
    schema: OpeningHoursSchema,
    save: async (hours) => {
      await api.admin['opening-hours'].$put({ json: hours });
      await invalidate();
    },
    savedMessage: t.saved,
  });
  const hours = page.value;

  const [resolution, setResolution] = useState<Resolution>(1);
  // Every drag is one step back; saving or discarding starts over.
  const [history, setHistory] = useState<OpeningHours[]>([]);
  const change = (next: OpeningHours) => {
    setHistory([...history.slice(-49), hours]);
    page.replace(next);
  };
  const undo = () => {
    const previous = history.at(-1);
    if (previous) {
      setHistory(history.slice(0, -1));
      page.replace(previous);
    }
  };
  const errors = [
    ...new Set(
      Object.entries(page.errors).map(
        ([path, message]) => `${WEEKDAY_NAMES[path.split('.')[0] as Weekday] ?? ''}: ${message}`,
      ),
    ),
  ];

  const today = toZoned(new Date(), props.settings.timeZone).date;
  const year = Number(today.slice(0, 4));
  const upcomingHolidays = [year, year + 1]
    .flatMap((each) => germanHolidays(each, props.settings.federalState))
    .filter((holiday) => holiday.date >= today)
    .slice(0, 4);

  return (
    <ViewFrame
      title={t.title}
      padded
      status={page.dirty ? t.unsaved : undefined}
      commands={[
        {
          id: 'undo',
          label: t.undo,
          icon: Undo,
          shortcut: { key: 'z', alt: true },
          disabled: history.length === 0 || !page.dirty,
          run: undo,
        },
        saveCommand(page.save, !page.dirty || page.saving || !canManage),
        discardCommand(() => {
          setHistory([]);
          page.discard();
        }, !page.dirty),
      ]}
      toolbarEnd={
        <div className="toolbar__nav">
          <span className="toolbar__label">{t.grid}</span>
          {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would bring its own frame into the toolbar */}
          <div className="segmented" role="group" aria-label={t.grid}>
            <button type="button" aria-pressed={resolution === 1} onClick={() => setResolution(1)}>
              {t.halfHour}
            </button>
            <button type="button" aria-pressed={resolution === 2} onClick={() => setResolution(2)}>
              {t.hour}
            </button>
          </div>
        </div>
      }
    >
      <p className="view__intro">{t.intro}</p>

      <HoursGrid value={hours} onChange={change} resolution={resolution} disabled={!canManage} />
      {errors.length > 0 && (
        <div className="hours-grid__errors" role="alert">
          {errors.map((error) => (
            <div key={error}>{error}</div>
          ))}
        </div>
      )}

      <section className="card hours__holidays">
        <h2 className="card__title">{t.holidays}</h2>
        <p>
          {t.holidaysText}{' '}
          {upcomingHolidays
            .map((holiday) => `${holiday.name} (${formatShortDay(holiday.date)})`)
            .join(', ')}
          . {t.federalStateIn} <Link to="/einstellungen/praxis">{t.practice}</Link>
          {t.vacationIn} <Link to="/einstellungen/schliesszeiten">{t.closures}</Link>.
        </p>
      </section>
    </ViewFrame>
  );
}
