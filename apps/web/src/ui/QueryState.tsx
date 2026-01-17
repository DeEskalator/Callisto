import { errorMessage } from '../app/api';

/** What a view shows instead of its content while its data is loading or could not be loaded. */
export function QueryState(props: {
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
}) {
  const { query } = props;
  if (query.isPending) {
    return (
      <div className="view__state" role="status">
        <div className="spinner" />
        Wird geladen …
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="view__state" role="alert">
        {errorMessage(query.error)}
        <button type="button" className="btn" onClick={() => query.refetch()}>
          Erneut versuchen
        </button>
      </div>
    );
  }
  return null;
}
