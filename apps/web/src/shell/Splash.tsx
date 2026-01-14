/** A full-window message for the moments before the application is usable. */
export function Splash(props: {
  title: string;
  text?: string;
  busy?: boolean;
  action?: { label: string; run: () => void };
}) {
  return (
    <div className="splash" role={props.busy ? 'status' : 'alert'}>
      {props.busy && <div className="spinner" />}
      <h1 className="splash__title">{props.title}</h1>
      {props.text && <p className="splash__text">{props.text}</p>}
      {props.action && (
        <button type="button" className="btn btn--primary" onClick={props.action.run}>
          {props.action.label}
        </button>
      )}
    </div>
  );
}
