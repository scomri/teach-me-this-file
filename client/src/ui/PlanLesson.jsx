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
        return setState({ status: 'key_rejected', wholeFile, prompt: sent.prompt });
      }
      setState((s) => ({ ...s, status: 'error', code: error.code, flagged: error.flagged }));
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
      if (!ac.signal.aborted) setState({ status: 'error', code: error.code, flagged: error.flagged });
    }
  }

  function cancel() {
    controller.current?.abort();
    setState((s) => ({ ...s, status: s.coverage || lesson.plan ? 'done' : 'idle' }));
  }

  useEffect(() => () => controller.current?.abort(), []);

  useEffect(() => {
    if (saveCount && state.status === 'key_rejected') runPlan({ wholeFile: state.wholeFile, prompt: state.prompt });
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
        className="mt-1 w-full rounded border border-slate-300 p-2"
        rows={3}
        maxLength={MAX_PROMPT_CHARS}
        value={prompt}
        onChange={(e) => dispatch({ type: 'promptChanged', prompt: e.target.value })}
        placeholder="For example: teach the main ideas in 15 minutes, in English, for 10th graders"
      />
      <div className="mt-2 flex items-center gap-2">
        <button className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-40" onClick={() => runPlan()} disabled={planning || noKey}>
          {planning ? 'Planning…' : 'Plan'}
        </button>
        {planning && <button className="rounded border border-slate-300 px-3 py-1" onClick={cancel}>Cancel</button>}
        {noKey && <span className="text-sm text-slate-500">Add an API key in the model settings first.</span>}
      </div>

      <div aria-live="polite">
        {state.flagged?.length > 0 && <p role="alert">Check questions may reveal answers in steps {state.flagged.join(', ')}. Regenerate the whole plan.</p>}
        {status === 'key_rejected' && (
          <p role="alert" className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
            Your key was rejected.{' '}
            <button className="underline" onClick={openSettings}>Open Settings</button>
          </p>
        )}
        {status === 'error' && (
          <p role="alert" className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
            {MESSAGES[state.code] ?? FALLBACK}{' '}
            {state.code === 'model_not_found' && <button className="underline" onClick={openSettings}>Open Settings</button>}
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
