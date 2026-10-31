import { estimatedMinutes, requestNotes, sourcePages } from '../plan.js';

// The file does not cover the request: no plan, one way forward. The note is model-written.
export function NoCoverage({ coverageNote, busy, onPlanWholeFile }) {
  return (
    <div role="alert" className="mt-6 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="font-medium">This file doesn't cover your request.</p>
      <p dir="auto" className="mt-1">{coverageNote}</p>
      <button className="mt-3 rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-40" onClick={onPlanWholeFile} disabled={busy}>
        Plan from whole file
      </button>
    </div>
  );
}

// Read-only view of a plan (with its coverage) and the constraints it was made under. The text is
// model-written, so each element gets its own direction.
export default function PlanScreen({ plan, constraints, doc, busy, onRegenerate }) {
  const { coverage, coverageNote } = plan;
  const facts = [constraints.language, constraints.audience, constraints.style].filter(Boolean);
  const notes = requestNotes(plan, constraints);
  return (
    <article className="mt-6">
      <h2 dir="auto" className="text-xl font-semibold">{plan.title}</h2>
      <p className="mt-1 text-sm text-slate-600">
        {plan.steps.length} {plan.steps.length === 1 ? 'step' : 'steps'} · about {estimatedMinutes(plan)} min
        {facts.length > 0 && ` · ${facts.join(' · ')}`}
      </p>
      {coverage === 'partial' && (
        <p role="note" dir="auto" className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
          Not in the file: {coverageNote}
        </p>
      )}
      {notes.map((note) => (
        <p key={note} role="note" className="mt-2 rounded border border-slate-200 bg-slate-50 p-2 text-sm text-slate-700">{note}</p>
      ))}

      <ol className="mt-4 space-y-4">
        {plan.steps.map((step, i) => {
          const pages = sourcePages(step, doc);
          return (
            <li key={step.id} className="rounded border border-slate-200 p-3">
              <h3 dir="auto" className="font-medium">{i + 1}. {step.title}</h3>
              <p dir="auto" className="mt-1 text-sm">{step.objective}</p>
              <p dir="auto" className="mt-2 text-sm"><span className="font-medium">Check question:</span> {step.checkQuestion}</p>
              <p className="mt-2 text-sm font-medium">Expected points</p>
              <ul dir="auto" className="list-disc ps-5 text-sm">
                {step.expected.map((point, j) => <li key={j}>{point}</li>)}
              </ul>
              {pages && <p className="mt-2 text-xs text-slate-500">Source: {pages}</p>}
            </li>
          );
        })}
      </ol>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40" onClick={onRegenerate} disabled={busy}>
          Regenerate
        </button>
        <button className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-40" disabled aria-describedby="start-note">
          Start
        </button>
        <span id="start-note" className="text-sm text-slate-500">Starting a lesson comes with the tutor.</span>
      </div>
    </article>
  );
}
