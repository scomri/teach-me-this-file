import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { MAX_MODEL_CHARS } from '../../../shared/limits.js';
import { PRESETS } from '../../../shared/presets.js';
import { loadSettings, saveSettings } from '../settings.js';

const notices = {
  rate_limited: 'Settings saved. The key works but is rate-limited right now. Open Settings to retry.',
  unreachable: 'Settings saved, but the connection could not be verified. Open Settings to retry.',
};
const storageUnavailableNotice = 'Browser storage is unavailable. Settings are kept in memory for this visit; close this tab to clear any previously remembered key.';

// onSettings gets the current settings whenever they change; onSaved the new ones after a successful save.
// ref.current.open() opens the dialog from outside.
export default function ModelSettings({ ref, onSettings, onSaved }) {
  const [{settings:initialSettings,storageUnavailable}] = useState(loadSettings);
  const [settings, setSettings] = useState(initialSettings);
  const [draft, setDraft] = useState(settings);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [storageWarning, setStorageWarning] = useState(storageUnavailable ? storageUnavailableNotice : '');
  const dialog = useRef(null);
  const trigger = useRef(null);
  const request = useRef(null);
  const generation = useRef(0);
  const preset = PRESETS[draft.preset];

  function cancelCheck() {
    generation.current++;
    request.current?.abort();
    setBusy(false);
  }
  function open() {
    setDraft(settings); setError(null); setShowKey(false);
    dialog.current.showModal();
  }
  function close() { cancelCheck(); dialog.current.close(); }
  useImperativeHandle(ref, () => ({ open }));
  useEffect(() => { onSettings?.(settings); }, [settings]);
  function containFocus(event) {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.current.querySelectorAll('button, input, select, a[href]')].filter(el => !el.disabled);
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  useEffect(() => {
    if (!settings.apiKey) dialog.current.showModal();
    return () => request.current?.abort();
  }, []);

  function change(patch) {
    cancelCheck(); setError(null); setDraft(d => ({...d,...patch}));
    // Opting out removes a previously remembered key immediately, even on Cancel.
    if (patch.remember === false) {
      const next = {...settings,remember:false};
      setSettings(next);
      if (!saveSettings(next)) setStorageWarning('Browser storage is unavailable. Close this tab to clear any previously remembered key.');
    }
  }

  async function save(event) {
    event.preventDefault(); cancelCheck();
    const version = generation.current;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(null);
    const next = {...draft, apiKey:draft.apiKey.trim()};
    const timeout = setTimeout(() => controller.abort(), 12000);
    let result;
    try {
      const response = await fetch('/api/check', {
        method:'POST', headers:{'Content-Type':'application/json','X-Api-Key':next.apiKey},
        body:JSON.stringify({preset:next.preset,evaluator:next.evaluator,teacher:next.teacher}),signal:controller.signal,
      });
      result = await response.json().catch(() => ({code:'unreachable'}));
    } catch { result = {code:'unreachable'}; }
    finally { clearTimeout(timeout); }
    if (version !== generation.current) return;
    setBusy(false);
    if (result.code === 'invalid_key') {
      if (!settings.apiKey || (settings.preset === next.preset && settings.apiKey === next.apiKey)) {
        setSettings(s => ({...s,code:'invalid_key'}));
        // Only a rejected saved credential invalidates its remembered connection.
        if (!saveSettings({...settings,remember:false})) setStorageWarning('Browser storage is unavailable. Close this tab to clear any previously remembered key.');
      }
      setError({field:'apiKey',message:'This key was rejected. Edit it and try again.'});
      return;
    }
    if (result.code === 'model_not_found') {
      setError({field:result.role === 'teacher' ? 'teacher' : 'evaluator',message:'This model was not found or isn’t available for this request. Edit it and try again.'}); return;
    }
    if (result.code === 'invalid_request') {
      setError({field:null,message:'The server rejected these settings. Reload the page and try again.'}); return;
    }
    next.code = ['ok','rate_limited','unreachable'].includes(result.code) ? result.code : 'unreachable';
    const stored = saveSettings(next);
    setStorageWarning(stored ? '' : storageUnavailableNotice);
    if (!stored) next.remember = false;
    setSettings(next); setDraft(next); onSaved?.(next); close();
  }

  const pill = settings.code === 'invalid_key' ? 'Key rejected' : !settings.apiKey ? 'No key' : `${PRESETS[settings.preset].name} · ${{rate_limited:'rate-limited',unreachable:'not verified'}[settings.code] ?? 'ready'}`;
  return <>
    <button ref={trigger} onClick={open} className="mt-3 rounded-full border border-slate-400 px-3 py-1 text-sm"><span aria-live="polite">{pill}</span><span className="sr-only"> — Open model settings</span></button>
    {notices[settings.code] && <p role="status" className="mt-2 text-sm text-amber-900">{notices[settings.code]}</p>}
    {storageWarning && <p role="status" className="mt-2 text-sm text-amber-900">{storageWarning}</p>}
    <dialog ref={dialog} onKeyDown={containFocus} aria-labelledby="settings-title" onCancel={cancelCheck} onClose={() => { cancelCheck(); trigger.current?.focus(); }} className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-xl p-5 shadow-xl backdrop:bg-slate-950/40">
      <form onSubmit={save} className="flex min-w-0 flex-col gap-4">
        <div className="flex items-center justify-between gap-3"><h2 id="settings-title" className="text-xl font-semibold">Model settings</h2><button type="button" onClick={close} aria-label="Close settings" className="rounded border px-3 py-1">Close</button></div>
        {storageWarning && <p role="status" className="text-sm text-amber-900">{storageWarning}</p>}
        <label className="flex flex-col gap-1">Preset<select autoFocus value={draft.preset} onChange={e => change({preset:e.target.value,evaluator:PRESETS[e.target.value].evaluator,teacher:PRESETS[e.target.value].teacher})} className="w-full rounded border p-2">{Object.entries(PRESETS).map(([id,p]) => <option key={id} value={id}>{p.name}</option>)}</select></label>
        <div><label htmlFor="model-key" className="block">API key</label><div className="mt-1 flex gap-2"><input id="model-key" type={showKey ? 'text' : 'password'} value={draft.apiKey} onChange={e => change({apiKey:e.target.value})} autoComplete="off" required aria-invalid={error?.field === 'apiKey'} aria-describedby={error?.field === 'apiKey' ? 'settings-error' : undefined} className="min-w-0 flex-1 rounded border p-2"/><button type="button" aria-pressed={showKey} onClick={() => setShowKey(v=>!v)} className="rounded border px-3">{showKey ? 'Hide' : 'Show'}</button></div><a href={preset.keyUrl} target="_blank" rel="noreferrer" className="text-sm underline">Get a key from {preset.name}</a></div>
        {['evaluator','teacher'].map(role => <label key={role} className="flex flex-col gap-1">{role === 'evaluator' ? 'Evaluator model' : 'Teacher model'}<input value={draft[role]} placeholder={preset[role]} maxLength={MAX_MODEL_CHARS} onChange={e=>change({[role]:e.target.value})} aria-invalid={error?.field === role} aria-describedby={error?.field === role ? 'settings-error' : undefined} className="min-w-0 w-full rounded border p-2"/></label>)}
        <p className="text-sm text-slate-600">Blank model fields use the preset defaults shown above.</p>
        {draft.preset === 'gemini' && <p className="text-sm text-slate-600">Gemini uses the teacher model to check plans and protected replies; the evaluator grades answers.</p>}
        <label className="flex items-start gap-2"><input type="checkbox" checked={draft.remember} onChange={e=>change({remember:e.target.checked})} className="mt-1"/>Remember for this tab</label>
        <p className="text-sm text-slate-600">Your key stays in memory unless you opt in. Remembered keys can be read by scripts on this site and last until this tab closes. Uncheck to remove the saved key.</p>
        {error && <p id="settings-error" role="alert" className="text-red-800">{error.message}</p>}
        <button type="submit" disabled={busy || !draft.apiKey.trim() || !!error} className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">{busy ? 'Checking…' : 'Save and check connection'}</button>
      </form>
    </dialog>
  </>;
}
