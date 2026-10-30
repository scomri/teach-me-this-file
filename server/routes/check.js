import { Router } from 'express';
import { PRESETS } from '../../shared/presets.js';
import { chatCompletion } from '../ai/adapter.js';

export function checkRouter(fetchImpl, timeoutMs = 10000) {
  const router = Router();
  router.post('/check', async (req, res) => {
    const { preset, evaluator, teacher } = req.body ?? {};
    if (!Object.hasOwn(PRESETS, preset) || [evaluator, teacher].some(x => x !== undefined && (typeof x !== 'string' || x.length > 200))) {
      return res.status(400).json({ code: 'unreachable' });
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
          await response.body?.cancel();
          code = response.ok ? 'ok' : [401,403].includes(response.status) ? 'invalid_key' : response.status === 404 ? 'model_not_found' : response.status === 429 ? 'rate_limited' : 'unreachable';
        } catch (error) {
          if (controller.signal.aborted) throw error;
        }
        if (code === 'invalid_key' || code === 'model_not_found') return res.json({ code, ...(code === 'model_not_found' ? {role} : {}) });
        if (code !== 'ok') warning = code;
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
