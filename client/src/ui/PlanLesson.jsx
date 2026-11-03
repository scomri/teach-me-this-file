import { useEffect, useRef, useState } from 'react';
import { MAX_PROMPT_CHARS } from '../../../shared/limits.js';
import { checkPlan, requestPlan } from '../plan.js';
import PlanScreen, { NoCoverage } from './PlanScreen.jsx';

const MESSAGES = {
  model_not_found: "The teacher model wasn't found or isn't available for this key. Check the model settings.",
  out_of_credit: "The provider says this key doesn't have enough credit for a plan. Add credit to the key or use another key.",
  rate_limited: 'The provider is rate-limiting this key. Wait a moment and try again.',
  unreachable: "Couldn't reach the model provider. Try again.",
  plan_invalid: "The model didn't return a usable plan. Try again, or change the request.",
  plan_check_failed: "The plan's questions could not be checked for answer disclosure. Retry the check or regenerate the whole plan.",
  document_too_long: 'The plan request was too large for the server. Try a shorter file, or a file with fewer pages.',
};
const FALLBACK = "The plan couldn't be made. Try again.";

// Teacher prompt in, read-only plan out. The plan lives in the lesson state (`lesson`, `dispatch`);
// this component keeps only the request: its status, the last error, and the "file doesn't cover it"
// message (a plan-less result).
// `saveCount` counts successful settings saves: a save after a rejected key re-runs the request.
export default function PlanLesson({ lesson, dispatch, settings, saveCount, openSettings }) {
  const { source: doc, teacher: { prompt } } = lesson;
  const [state, setState] = useState({ status: 'idle' });
  const controller = useRef(null);
  // The newest props, for code that runs after an await and must not use a stale closure.
  const latest = useRef({});
  latest.current = { doc, settings, prompt };

  // wholeFile: plan the document without the prompt's topic (after a request the file does not cover).
  // prompt: the text to send in place of the current one, to repeat an earlier request.
  async function runPlan({ wholeFile = false, prompt: earlier } = {}) {
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;
    const sent = { ...latest.current, wholeFile, ...(earlier !== undefined && { prompt: earlier }) };
    setState((s) => ({ ...s, status: 'planning' }));
    try {
      const { plan, constraints, coverage, coverageNote, documentLanguage } = await requestPlan({ ...sent, signal: ac.signal });
      if (plan) {
        dispatch({ type: 'planReceived', plan, constraints, coverage, coverageNote, documentLanguage });
        setState({ status: 'done', wholeFile, prompt: sent.prompt });
      } else {
        dispatch({ type: 'planCleared' });
        setState({ status: 'done', coverage, coverageNote, wholeFile, prompt: sent.prompt });
      }
    } catch (error) {
      if (ac.signal.aborted) return;
      if (error.code === 'invalid_key') {
        // The key changed while the request was in flight: the rejection is about the old one.
        if (latest.current.settings.apiKey !== sent.settings.apiKey) return runPlan({ wholeFile, prompt: sent.prompt });
        dispatch({ type: 'planCleared' }); // a plan made with the old key is dropped
        return setState({ status: 'key_rejected', wholeFile, prompt: sent.prompt, flagged: error.flagged });
      }
      setState((s) => ({ ...s, status: 'error', code: error.code, role: error.role, flagged: error.flagged }));
    }
  }

  async function validateRestored() {
    controller.current?.abort();
    const ac = new AbortController(); controller.current = ac;
    setState({ status: 'checking' });
    try {
      await checkPlan({ plan: lesson.plan, settings, signal: ac.signal });
      dispatch({ type: 'planValidated' });
      setState({ status: 'done' });
    } catch (error) {
      if (!ac.signal.aborted) setState({ status: error.code === 'invalid_key' ? 'check_key_rejected' : 'error', code: error.code, role: error.role, flagged: error.flagged });
    }
  }

  function cancel() {
    controller.current?.abort();
    setState((s) => ({ ...s, status: s.coverage || lesson.plan ? 'done' : 'idle' }));
  }

  useEffect(() => () => controller.current?.abort(), []);

  useEffect(() => {
    if (saveCount && state.status === 'key_rejected') runPlan({ wholeFile: state.wholeFile, prompt: state.prompt });
    if (saveCount && state.status === 'check_key_rejected') validateRestored();
  }, [saveCount]);

  const { status, coverage } = state;
  const { plan } = lesson;
  const planning = status === 'planning' || status === 'checking';
  const noKey = !settings.apiKey.trim();

  return (
    <section className="mt-6">
      <label className="block text-sm font-medium" htmlFor="prompt">What should the lesson cover?</label>
      <textarea
        id="prompt"
        className="field mt-1 w-full p-2"
        rows={3}
        maxLength={MAX_PROMPT_CHARS}
        value={prompt}
        onChange={(e) => dispatch({ type: 'promptChanged', prompt: e.target.value })}
        placeholder="For example: teach the main ideas in 15 minutes, in English, for 10th graders"
      />
      <div className="mt-2 flex items-center gap-2">
        <button className="btn btn-primary" onClick={() => runPlan()} disabled={planning || noKey}>Plan</button>
        {planning && <button className="btn btn-secondary" onClick={cancel}>Cancel</button>}
        {noKey && <span className="text-sm text-muted">Add an API key in the model settings first.</span>}
      </div>
      {/* The plan request also checks its questions on the server, so its wait names the file; a restored plan's check names the stage. */}
      <p role="status" className="mt-2 text-sm text-muted">
        {status === 'planning' ? <>Planning from <span dir="auto">{doc.name}</span>…</> : status === 'checking' ? 'Checking questions…' : ''}
      </p>

      <div aria-live="polite">
        {state.flagged?.length > 0 && <p role="alert">Check questions may reveal answers in steps {state.flagged.join(', ')}. Regenerate the whole plan.</p>}
        {status === 'key_rejected' && (
          <p role="alert" className="mt-3 notice notice-danger text-sm">
            Your key was rejected.{' '}
            <button className="btn btn-secondary ms-1" onClick={openSettings}>Open Settings</button>
          </p>
        )}
        {['error', 'check_key_rejected'].includes(status) && (
          <p role="alert" className="mt-3 notice notice-danger text-sm">
            {state.code === 'invalid_key' ? 'Your key was rejected.' : state.code === 'model_not_found' && state.role === 'evaluator' ? "The evaluator model wasn't found or isn't available for this key. Check the model settings." : MESSAGES[state.code] ?? FALLBACK}{' '}
            {['invalid_key', 'model_not_found'].includes(state.code) && <button className="btn btn-secondary ms-1" onClick={openSettings}>Open Settings</button>}
          </p>
        )}
      </div>

      {coverage === 'none' && (
        <NoCoverage coverageNote={state.coverageNote} busy={planning} onPlanWholeFile={() => runPlan({ wholeFile: true, prompt: state.prompt })} />
      )}
      {plan && (
        <PlanScreen
          plan={plan} constraints={lesson.teacher.constraints} doc={doc} busy={planning}
          onStart={() => dispatch({ type: 'lessonStarted' })}
          startAllowed={plan.validated === true && !noKey}
          onValidate={validateRestored}
          needsValidation={plan.validated !== true}
          noKey={noKey}
          onRegenerate={() => runPlan({ wholeFile: state.wholeFile && state.prompt === prompt })}
        />
      )}
    </section>
  );
}
