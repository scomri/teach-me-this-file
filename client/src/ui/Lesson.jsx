import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { protectsUnansweredPoints } from '../../../shared/transitions.js';
import { requestEvaluation } from '../evaluate.js';
import { lessonDone, reduce } from '../lesson/lesson.js';
import { checkPlan } from '../plan.js';
import { nearBottom } from '../scroll.js';
import { cancelStream, streamTeach, teachRequest } from '../teach.js';
import Composer from './Composer.jsx';
import { Reply } from './Message.jsx';
import MessageList from './MessageList.jsx';
import StatusLine from './StatusLine.jsx';

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
  const [offline, setOffline] = useState(() => globalThis.navigator?.onLine === false);
  // Cold start: until a request on this screen has been answered, a wait of 3 seconds adds "Waking the server…".
  const [waking, setWaking] = useState(false);
  const heard = useRef(false);
  const wakeTimer = useRef(null);
  const [following, setFollowing] = useState(true); // the page follows new text while the student reads its end

  function awaitServer() {
    if (!heard.current && !wakeTimer.current) wakeTimer.current = setTimeout(() => setWaking(true), 3000);
  }
  function stopWaiting(answered) {
    if (answered) heard.current = true;
    clearTimeout(wakeTimer.current);
    wakeTimer.current = null;
    setWaking(false);
  }

  // `snapshot`: the lesson as this reply sees it. The reducer has not rendered an event dispatched a moment
  // ago, and a reply must see the progress that event applied.
  async function stream(transition, stepId, snapshot = latest.current.lesson, rateLimitRetried = false, turnId) {
    const ac = new AbortController();
    const run = { ac, id: null, stopped: false };
    const sentKey = latest.current.settings.apiKey;
    current.current = run;
    setError(null);
    awaitServer();
    try {
      const s = latest.current.settings;
      await streamTeach({
        request: { ...teachRequest({ lesson: snapshot, transition, settings: s, stepId }), rateLimitRetried }, apiKey: s.apiKey, signal: ac.signal, turnId,
        onStart(id) { run.id = id; if (current.current === run) stopWaiting(true); if (run.stopped) halt(run); },
        onText: (text) => { if (current.current === run) dispatch({ type: 'teachChunk', text }); },
      });
      if (current.current === run) dispatch({ type: 'teachDone' });
    } catch (error) {
      if (current.current !== run) return; // the lesson screen closed: a newer reply is not ours to settle
      if (run.stopped || ac.signal.aborted) return dispatch({ type: 'teachStopped' });
      dispatch({ type: 'teachFailed' });
      if (error.code !== 'unreachable') heard.current = true; // the server answered, with an error
      setError({ code: error.code, from: 'teacher', key: sentKey });
      if (error.code === 'invalid_key' && latest.current.settings.apiKey === sentKey) openSettings();
    } finally {
      if (current.current === run) { current.current = null; stopWaiting(false); }
    }
  }

  // Tell the server first: behind a proxy, closing our fetch may never reach it. The fetch is closed
  // after the cancel is answered, so the server never sees the disconnect first and refuses the cancel.
  function halt(run) {
    cancelStream(run.id).finally(() => run.ac.abort());
  }

  // Stop while the answer is read withdraws it, back into the composer; Stop on a reply keeps what it has.
  function stop() {
    stopWaiting(false);
    if (grading.current) {
      grading.current.abort();
      grading.current = null;
      setEvaluating(false);
      setDraft(latest.current.lesson.messages.at(-1).text);
      return dispatch({ type: 'answerWithdrawn' });
    }
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
    awaitServer();
    try {
      const { evaluation, rateLimitRetried } = await requestEvaluation({ lesson: base, message, settings: latest.current.settings, signal: ac.signal, turnId });
      if (grading.current !== ac) return;
      stopWaiting(true);
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
      if (error.code !== 'unreachable') heard.current = true; // the server answered, with an error
      setError({ code: error.code, from: 'evaluator', key: sentKey });
      if (error.code === 'invalid_key' && latest.current.settings.apiKey === sentKey) openSettings();
    } finally {
      if (grading.current === ac) { grading.current = null; setEvaluating(false); stopWaiting(false); }
    }
  }

  function send() {
    const message = draft.trim(); // Composer sends only a draft with text, within the limit
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
    const goOnline = () => setOffline(false);
    const goOffline = () => setOffline(true);
    const scrolled = () => setFollowing(nearBottom(document.documentElement));
    // A closed tab cancels its reply; the cancel is a keepalive fetch, so it outlives the page. Switching tabs
    // fires no pagehide, so a hidden tab keeps its reply.
    const left = () => { if (current.current?.id) cancelStream(current.current.id); };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    window.addEventListener('scroll', scrolled, { passive: true });
    window.addEventListener('pagehide', left);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('scroll', scrolled);
      window.removeEventListener('pagehide', left);
      stopWaiting(false);
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
  // The live region gets a reply once, when it finishes (done or stopped); a failed one is not announced.
  const [announced, setAnnounced] = useState('');
  const lastStatus = useRef(last?.role === 'tutor' ? last.status : null);
  useEffect(() => {
    const status = last?.role === 'tutor' ? last.status : null;
    if (lastStatus.current === 'streaming' && (status === 'done' || status === 'stopped') && last.text) setAnnounced(last.text);
    if (status === 'streaming') setAnnounced('');
    lastStatus.current = status;
  }, [last?.role, last?.status]);
  const streaming = last?.status === 'streaming';
  const pendingAnswer = last?.role === 'student' && last.intent === null;
  const canAnswer = progress.steps[progress.current].status === 'active' && !!last && !pendingAnswer && !evaluating && (last.role === 'student' || ['done', 'stopped'].includes(last.status));
  const canContinue = progress.steps[progress.current].status === 'revealed' && last?.transition === 'reveal' && ['done', 'stopped'].includes(last.status);

  // Protected replies are checked on the server before any text is sent, so their wait says so; reveals and the
  // recap stream, and their wait ends with the first text.
  const waitingFor = evaluating ? 'Reading your answer…'
    : streaming && !last.text ? (protectsUnansweredPoints(last.transition) ? 'Writing and checking the reply…' : 'Writing the reply…') : '';
  const status = [offline && "You're offline.", waitingFor, waking && 'Waking the server…'].filter(Boolean).join(' ');
  const alert = errorCode && (last?.status === 'failed' || pendingAnswer)
    && ((errorCode === 'invalid_key' && settings.apiKey !== error.key ? 'The previous key was rejected. Retry with the new key.' : error.from === 'evaluator' && errorCode === 'model_not_found' ? EVALUATOR_NOT_FOUND : MESSAGES[errorCode]) ?? FALLBACK);

  // Scrolling: new text keeps the end in view only while the student is near it, so reading earlier messages
  // is never interrupted; a new answer always jumps to the end. No smooth scrolling under reduced motion.
  function toBottom(smooth) {
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo?.({ top: document.documentElement.scrollHeight, behavior: smooth && !still ? 'smooth' : 'auto' });
  }
  useLayoutEffect(() => {
    if (following || last?.role === 'student') toBottom(false);
  }, [messages.length, last?.text]);

  return (
    <section className="mt-6">
      <h1 tabIndex={-1} className="heading text-2xl">
        <span dir="auto" className="block">{plan.title}</span>
        {lessonDone(lesson) && <span className="mt-1 block text-sm font-medium tracking-normal text-muted">Lesson complete</span>}
      </h1>
      {!plan.validated && <div className="mt-3 notice notice-warning text-sm">
        <p>This restored lesson has unchecked questions. Check them to include the question in a fallback reply.</p>
        <button className="btn btn-secondary mt-2" onClick={validatePlan} disabled={checkingPlan || !settings.apiKey.trim()}>Check questions</button>
        <p role="status">{checkingPlan && 'Checking questions…'}</p>
        {planError && <p role="alert">{planError.code === 'invalid_key' ? 'Your key was rejected.' : 'The questions could not be checked. Try again or start a new lesson.'} {['invalid_key', 'model_not_found'].includes(planError.code) && <button className="btn btn-secondary ms-1" onClick={openSettings}>Open Settings</button>}</p>}
      </div>}

      <MessageList messages={messages} source={source} />
      <div className="sr-only" aria-live="polite"><Reply>{announced}</Reply></div>

      <div className="sticky bottom-0 mt-4 border-t border-border bg-canvas pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        {!following && <button className="btn btn-secondary absolute inset-x-0 bottom-full mx-auto mb-3 w-fit bg-surface" onClick={() => toBottom(true)}>Jump to latest</button>}
        <StatusLine status={status} alert={alert}>
          {['invalid_key', 'model_not_found'].includes(errorCode) && <button className="btn btn-secondary" onClick={openSettings}>Open Settings</button>}
        </StatusLine>
        <div className="mt-2 flex flex-wrap items-center gap-2 empty:hidden">
          {(evaluating || streaming) && <button className="btn btn-secondary" onClick={stop}>Stop</button>}
          {(last?.status === 'failed' || (pendingAnswer && !evaluating)) && <button className="btn btn-secondary" onClick={pendingAnswer ? retryAnswer : again}>Retry</button>}
          {['done', 'stopped'].includes(last?.status) && <button className="btn btn-secondary" onClick={again}>Regenerate</button>}
          {canContinue && <button className="btn btn-primary" onClick={proceed}>Continue</button>}
        </div>
        <div className="mt-2">
          <Composer
            draft={draft} onDraft={setDraft} onSend={send}
            readOnly={!canAnswer} disabled={canContinue || lessonDone(lesson)} canSend={canAnswer && !offline}
          />
        </div>
      </div>
    </section>
  );
}
