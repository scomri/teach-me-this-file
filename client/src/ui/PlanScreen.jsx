import { estimatedMinutes, requestNotes, sourcePages } from '../plan.js';

// The file does not cover the request: no plan, one way forward. The note is model-written.
export function NoCoverage({ coverageNote, busy, onPlanWholeFile }) {
  return (
    <div role="alert" className="mt-6 notice notice-warning p-3 text-sm">
      <p className="font-medium">This file doesn't cover your request.</p>
      <p dir="auto" className="mt-1">{coverageNote}</p>
      <button className="btn btn-primary mt-3" onClick={onPlanWholeFile} disabled={busy}>
        Plan from whole file
      </button>
    </div>
  );
}

// Read-only view of a plan (with its coverage) and the constraints it was made under. The text is
// model-written, so each element gets its own direction.
export default function PlanScreen({ plan, constraints, doc, busy, onRegenerate, onStart, startAllowed, onValidate, needsValidation, noKey }) {
  const { coverage, coverageNote } = plan;
  const facts = [constraints.language, constraints.audience, constraints.style].filter(Boolean);
  const notes = requestNotes(plan, constraints);
  return (
    <article className="mt-6">
      <h2 dir="auto" className="heading text-xl">{plan.title}</h2>
      <p className="mt-1 text-sm text-muted">
        {plan.steps.length} {plan.steps.length === 1 ? 'step' : 'steps'} · about {estimatedMinutes(plan)} min
        {facts.length > 0 && ` · ${facts.join(' · ')}`}
      </p>
      {coverage === 'partial' && (
        <p role="note" dir="auto" className="mt-2 notice notice-warning text-sm">
          Not in the file: {coverageNote}
        </p>
      )}
      {notes.map((note) => (
        <p key={note} role="note" className="card mt-2 bg-canvas p-2 text-sm">{note}</p>
      ))}

      <ol className="mt-4 space-y-4">
        {plan.steps.map((step, i) => {
          const pages = sourcePages(step, doc);
          return (
            <li key={step.id} className="card p-3">
              <h3 dir="auto" className="font-medium">{i + 1}. {step.title}</h3>
              <p dir="auto" className="mt-1 text-sm">{step.objective}</p>
              <p dir="auto" className="mt-2 text-sm"><span className="font-medium">Check question:</span> {step.checkQuestion}</p>
              <p className="mt-2 text-sm font-medium">Expected points</p>
              <ul dir="auto" className="list-disc ps-5 text-sm">
                {step.expected.map((point, j) => <li key={j}>{point}</li>)}
              </ul>
              {pages && <p className="mt-2 text-xs text-muted">Source: {pages}</p>}
            </li>
          );
        })}
      </ol>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button className="btn btn-secondary" onClick={onRegenerate} disabled={busy}>
          Regenerate
        </button>
        {needsValidation && <button className="btn btn-secondary" onClick={onValidate} disabled={busy || noKey}>Check plan</button>}
        {!needsValidation && <button className="btn btn-primary" onClick={onStart} disabled={busy || !startAllowed}>
          Start
        </button>}
      </div>
    </article>
  );
}
