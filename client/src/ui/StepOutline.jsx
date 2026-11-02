import { useSyncExternalStore } from 'react';

// Each status has a word as well as a colour, so the outline reads the same without colour.
const LABELS = { mastered: 'Mastered', revealed: 'Answer shown', active: 'Current', pending: 'Upcoming' };

// The `md` breakpoint (index.css). Without matchMedia (tests) the outline takes its narrow shape.
const WIDE = '(min-width: 45rem)';
function subscribe(onChange) {
  const query = window.matchMedia?.(WIDE);
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}
const useWide = () => useSyncExternalStore(subscribe, () => window.matchMedia?.(WIDE).matches ?? false, () => false);

// The lesson's steps with their status, read from lesson state. Wide: an aside beside the reading column.
// Narrow: a disclosure whose summary is a segmented progress bar, one segment per step.
export default function StepOutline({ lesson }) {
  const { plan, progress } = lesson;
  const wide = useWide();
  const list = (
    <ol className="space-y-1">
      {plan.steps.map((step, i) => {
        const { status } = progress.steps[step.id];
        const current = step.id === progress.current;
        return (
          <li key={step.id} aria-current={current ? 'step' : undefined} className={`border-s-4 py-1 ps-3 ${current ? 'border-accent font-semibold' : 'border-transparent'}`}>
            <span dir="auto" title={step.title} className="block truncate">{step.title}</span>
            <span className="block text-xs font-normal text-muted">Step {i + 1} · {LABELS[status]}</span>
          </li>
        );
      })}
    </ol>
  );

  if (wide) {
    return (
      <aside aria-labelledby="outline-title" className="sticky top-20 min-w-0 self-start">
        <h2 id="outline-title" className="mb-2 text-sm font-semibold text-muted">Steps</h2>
        {list}
      </aside>
    );
  }
  const done = plan.steps.filter((s) => ['mastered', 'revealed'].includes(progress.steps[s.id].status)).length;
  return (
    <details className="card mb-4">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-3">
        <span aria-hidden="true" className="step-chevron">▸</span>
        <span className="flex flex-1 gap-1" aria-hidden="true">
          {plan.steps.map((s) => <span key={s.id} data-status={progress.steps[s.id].status} className={`step-segment step-segment-${progress.steps[s.id].status}`} />)}
        </span>
        <span className="shrink-0 text-sm text-muted">Steps: {done} of {plan.steps.length} done</span>
      </summary>
      <div className="border-t border-border p-3">{list}</div>
    </details>
  );
}
