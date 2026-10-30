import { Router } from 'express';
import { PRESETS } from '../../shared/presets.js';
import { chatCompletion } from '../ai/adapter.js';

// Some providers (OpenRouter) answer an unknown model with 400, not 404. The body is matched, never forwarded.
const UNKNOWN_MODEL = /model_not_found|not a valid model|models?\b[^.]{0,80}?(not found|does not exist)|(invalid|unknown) model/i;

async function outcome(response) {
  if (response.ok) return 'ok';
  if ([401, 403].includes(response.status)) return 'invalid_key';
  if (response.status === 404) return 'model_not_found';
  if (response.status === 429) return 'rate_limited';
  if (response.status === 400 && UNKNOWN_MODEL.test(await response.text())) return 'model_not_found';
  return 'unreachable';
}

export function checkRouter(fetchImpl, timeoutMs = 10000) {
  const router = Router();
  router.post('/check', async (req, res) => {
    const { preset, evaluator, teacher } = req.body ?? {};
    if (!Object.hasOwn(PRESETS, preset) || [evaluator, teacher].some(x => x !== undefined && (typeof x !== 'string' || x.length > 200))) {
      return res.status(400).json({ code: 'invalid_request' });
    }
    const apiKey = req.get('X-Api-Key')?.trim();
    if (!apiKey) return res.json({ code: 'invalid_key' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnect);
    try {
      let warning = 'ok';
      for (const role of ['evaluator', 'teacher']) {
        let code = 'unreachable';
        try {
          const response = await chatCompletion({preset, apiKey, model: req.body[role]?.trim() || PRESETS[preset][role], messages: [{role:'user',content:'Hi'}], signal: controller.signal}, fetchImpl);
          code = await outcome(response);
          if (!response.bodyUsed) await response.body?.cancel();
        } catch (error) {
          if (controller.signal.aborted) throw error;
        }
        if (code === 'invalid_key' || code === 'model_not_found') return res.json({ code, ...(code === 'model_not_found' ? {role} : {}) });
        if (code === 'unreachable' || (code === 'rate_limited' && warning === 'ok')) warning = code;
      }
      res.json({code:warning});
    } catch {
      if (!res.destroyed) res.json({code:'unreachable'});
    } finally {
      clearTimeout(timer); res.off('close', disconnect);
    }
  });
  return router;
}
