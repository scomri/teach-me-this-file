// The app header: name, the step chip during a lesson, the settings pill (`children`) and New lesson.
// One line at every width: the name truncates first, and the pill and New lesson shorten below `sm`.
export default function Header({ lesson, onNewLesson, children }) {
  const { plan, progress } = lesson;
  const index = progress ? plan.steps.findIndex((s) => s.id === progress.current) : -1;
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-surface">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2 px-4 py-2">
        <p className="heading min-w-0 flex-1 basis-0 truncate">Teach Me This File</p>
        {progress && <p className="shrink-0 whitespace-nowrap text-sm text-muted">Step {index + 1} of {plan.steps.length}</p>}
        {children}
        {onNewLesson && <button type="button" className="btn btn-secondary min-h-11 shrink-0 text-sm" onClick={onNewLesson}>New<span className="max-sm:sr-only"> lesson</span></button>}
      </div>
    </header>
  );
}
