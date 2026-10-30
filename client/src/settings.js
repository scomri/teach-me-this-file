import { PRESETS } from '../../shared/presets.js';
const STORAGE_KEY = 'teach-me-model-settings';
const defaults = () => ({preset:'gemini', apiKey:'', evaluator:PRESETS.gemini.evaluator, teacher:PRESETS.gemini.teacher, remember:false, code:null});
export function loadSettings(storage) {
  try {
    const saved = JSON.parse((storage ?? window.sessionStorage).getItem(STORAGE_KEY));
    if (!saved || !Object.hasOwn(PRESETS,saved.preset) || typeof saved.apiKey !== 'string' || !saved.apiKey.trim() || !saved.remember || !['ok','rate_limited','unreachable'].includes(saved.code)) return defaults();
    if (['evaluator','teacher'].some(role => typeof saved[role] !== 'string' || saved[role].length > 200)) return defaults();
    return {preset:saved.preset,apiKey:saved.apiKey,evaluator:saved.evaluator,teacher:saved.teacher,remember:true,code:saved.code};
  } catch { return defaults(); }
}
export function saveSettings(settings, storage) {
  try {
    storage ??= window.sessionStorage;
    if (settings.remember) storage.setItem(STORAGE_KEY,JSON.stringify(settings));
    else storage.removeItem(STORAGE_KEY);
    return true;
  } catch { return false; }
}
