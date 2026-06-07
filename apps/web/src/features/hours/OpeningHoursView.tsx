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
import { discardCommand, saveCommand } from '../../shell/commands';
import { ViewFrame } from '../../shell/ViewFrame';
import { QueryState } from '../../ui/QueryState';
import { useEditablePage } from '../../ui/useEditablePage';
import { HoursGrid, type Resolution } from './HoursGrid';

/** The regular weekly opening hours of the practice. */
export function OpeningHoursView() {
  const config = useConfig();
  if (!config.data) {
    return (
      <ViewFrame title="Sprechzeiten">
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
    savedMessage: 'Die Sprechzeiten wurden gespeichert',
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
      title="Sprechzeiten"
      padded
      status={page.dirty ? 'Ungespeicherte Änderungen' : undefined}
      commands={[
        {
          id: 'undo',
          label: 'Rückgängig',
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
          <span className="toolbar__label">Raster</span>
          {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would bring its own frame into the toolbar */}
          <div className="segmented" role="group" aria-label="Raster">
            <button type="button" aria-pressed={resolution === 1} onClick={() => setResolution(1)}>
              30 Min.
            </button>
            <button type="button" aria-pressed={resolution === 2} onClick={() => setResolution(2)}>
              1 Std.
            </button>
          </div>
        </div>
      }
    >
      <p className="view__intro">
        In diesen Zeiten ist die Praxis telefonisch erreichbar. Der Assistent verbindet nur dann mit
        dem Praxisteam und sagt außerhalb dieser Zeiten die dafür hinterlegte Ansage an. Ziehen Sie
        über das Raster, um Zeiten zu öffnen oder zu schließen.
      </p>

      <HoursGrid value={hours} onChange={change} resolution={resolution} disabled={!canManage} />
      {errors.length > 0 && (
        <div className="hours-grid__errors" role="alert">
          {errors.map((error) => (
            <div key={error}>{error}</div>
          ))}
        </div>
      )}

      <section className="card hours__holidays">
        <h2 className="card__title">Feiertage</h2>
        <p>
          An gesetzlichen Feiertagen gilt die Praxis automatisch als geschlossen. Die nächsten sind:{' '}
          {upcomingHolidays
            .map((holiday) => `${holiday.name} (${formatShortDay(holiday.date)})`)
            .join(', ')}
          . Das Bundesland legen Sie unter <Link to="/einstellungen/praxis">Praxis</Link> fest,
          Urlaub und Brückentage unter{' '}
          <Link to="/einstellungen/schliesszeiten">Urlaub &amp; Schließzeiten</Link>.
        </p>
      </section>
    </ViewFrame>
  );
}
