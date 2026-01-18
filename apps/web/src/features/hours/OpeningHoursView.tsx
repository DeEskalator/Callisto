import {
  germanHolidays,
  type OpeningHours,
  OpeningHoursSchema,
  type TimeRange,
  toZoned,
  WEEKDAYS,
  type Weekday,
} from '@callisto/domain';
import { Link } from '@tanstack/react-router';
import { Plus, X } from 'lucide-react';
import { useApi } from '../../app/api';
import { useConfig, useHasPermission, useInvalidatePlanning } from '../../app/queries';
import { formatShortDay, WEEKDAY_NAMES } from '../../lib/format';
import { discardCommand, saveCommand } from '../../shell/commands';
import { ViewFrame } from '../../shell/ViewFrame';
import { QueryState } from '../../ui/QueryState';
import { useEditablePage } from '../../ui/useEditablePage';

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

  const setDay = (weekday: Weekday, ranges: TimeRange[]) =>
    page.replace({ ...hours, [weekday]: ranges });
  const addRange = (weekday: Weekday) => {
    // Continue after the last period of the day, or start with a usual morning.
    const last = hours[weekday].at(-1);
    const range = last ? { from: '15:00', to: '18:00' } : { from: '08:00', to: '12:00' };
    setDay(weekday, [...hours[weekday], range]);
  };

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
        saveCommand(page.save, !page.dirty || page.saving || !canManage),
        discardCommand(page.discard, !page.dirty),
      ]}
    >
      <p className="view__intro">
        In diesen Zeiten ist die Praxis telefonisch erreichbar. Der Assistent verbindet nur dann mit
        dem Praxisteam und sagt außerhalb dieser Zeiten die dafür hinterlegte Ansage an.
      </p>

      <fieldset className="hours" disabled={!canManage}>
        {WEEKDAYS.map((weekday) => {
          const ranges = hours[weekday];
          const error = Object.entries(page.errors).find(([path]) => path.startsWith(weekday))?.[1];
          return (
            <div key={weekday} className="hours__day">
              <div className="hours__name">{WEEKDAY_NAMES[weekday]}</div>
              <div className="hours__ranges">
                {ranges.length === 0 && <span className="hours__closed">Geschlossen</span>}
                {ranges.map((range, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: periods have no identity besides their position
                  <span key={index} className="hours__range">
                    <input
                      type="time"
                      className="input input--tiny"
                      aria-label={`${WEEKDAY_NAMES[weekday]}, Zeitraum ${index + 1}, von`}
                      value={range.from}
                      onChange={(event) =>
                        setDay(
                          weekday,
                          ranges.map((each, at) =>
                            at === index ? { ...each, from: event.target.value } : each,
                          ),
                        )
                      }
                    />
                    –
                    <input
                      type="time"
                      className="input input--tiny"
                      aria-label={`${WEEKDAY_NAMES[weekday]}, Zeitraum ${index + 1}, bis`}
                      value={range.to}
                      onChange={(event) =>
                        setDay(
                          weekday,
                          ranges.map((each, at) =>
                            at === index ? { ...each, to: event.target.value } : each,
                          ),
                        )
                      }
                    />
                    <button
                      type="button"
                      className="btn btn--ghost btn--icon"
                      aria-label={`${WEEKDAY_NAMES[weekday]}, Zeitraum ${index + 1} entfernen`}
                      title="Zeitraum entfernen"
                      onClick={() =>
                        setDay(
                          weekday,
                          ranges.filter((_, at) => at !== index),
                        )
                      }
                    >
                      <X />
                    </button>
                  </span>
                ))}
                <button type="button" className="btn btn--ghost" onClick={() => addRange(weekday)}>
                  <Plus />
                  Zeitraum
                </button>
              </div>
              {error && (
                <div className="hours__error" role="alert">
                  {error}
                </div>
              )}
            </div>
          );
        })}
      </fieldset>

      <section className="card hours__holidays">
        <h2 className="card__title">Feiertage</h2>
        <p>
          An gesetzlichen Feiertagen gilt die Praxis automatisch als geschlossen. Die nächsten sind:{' '}
          {upcomingHolidays
            .map((holiday) => `${holiday.name} (${formatShortDay(holiday.date)})`)
            .join(', ')}
          . Das Bundesland legen Sie unter <Link to="/praxis">Praxis</Link> fest, Urlaub und
          Brückentage unter <Link to="/schliesszeiten">Urlaub &amp; Schließzeiten</Link>.
        </p>
      </section>
    </ViewFrame>
  );
}
