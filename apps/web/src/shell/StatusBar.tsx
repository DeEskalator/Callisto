import { useIsFetching } from '@tanstack/react-query';
import { useMe, useStatus } from '../app/queries';
import { formatShortDay } from '../lib/format';
import { useActiveView } from './commands';

type Status = NonNullable<ReturnType<typeof useStatus>['data']>;

function openingText(status: Status): { tone: string; text: string } {
  const next = status.nextOpening;
  const reopening = next
    ? next.date === status.localDate
      ? `öffnet um ${next.from} Uhr`
      : `öffnet ${formatShortDay(next.date)} um ${next.from} Uhr`
    : 'kein Öffnungstermin in Sicht';

  switch (status.mode) {
    case 'open':
      return {
        tone: 'success',
        text: `Praxis geöffnet bis ${status.currentPeriod?.to ?? ''} Uhr`,
      };
    case 'vacation':
      return {
        tone: 'warning',
        text: `${status.closure?.title ?? 'Geschlossen'} · ${reopening}`,
      };
    case 'holiday':
      return { tone: 'warning', text: `${status.holiday?.name ?? 'Feiertag'} · ${reopening}` };
    default:
      return { tone: 'danger', text: `Praxis geschlossen · ${reopening}` };
  }
}

/** The bar at the bottom of the window: practice status, state of the view, who is signed in. */
export function StatusBar() {
  const status = useStatus().data;
  const me = useMe().data;
  const view = useActiveView();
  const loading = useIsFetching() > 0;
  const opening = status ? openingText(status) : undefined;

  return (
    <footer className="statusbar">
      {opening && (
        <span className="statusbar__item" title="Was der Assistent Anrufern gerade sagt">
          <span className={`dot dot--${opening.tone}`} />
          {opening.text}
        </span>
      )}
      {view?.status && (
        <>
          <span className="statusbar__divider" />
          <span className="statusbar__item">{view.status}</span>
        </>
      )}
      <span className="statusbar__spacer" />
      {loading && <span className="statusbar__item">Wird geladen …</span>}
      {me && (
        <span className="statusbar__item">
          {me.profile.name} · {me.role.name}
        </span>
      )}
    </footer>
  );
}
