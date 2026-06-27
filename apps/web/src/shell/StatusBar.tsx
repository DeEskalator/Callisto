import { useIsFetching } from '@tanstack/react-query';
import { useMe, useStatus } from '../app/queries';
import { formatShortDay } from '../lib/format';
import { localized } from '../lib/i18n';
import { useActiveView } from './commands';

type Status = NonNullable<ReturnType<typeof useStatus>['data']>;

const t = localized({
  de: {
    opensToday: (time: string) => `öffnet um ${time} Uhr`,
    opensOn: (day: string, time: string) => `öffnet ${day} um ${time} Uhr`,
    noOpening: 'kein Öffnungstermin in Sicht',
    openUntil: (time: string) => `Praxis geöffnet bis ${time} Uhr`,
    closed: 'Geschlossen',
    holiday: 'Feiertag',
    practiceClosed: 'Praxis geschlossen',
    statusHint: 'Was der Assistent Anrufern gerade sagt',
    loading: 'Wird geladen …',
  },
  en: {
    opensToday: (time: string) => `opens at ${time}`,
    opensOn: (day: string, time: string) => `opens ${day} at ${time}`,
    noOpening: 'no opening in sight',
    openUntil: (time: string) => `Practice open until ${time}`,
    closed: 'Closed',
    holiday: 'Public holiday',
    practiceClosed: 'Practice closed',
    statusHint: 'What the assistant is telling callers right now',
    loading: 'Loading …',
  },
});

function openingText(status: Status): { tone: string; text: string } {
  const next = status.nextOpening;
  const reopening = next
    ? next.date === status.localDate
      ? t.opensToday(next.from)
      : t.opensOn(formatShortDay(next.date), next.from)
    : t.noOpening;

  switch (status.mode) {
    case 'open':
      return { tone: 'success', text: t.openUntil(status.currentPeriod?.to ?? '') };
    case 'vacation':
      return { tone: 'warning', text: `${status.closure?.title ?? t.closed} · ${reopening}` };
    case 'holiday':
      return { tone: 'warning', text: `${status.holiday?.name ?? t.holiday} · ${reopening}` };
    default:
      return { tone: 'danger', text: `${t.practiceClosed} · ${reopening}` };
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
        <span className="statusbar__item" title={t.statusHint}>
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
      {loading && <span className="statusbar__item">{t.loading}</span>}
      {me && (
        <span className="statusbar__item">
          {me.profile.name} · {me.role.name}
        </span>
      )}
    </footer>
  );
}
