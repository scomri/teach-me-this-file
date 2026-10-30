import { useEffect, useRef, useState } from 'react';
import { MAX_PROMPT_CHARS } from '../../../shared/limits.js';
import { requestPlan } from '../plan.js';
import PlanScreen from './PlanScreen.jsx';

const MESSAGES = {
  model_not_found: "The teacher model wasn't found or isn't available for this key. Check the model settings.",
  rate_limited: 'The provider is rate-limiting this key. Wait a moment and try again.',
  unreachable: "Couldn't reach the model provider. Try again.",
  plan_invalid: "The model didn't return a usable plan. Try again, or change the request.",
  document_too_long: 'This file is too long to plan in one request. Longer documents are not supported yet.',
};
const FALLBACK = "The plan couldn't be made. Try again.";

// Teacher prompt in, read-only plan out. `saves` counts successful settings saves: a save
// after a rejected key re-runs the request.
export default function PlanLesson({ doc, settings, saves, openSettings }) {
  const [prompt, setPrompt] = useState('');
  const [state, setState] = useState({ status: 'idle' });
  const controller = useRef(null);

  async function plan() {
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;
    setState((s) => ({ status: 'planning', plan: s.plan, constraints: s.constraints }));
    try {
      const { plan, constraints } = await requestPlan({ doc, prompt, settings, signal: ac.signal });
      setState({ status: 'done', plan, constraints });
    } catch (error) {
      if (ac.signal.aborted) return;
      setState((s) => ({ status: error.code === 'invalid_key' ? 'key_rejected' : 'error', code: error.code, plan: s.plan, constraints: s.constraints }));
    }
  }

  function cancel() {
    controller.current?.abort();
    setState((s) => ({ status: s.plan ? 'done' : 'idle', plan: s.plan, constraints: s.constraints }));
  }

  useEffect(() => {
    controller.current?.abort();
    setState({ status: 'idle' }); // a different file: drop the old plan
    return () => controller.current?.abort();
  }, [doc]);

  useEffect(() => {
    if (saves && state.status === 'key_rejected') plan();
  }, [saves]);

  const { status, plan: current } = state;
  const planning = status === 'planning';
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
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="For example: teach the main ideas in 15 minutes, in English, for 10th graders"
      />
      <div className="mt-2 flex items-center gap-2">
        <button className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-40" onClick={plan} disabled={planning || noKey}>
          {planning ? 'Planning…' : 'Plan'}
        </button>
        {planning && <button className="rounded border border-slate-300 px-3 py-1" onClick={cancel}>Cancel</button>}
        {noKey && <span className="text-sm text-slate-500">Add an API key in the model settings first.</span>}
      </div>

      <div aria-live="polite">
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

      {current && <PlanScreen plan={current} constraints={state.constraints} doc={doc} busy={planning} onRegenerate={plan} />}
    </section>
  );
}
