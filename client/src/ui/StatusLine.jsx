// The chat's waiting line and its error. The status region is always rendered, so a screen reader hears each
// change of its text; the error is an alert, announced when it appears, with its action (`children`) after it.
export default function StatusLine({ status, alert, children }) {
  return (
    <>
      <p role="status" className="text-sm text-muted">{status}</p>
      {alert && <p role="alert" className="notice notice-danger text-sm">{alert}{children && ' '}{children}</p>}
    </>
  );
}
