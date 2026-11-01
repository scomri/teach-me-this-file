import { useEffect, useRef, useState } from 'react';
import { MAX_ANSWER_CHARS } from '../../../shared/limits.js';
import { requestEvaluation } from '../evaluate.js';
import { reduce } from '../lesson/lesson.js';
import { checkPlan, sourcePages } from '../plan.js';
import { cancelStream, streamTeach, teachRequest } from '../teach.js';

const MESSAGES = {
  invalid_key: 'Your key was rejected.',
  model_not_found: "The teacher model wasn't found or isn't available for this key. Check the model settings.",
  out_of_credit: "The provider says this key doesn't have enough credit. Add credit to the key or use another key.",
  rate_limited: 'The provider is rate-limiting this key. Wait a moment and try again.',
  unreachable: "Couldn't reach the model provider. Try again.",
  timeout: 'The reply took too long. Try again.',
  invalid_request: "The app sent a request the server couldn't accept. Try again.",
};
const EVALUATOR_NOT_FOUND = "The evaluator model wasn't found or isn't available for this key. Check the model settings.";
const FALLBACK = "The tutor couldn't reply. Try again.";

// The lesson chat. The messages and progress live in the lesson state (`lesson`, `dispatch`); this
// component keeps the requests in flight, the draft and the last error. It dispatches events and renders state.
export default function Lesson({ lesson, dispatch, settings, saveCount, openSettings }) {
  const { plan, progress, source, messages } = lesson;
  const [error, setError] = useState(null); // { code, from: 'teacher' | 'evaluator' }
  const errorCode = error?.code;
  const [draft, setDraft] = useState('');
  const [evaluating, setEvaluating] = useState(false);
  const [checkingPlan, setCheckingPlan] = useState(false);
  const [planError, setPlanError] = useState(null);
  const planCheck = useRef(null);
  const current = useRef(null); // the stream in flight: { ac, id, stopped }
  const grading = useRef(null); // the evaluation in flight: its AbortController
  const latest = useRef({});
  latest.current = { lesson, settings };

  // `snapshot`: the lesson as this reply sees it. The reducer has not rendered an event dispatched a moment
  // ago, and a reply must see the progress that event applied.
  async function stream(transition, stepId, snapshot = latest.current.lesson, rateLimitRetried = false, turnId) {
    const ac = new AbortController();
    const run = { ac, id: null, stopped: false };
    const sentKey = latest.current.settings.apiKey;
    current.current = run;
    setError(null);
    try {
      const s = latest.current.settings;
      await streamTeach({
        request: { ...teachRequest({ lesson: snapshot, transition, settings: s, stepId }), rateLimitRetried }, apiKey: s.apiKey, signal: ac.signal, turnId,
        onStart(id) { run.id = id; if (run.stopped) halt(run); },
        onText: (text) => { if (current.current === run) dispatch({ type: 'teachChunk', text }); },
      });
      if (current.current === run) dispatch({ type: 'teachDone' });
    } catch (error) {
      if (current.current !== run) return; // the lesson screen closed: a newer reply is not ours to settle
      if (run.stopped || ac.signal.aborted) return dispatch({ type: 'teachStopped' });
      dispatch({ type: 'teachFailed' });
      setError({ code: error.code, from: 'teacher', key: sentKey });
      if (error.code === 'invalid_key' && latest.current.settings.apiKey === sentKey) openSettings();
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

  // Starts a tutor reply: the message shows at once, then streams.
  function reply(transition, stepId, chunkIds, snapshot, rateLimitRetried, turnId) {
    dispatch({ type: 'teachStarted', stepId, transition, chunkIds });
    stream(transition, stepId, snapshot, rateLimitRetried, turnId);
  }

  function open() {
    const step = plan.steps.find((s) => s.id === progress.current);
    reply('opening', step.id, step.chunkIds);
  }

  // Evaluates the student's `message`, which `base` already holds. The evaluation is applied to progress
  // before the reply streams, so a Stop or a failed reply cannot undo the move.
  async function grade(message, base) {
    const ac = new AbortController();
    const turnId = crypto.randomUUID();
    const sentKey = latest.current.settings.apiKey;
    grading.current = ac;
    setEvaluating(true);
    setError(null);
    try {
      const { evaluation, rateLimitRetried } = await requestEvaluation({ lesson: base, message, settings: latest.current.settings, signal: ac.signal, turnId });
      if (grading.current !== ac) return;
      const event = { type: 'evaluated', evaluation };
      const after = reduce(base, event);
      dispatch(event);
      const { transition } = after.messages.at(-1);
      if (!transition) return;
      // The reply's step is the one progress is on now: the next step after an advance, else the answered one.
      const stepChunkIds = plan.steps.find((s) => s.id === after.progress.current).chunkIds;
      // Cite every passage the teaching request supplies.
      reply(transition, after.progress.current, stepChunkIds, after, rateLimitRetried, turnId);
    } catch (error) {
      if (grading.current !== ac || ac.signal.aborted) return; // the lesson screen closed
      setError({ code: error.code, from: 'evaluator', key: sentKey });
      if (error.code === 'invalid_key' && latest.current.settings.apiKey === sentKey) openSettings();
    } finally {
      if (grading.current === ac) { grading.current = null; setEvaluating(false); }
    }
  }

  function send() {
    const message = draft.trim();
    if (!message || draft.length > MAX_ANSWER_CHARS) return;
    setDraft('');
    const base = reduce(lesson, { type: 'answerSent', text: message });
    dispatch({ type: 'answerSent', text: message });
    grade(message, base);
  }

  // Retry for an answer whose evaluation failed: the same message, evaluated again.
  const retryAnswer = () => grade(messages.at(-1).text, lesson);

  // After a reveal: on to the next step's opening, or, when there is none, the recap.
  function proceed() {
    const event = { type: 'continued' };
    const after = reduce(lesson, event);
    dispatch(event);
    const stepId = after.progress.current;
    const step = plan.steps.find((s) => s.id === stepId);
    reply(after === lesson ? 'recap' : 'opening', stepId, step.chunkIds, after);
  }

  // Regenerate and Retry: the last reply's stored transition runs again; progress is not touched.
  function again() {
    const { transition, stepId } = messages.at(-1);
    const event = { type: 'regenerate' };
    dispatch(event);
    stream(transition, stepId, reduce(lesson, event)); // the reply being replaced is not part of its own history
  }

  async function validatePlan() {
    const ac = new AbortController();
    planCheck.current = ac;
    setCheckingPlan(true);
    setPlanError(null);
    try {
      await checkPlan({ plan, settings: latest.current.settings, signal: ac.signal });
      if (!ac.signal.aborted) dispatch({ type: 'planValidated' });
    } catch (error) {
      if (!ac.signal.aborted) setPlanError(error);
    } finally {
      if (planCheck.current === ac) { planCheck.current = null; setCheckingPlan(false); }
    }
  }

  useEffect(() => {
    if (!messages.length) open();
    return () => {
      planCheck.current?.abort();
      grading.current?.abort();
      grading.current = null;
      const run = current.current;
      current.current = null;
      if (run) { run.stopped = true; if (run.id) halt(run); else run.ac.abort(); }
    };
  }, []);

  useEffect(() => {
    if (saveCount && error?.code === 'invalid_key' && settings.apiKey !== error.key) {
      if (error.from === 'evaluator') retryAnswer();
      else again();
    }
  }, [saveCount]);

  const last = messages.at(-1);
  const streaming = last?.status === 'streaming';
  const pendingAnswer = last?.role === 'student' && last.intent === null;
  const index = plan.steps.findIndex((s) => s.id === progress.current);
  const canAnswer = progress.steps[progress.current].status === 'active' && !!last && !pendingAnswer && !evaluating && (last.role === 'student' || ['done', 'stopped'].includes(last.status));
  const canContinue = progress.steps[progress.current].status === 'revealed' && last?.transition === 'reveal' && ['done', 'stopped'].includes(last.status);
  const over = draft.length > MAX_ANSWER_CHARS;

  return (
    <section className="mt-6">
      <h2 dir="auto" className="text-xl font-semibold">{plan.title}</h2>
      <p className="mt-1 text-sm text-slate-600">Step {index + 1} of {plan.steps.length}</p>
      {!plan.validated && <div role="status" className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-sm">
        <p>This restored lesson has unchecked questions. Check them to include the question in a fallback reply.</p>
        <button className="underline disabled:opacity-40" onClick={validatePlan} disabled={checkingPlan || !settings.apiKey.trim()}>{checkingPlan ? 'Checking…' : 'Check questions'}</button>
        {planError && <p role="alert">{planError.code === 'invalid_key' ? 'Your key was rejected.' : 'The questions could not be checked. Try again or start a new lesson.'} {['invalid_key', 'model_not_found'].includes(planError.code) && <button className="underline" onClick={openSettings}>Open Settings</button>}</p>}
      </div>}

      <ol className="mt-4 space-y-3" aria-live="polite">
        {messages.map((m, i) => {
          if (m.role === 'student') {
            return (
              <li key={i} className="rounded border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-500">You</p>
                <p dir="auto" className="whitespace-pre-wrap">{m.text}</p>
              </li>
            );
          }
          const pages = sourcePages(m, source);
          return (
            <li key={i} className="rounded border border-slate-200 p-3">
              <p dir="auto" className="whitespace-pre-wrap">{m.text}{m.status === 'streaming' && !m.text && 'Preparing reply…'}</p>
              {m.status === 'stopped' && <p className="mt-1 text-xs text-slate-500">Stopped.</p>}
              {m.chunkIds?.length > 0 && <details className="mt-2 text-sm text-slate-600">
                <summary>Source{pages ? `: ${pages}` : ' passages'}</summary>
                {source.chunks.filter((c) => m.chunkIds.includes(c.id)).map((c) => <p key={c.id} dir="auto" className="mt-2 whitespace-pre-wrap">{c.text}</p>)}
              </details>}
            </li>
          );
        })}
      </ol>

      {evaluating && <p role="status" className="mt-3 text-sm text-slate-500">Thinking…</p>}

      {errorCode && (last?.status === 'failed' || pendingAnswer) && (
        <p role="alert" className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
          {(errorCode === 'invalid_key' && settings.apiKey !== error.key ? 'The previous key was rejected. Retry with the new key.' : error.from === 'evaluator' && errorCode === 'model_not_found' ? EVALUATOR_NOT_FOUND : MESSAGES[errorCode]) ?? FALLBACK}{' '}
          {['invalid_key', 'model_not_found'].includes(errorCode) && <button className="underline" onClick={openSettings}>Open Settings</button>}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {streaming && <button className="rounded border border-slate-300 px-3 py-1" onClick={stop}>Stop</button>}
        {(last?.status === 'failed' || (pendingAnswer && !evaluating)) && <button className="rounded bg-slate-900 px-3 py-1 text-white" onClick={pendingAnswer ? retryAnswer : again}>Retry</button>}
        {['done', 'stopped'].includes(last?.status) && <button className="rounded border border-slate-300 px-3 py-1" onClick={again}>Regenerate</button>}
        {canContinue && <button className="rounded bg-slate-900 px-3 py-1 text-white" onClick={proceed}>Continue</button>}
      </div>

      <div className="mt-4">
        <label className="block text-sm font-medium" htmlFor="answer">Your answer</label>
        <textarea
          id="answer" className="mt-1 w-full rounded border border-slate-300 p-2 disabled:opacity-40" rows={2}
          value={draft} onChange={(e) => setDraft(e.target.value)} disabled={!canAnswer} aria-describedby="answer-count"
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          <p id="answer-count" className={`text-sm ${over ? 'text-red-700' : 'text-slate-500'}`}>
            {draft.length} / {MAX_ANSWER_CHARS}{over && ' (too long, shorten it to send)'}
          </p>
          <button className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-40" onClick={send} disabled={!canAnswer || !draft.trim() || over}>Send</button>
        </div>
      </div>
    </section>
  );
}
