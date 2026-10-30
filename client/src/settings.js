import { MAX_MODEL_CHARS } from '../../shared/limits.js';
import { PRESETS } from '../../shared/presets.js';
const STORAGE_KEY = 'teach-me-model-settings';
const defaults = () => ({preset:'gemini', apiKey:'', evaluator:PRESETS.gemini.evaluator, teacher:PRESETS.gemini.teacher, remember:false, code:null});
export function loadSettings(storage) {
  const loaded = {settings:defaults(),storageUnavailable:false};
  let raw;
  try {
    raw = (storage ?? window.sessionStorage).getItem(STORAGE_KEY);
  } catch { return {...loaded,storageUnavailable:true}; }
  try {
    const saved = JSON.parse(raw);
    if (!saved || !Object.hasOwn(PRESETS,saved.preset) || typeof saved.apiKey !== 'string' || !saved.apiKey.trim() || !saved.remember || !['ok','rate_limited','unreachable'].includes(saved.code)) return loaded;
    if (['evaluator','teacher'].some(role => typeof saved[role] !== 'string' || saved[role].length > MAX_MODEL_CHARS)) return loaded;
    return {...loaded,settings:{preset:saved.preset,apiKey:saved.apiKey,evaluator:saved.evaluator,teacher:saved.teacher,remember:true,code:saved.code}};
  } catch { return loaded; }
}
export function saveSettings(settings, storage) {
  try {
    storage ??= window.sessionStorage;
    if (settings.remember) storage.setItem(STORAGE_KEY,JSON.stringify(settings));
    else storage.removeItem(STORAGE_KEY);
    return true;
  } catch { return false; }
}
