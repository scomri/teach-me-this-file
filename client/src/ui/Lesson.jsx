import { useEffect, useRef, useState } from 'react';
import { sourcePages } from '../plan.js';
import { cancelStream, streamTeach, teachRequest } from '../teach.js';

const MESSAGES = {
  invalid_key: 'Your key was rejected.',
  model_not_found: "The teacher model wasn't found or isn't available for this key. Check the model settings.",
  out_of_credit: "The provider says this key doesn't have enough credit. Add credit to the key or use another key.",
  rate_limited: 'The provider is rate-limiting this key. Wait a moment and try again.',
  unreachable: "Couldn't reach the model provider. Try again.",
  timeout: 'The reply took too long. Try again.',
};
const FALLBACK = "The tutor couldn't reply. Try again.";

// The lesson chat. The messages and progress live in the lesson state (`lesson`, `dispatch`); this
// component keeps the request in flight and the last error. It dispatches events and renders state.
export default function Lesson({ lesson, dispatch, settings, openSettings }) {
  const { plan, progress, source, messages } = lesson;
  const [errorCode, setErrorCode] = useState(null);
  const current = useRef(null); // the stream in flight: { ac, id, stopped }
  const latest = useRef({});
  latest.current = { lesson, settings };

  async function stream(transition, stepId) {
    const ac = new AbortController();
    const run = { ac, id: null, stopped: false };
    current.current = run;
    setErrorCode(null);
    try {
      const { lesson: now, settings: s } = latest.current;
      await streamTeach({
        request: teachRequest({ lesson: now, transition, settings: s, stepId }), apiKey: s.apiKey, signal: ac.signal,
        onStart(id) { run.id = id; if (run.stopped) halt(run); },
        onText: (text) => { if (current.current === run) dispatch({ type: 'teachChunk', text }); },
      });
      if (current.current === run) dispatch({ type: 'teachDone' });
    } catch (error) {
      if (current.current !== run) return; // the lesson screen closed: a newer reply is not ours to settle
      if (run.stopped || ac.signal.aborted) return dispatch({ type: 'teachStopped' });
      dispatch({ type: 'teachFailed' });
      setErrorCode(error.code);
    } finally {
      if (current.current === run) current.current = null;
    }
  }

  // Tell the server first: behind a proxy, closing our fetch may never reach it. The fetch is closed
  // after the cancel is answered, so the server never sees the disconnect first and refuses the cancel.
  function halt(run) {
    cancelStream(run.id).finally(() => run.ac.abort());
  }

  function stop() {
    const run = current.current;
    if (!run) return;
    run.stopped = true;
    current.current = null; // later chunks are dropped; the reply settles now, not when the cancel returns
    dispatch({ type: 'teachStopped' });
    if (run.id) halt(run); // else onStart halts it when the stream is named
  }

  function open() {
    const step = plan.steps.find((s) => s.id === progress.current);
    dispatch({ type: 'teachStarted', stepId: step.id, transition: 'opening', chunkIds: step.chunkIds });
    stream('opening', step.id);
  }

  // Regenerate and Retry: the last reply's stored transition runs again; progress is not touched.
  function again() {
    const { transition, stepId } = messages.at(-1);
    dispatch({ type: 'regenerate' });
    stream(transition, stepId);
  }

  useEffect(() => {
    if (!messages.length) open();
    return () => { const run = current.current; current.current = null; if (run) { run.stopped = true; if (run.id) halt(run); else run.ac.abort(); } };
  }, []);

  const last = messages.at(-1);
  const streaming = last?.status === 'streaming';
  const index = plan.steps.findIndex((s) => s.id === progress.current);

  return (
    <section className="mt-6">
      <h2 dir="auto" className="text-xl font-semibold">{plan.title}</h2>
      <p className="mt-1 text-sm text-slate-600">Step {index + 1} of {plan.steps.length}</p>

      <ol className="mt-4 space-y-3" aria-live="polite">
        {messages.map((m, i) => {
          const pages = sourcePages(m, source);
          return (
            <li key={i} className="rounded border border-slate-200 p-3">
              <p dir="auto" className="whitespace-pre-wrap">{m.text}{m.status === 'streaming' && !m.text && 'Thinking…'}</p>
              {m.status === 'stopped' && <p className="mt-1 text-xs text-slate-500">Stopped.</p>}
              {pages && <p className="mt-2 text-xs text-slate-500">Source: {pages}</p>}
            </li>
          );
        })}
      </ol>

      {last?.status === 'failed' && (
        <p role="alert" className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
          {MESSAGES[errorCode] ?? FALLBACK}{' '}
          {['invalid_key', 'model_not_found'].includes(errorCode) && <button className="underline" onClick={openSettings}>Open Settings</button>}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {streaming && <button className="rounded border border-slate-300 px-3 py-1" onClick={stop}>Stop</button>}
        {last?.status === 'failed' && <button className="rounded bg-slate-900 px-3 py-1 text-white" onClick={again}>Retry</button>}
        {['done', 'stopped'].includes(last?.status) && <button className="rounded border border-slate-300 px-3 py-1" onClick={again}>Regenerate</button>}
      </div>

      <div className="mt-4">
        <label className="block text-sm font-medium" htmlFor="answer">Your answer</label>
        <textarea id="answer" className="mt-1 w-full rounded border border-slate-300 p-2 disabled:opacity-40" rows={2} disabled aria-describedby="answer-note" />
        <p id="answer-note" className="mt-1 text-sm text-slate-500">Answering comes with the next update.</p>
      </div>
    </section>
  );
}
