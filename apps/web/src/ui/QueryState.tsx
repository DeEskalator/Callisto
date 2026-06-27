import { errorMessage } from '../app/api';
import { localized } from '../lib/i18n';

const t = localized({
  de: { loading: 'Wird geladen …', retry: 'Erneut versuchen' },
  en: { loading: 'Loading …', retry: 'Try again' },
});

/** What a view shows instead of its content while its data is loading or could not be loaded. */
export function QueryState(props: {
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
}) {
  const { query } = props;
  if (query.isPending) {
    return (
      <div className="view__state" role="status">
        <div className="spinner" />
        {t.loading}
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="view__state" role="alert">
        {errorMessage(query.error)}
        <button type="button" className="btn" onClick={() => query.refetch()}>
          {t.retry}
        </button>
      </div>
    );
  }
  return null;
}
