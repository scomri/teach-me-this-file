import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.js';

const plan = { promptLanguage: 'English', documentLanguage: 'English', coverage: 'full', coverageNote: '', constraints: { language: null, audience: null, style: null, minutes: null, steps: null, outsideSources: false }, plan: { title: 'Lesson', steps: [{ title: 'Light', objective: 'Explain it', chunkIds: ['c1'], checkQuestion: 'Why?', expected: ['energy'] }] } };
const wrapped = (value) => Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] });

test('plan model errors identify the model role for generation and validation', async (t) => {
  for (const preset of ['openai', 'openrouter', 'gemini', 'anthropic']) {
    const role = 'teacher';
    const settings = { preset, teacher: 'teacher-model', evaluator: 'evaluator-model' };
    const post = await serve(t, async (_, init) => JSON.parse(init.body).response_format?.json_schema?.name === 'lesson_plan' ? wrapped(plan) : new Response('{}', { status: 404 }));
    const input = { ...settings, prompt: 'teach', chunks: [{ id: 'c1', text: 'light' }] };
    assert.deepEqual(await (await post('plan', input)).json(), { code: 'model_not_found', role });
    assert.deepEqual(await (await post('plan/check', { ...settings, steps: [{ checkQuestion: 'Why?', expected: ['energy'] }] })).json(), { code: 'model_not_found', role });
  }
});

test('a missing teacher model is identified during plan generation', async (t) => {
  const post = await serve(t, async () => new Response('{}', { status: 404 }));
  const response = await post('plan', { preset: 'openai', prompt: 'teach', chunks: [{ id: 'c1', text: 'light' }] });
  assert.deepEqual(await response.json(), { code: 'model_not_found', role: 'teacher' });
});

test('plan questions are checked, repaired and checked again before a plan is returned', async (t) => {
  const calls = [];
  const replies = [plan, { flagged: [0], uncertain: false }, plan, { flagged: [], uncertain: false }];
  const app = createApp({ log() {}, providerFetch: async (_, init) => { calls.push(JSON.parse(init.body)); return wrapped(replies.shift()); } });
  const server = app.listen(0); t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'key' }, body: JSON.stringify({ preset: 'gemini', prompt: 'teach', chunks: [{ id: 'c1', text: 'light' }] }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).plan.validated, true);
  assert.equal(calls.length, 4);
  assert.match(calls[2].messages.at(-1).content, /step 1/i);
});

test('a rejected tutor draft is never sent, even partially', async (t) => {
  const calls = [];
  const app = createApp({ log() {}, providerFetch: async (_, init) => {
    const body = JSON.parse(init.body); calls.push(body);
    if (!body.stream) return wrapped({ flagged: [0], uncertain: false });
    return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: 'The secret is energy.' } }] }) + '\n\ndata: [DONE]\n\n');
  } });
  const server = app.listen(0); t.after(() => server.close());
  const request = { preset: 'gemini', transition: 'opening', lesson: { language: 'English' }, step: { index: 1, total: 1, title: 'Light', objective: 'Explain', checkQuestion: 'Why?' }, protectedPoints: ['energy'], questionValidated: true, chunks: [{ id: 'c1', text: 'energy' }] };
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/teach`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'key' }, body: JSON.stringify(request) });
  const body = await response.text();
  assert.doesNotMatch(body, /The secret is energy/);
  assert.match(body, /Why\?/);
  assert.equal(calls.length, 2);
});

test('protected drafts are checked against their supplied source before display', async (t) => {
  let validation;
  const post = await serve(t, async (_, init) => {
    const body = JSON.parse(init.body);
    if (body.stream) return streamText('Water boils at 100 degrees.');
    validation = body.messages;
    return wrapped({ flagged: [0], uncertain: false });
  });
  const text = await (await post('teach', requestFor('opening', { chunks: [{ id: 'c1', text: 'Water freezes at zero.' }] }))).text();
  assert.doesNotMatch(text, /Water boils/);
  assert.match(validation[0].content, /unsupported|ground/i);
  assert.match(validation[0].content, /misleading.*bounds/i);
  assert.match(validation[1].content, /Water freezes at zero/);
});

const requestFor = (transition, extra = {}) => ({ preset: 'gemini', evaluator: 'checker', transition, lesson: { language: 'English' }, step: { index: 1, total: 2, title: 'Light', objective: 'Explain', checkQuestion: 'Why?' }, protectedPoints: ['energy'], questionValidated: true, chunks: [{ id: 'c1', text: 'energy' }], ...extra });
const answered = { title: 'Light', checkQuestion: 'Why?', expected: ['energy', 'water'], pointsMet: [1] };
const streamText = (value) => new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: value } }] }) + '\n\ndata: [DONE]\n\n');
async function serve(t, providerFetch) {
  const app = createApp({ log() {}, providerFetch }); const server = app.listen(0); t.after(() => server.close());
  return async (path, body, key = 'key') => fetch(`http://127.0.0.1:${server.address().port}/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key && { 'X-Api-Key': key }) }, body: JSON.stringify(body) });
}

test('Gemini and Anthropic use their configured teacher for checks; OpenAI keeps its evaluator', async (t) => {
  const calls = [];
  const post = await serve(t, async (_, init) => {
    const body = JSON.parse(init.body); calls.push(body);
    if (body.stream) return streamText('A safe question?');
    if (body.response_format?.json_schema?.name === 'lesson_plan') return wrapped(plan);
    return wrapped({ flagged: [], uncertain: false });
  });
  const settings = { preset: 'gemini', teacher: 'teacher-model', evaluator: 'grader-model' };
  assert.equal((await post('plan', { ...settings, prompt: 'teach', chunks: [{ id: 'c1', text: 'light' }] })).status, 200);
  assert.equal(calls.at(-1).model, 'teacher-model');
  assert.equal((await post('plan/check', { ...settings, steps: [{ checkQuestion: 'Why?', expected: ['energy'] }] })).status, 200);
  assert.equal(calls.at(-1).model, 'teacher-model');
  await (await post('teach', requestFor('opening', settings))).text();
  assert.equal(calls.at(-1).model, 'teacher-model');
  await (await post('teach', requestFor('opening', { ...settings, preset: 'anthropic' }))).text();
  assert.equal(calls.at(-1).model, 'teacher-model');
  assert.equal((await post('plan/check', { ...settings, preset: 'anthropic', steps: [{ checkQuestion: 'Why?', expected: ['energy'] }] })).status, 200);
  assert.equal(calls.at(-1).model, 'teacher-model');
  assert.equal((await post('plan', { ...settings, preset: 'anthropic', prompt: 'teach', chunks: [{ id: 'c1', text: 'light' }] })).status, 200);
  assert.equal(calls.at(-1).model, 'teacher-model');
  await (await post('teach', requestFor('opening', { ...settings, preset: 'openai' }))).text();
  assert.equal(calls.at(-1).model, 'teacher-model');
});

test('every protected transition fails closed on malformed validation, with localized fallbacks', async (t) => {
  const calls = [];
  const post = await serve(t, async (_, init) => { const body = JSON.parse(init.body); calls.push(body); return body.stream ? streamText('SECRET DRAFT') : wrapped({ uncertain: true }); });
  const cases = [
    requestFor('opening'), requestFor('nudge', { answered }), requestFor('scaffold', { answered }),
    requestFor('answer_question', { questionCovered: true, lesson: { language: 'he-IL' } }),
    requestFor('redirect', { lesson: { language: 'Arabic' } }),
    requestFor('advance', { answered: { ...answered, pointsMet: [0, 1] }, step: { index: 2, total: 2, title: 'Next', objective: 'Explain', checkQuestion: 'Next?' } }),
  ];
  for (const body of cases) {
    const res = await post('teach', body); assert.equal(res.status, 200);
    const text = await res.text(); assert.doesNotMatch(text, /SECRET DRAFT/); assert.match(text, /event: done/);
    if (body.transition === 'answer_question') assert.match(text, /לא הצלחתי/);
    if (body.transition === 'redirect') assert.match(text, /شخص بالغ/);
  }
  assert.equal(calls.length, 12);
  assert.ok(calls.filter((c) => !c.stream).every((c) => c.model === 'gemini-3.8-flash'));
});

test('a draft that opens a step is flagged as one and checked against its check question; other moves are not', async (t) => {
  const candidates = [];
  const post = await serve(t, async (_, init) => {
    const body = JSON.parse(init.body);
    if (body.stream) return streamText('Safe text');
    candidates.push(body.messages[1].content);
    return wrapped({ flagged: [], uncertain: false });
  });
  await (await post('teach', requestFor('opening'))).text();
  await (await post('teach', requestFor('advance', { answered: { ...answered, pointsMet: [0, 1] }, step: { index: 2, total: 2, title: 'Next', objective: 'Explain', checkQuestion: 'Next?' } }))).text();
  await (await post('teach', requestFor('nudge', { answered }))).text();
  const question = (c) => c.match(/"checkQuestion":("(?:[^"\\]|\\.)*")/)?.[1];
  assert.deepEqual(candidates.map((c) => [c.includes('"opensStep":true'), question(c)]), [[true, '"Why?"'], [true, '"Next?"'], [false, undefined]]);
});

test('approved drafts appear only after validation; reveal and recap skip the check', async (t) => {
  const calls = [];
  const post = await serve(t, async (_, init) => { const body = JSON.parse(init.body); calls.push(body); return body.stream ? streamText('Safe text') : wrapped({ flagged: [], uncertain: false }); });
  assert.match(await (await post('teach', requestFor('opening'))).text(), /Safe text/);
  assert.match(await (await post('teach', requestFor('reveal', { answered }))).text(), /Safe text/);
  assert.match(await (await post('teach', requestFor('recap', { recap: { mastered: [], revealed: ['Light'] } }))).text(), /Safe text/);
  assert.equal(calls.filter((c) => !c.stream).length, 1);
});

test('validator failure and missing key cannot validate a restored plan', async (t) => {
  let count = 0;
  const post = await serve(t, async () => { count++; return new Response('bad', { status: 503 }); });
  const request = { preset: 'gemini', steps: [{ checkQuestion: 'Why?', expected: ['energy'] }] };
  assert.equal((await post('plan/check', request, '')).status, 401);
  assert.equal((await post('plan/check', request)).status, 502);
  assert.equal(count, 1);
});

test('plan validation preserves evaluator credential failures', async (t) => {
  let calls = 0;
  const post = await serve(t, async () => ++calls === 1 ? wrapped(plan) : new Response('{}', { status: 401 }));
  const res = await post('plan', { preset: 'gemini', prompt: 'teach', chunks: [{ id: 'c1', text: 'light' }] });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).code, 'invalid_key');
  const check = await post('plan/check', { preset: 'gemini', steps: [{ checkQuestion: 'Why?', expected: ['energy'] }] });
  assert.equal(check.status, 401);
});

test('advance and redirect fallbacks retain their transition purpose', async (t) => {
  const post = await serve(t, async (_, init) => JSON.parse(init.body).stream ? streamText('draft') : wrapped({ flagged: [0], uncertain: false }));
  const advance = await (await post('teach', requestFor('advance', { answered: { ...answered, pointsMet: [0, 1] } }))).text();
  assert.match(advance, /correct/i);
  const redirect = await (await post('teach', requestFor('redirect'))).text();
  assert.match(redirect, /trusted adult/i);
});

test('validation uses the remaining shared rate limit retry and never retries malformed results', async (t) => {
  let validationCalls = 0;
  const post = await serve(t, async (_, init) => {
    const body = JSON.parse(init.body);
    if (body.stream) return streamText('draft');
    validationCalls++;
    return validationCalls % 2 ? new Response('{}', { status: 429 }) : wrapped({ flagged: [], uncertain: false });
  });
  assert.match(await (await post('teach', requestFor('opening'))).text(), /draft/);
  assert.equal(validationCalls, 2);
  validationCalls = 0;
  const rejected = await (await post('teach', requestFor('opening', { rateLimitRetried: true }))).text();
  assert.doesNotMatch(rejected, /draft/);
  assert.equal(validationCalls, 1);
});

test('cancelling during validation discards the draft and aborts the validator', async (t) => {
  let started; const entered = new Promise((resolve) => { started = resolve; }); let aborted = false;
  const post = await serve(t, async (_, init) => {
    if (JSON.parse(init.body).stream) return streamText('PRIVATE DRAFT');
    started(); return new Promise((_, reject) => init.signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }));
  });
  const res = await post('teach', requestFor('opening')); const reader = res.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value); await entered;
  const id = /"id":"([^"]+)"/.exec(first)[1];
  assert.equal((await post(`streams/${id}/cancel`, {})).status, 204);
  let rest = ''; for (;;) { const chunk = await reader.read(); if (chunk.done) break; rest += new TextDecoder().decode(chunk.value); }
  assert.doesNotMatch(first + rest, /PRIVATE DRAFT/); assert.equal(aborted, true);
});

test('plan validator fails closed and identifies questions still flagged after repair', async (t) => {
  const replies = [plan, { flagged: [0], uncertain: false }, plan, { flagged: [0], uncertain: false }];
  const post = await serve(t, async () => wrapped(replies.shift()));
  const res = await post('plan', { preset: 'gemini', prompt: 'teach', chunks: [{ id: 'c1', text: 'light' }] });
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { code: 'plan_invalid', flagged: [1] });
  assert.equal(replies.length, 0);
});

test('no coverage does not call the disclosure validator', async (t) => {
  let calls = 0;
  const post = await serve(t, async () => { calls++; return wrapped({ ...plan, coverage: 'none', coverageNote: 'No match', plan: { title: '', steps: [] } }); });
  const res = await post('plan', { preset: 'gemini', prompt: 'another topic', chunks: [{ id: 'c1', text: 'light' }] });
  assert.equal((await res.json()).plan, null); assert.equal(calls, 1);
});


test('a truncated protected provider stream is not displayed or checked', async (t) => {
  let calls = 0;
  const post = await serve(t, async () => { calls++; return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: 'PARTIAL SECRET' } }] }) + '\n\n'); });
  const text = await (await post('teach', requestFor('opening'))).text();
  assert.doesNotMatch(text, /PARTIAL SECRET/);
  assert.match(text, /unreachable/);
  assert.equal(calls, 1);
});


test('an unavailable recheck reports validation failure and the previously flagged step', async (t) => {
  const replies = [plan, { flagged: [0], uncertain: false }, plan];
  const post = await serve(t, async () => replies.length ? wrapped(replies.shift()) : new Response('{}', { status: 503 }));
  const res = await post('plan', { preset: 'gemini', prompt: 'teach', chunks: [{ id: 'c1', text: 'light' }] });
  assert.deepEqual(await res.json(), { code: 'unreachable', flagged: [1] });
});


test('a provider output stopped by its token limit is not displayed', async (t) => {
  const post = await serve(t, async () => new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: 'TRUNCATED SECRET' }, finish_reason: 'length' }] }) + '\n\ndata: [DONE]\n\n'));
  const text = await (await post('teach', requestFor('opening'))).text();
  assert.doesNotMatch(text, /TRUNCATED SECRET/); assert.match(text, /unreachable/);
});

test('an in-band provider error after partial content discards the draft', async (t) => {
  let calls = 0;
  const post = await serve(t, async () => {
    calls++;
    return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: 'PRIVATE PARTIAL' } }] }) + '\n\nevent: error\ndata: ' + JSON.stringify({ error: { message: 'provider failed' } }) + '\n\ndata: [DONE]\n\n');
  });
  const text = await (await post('teach', requestFor('opening'))).text();
  assert.doesNotMatch(text, /PRIVATE PARTIAL/);
  assert.match(text, /unreachable/);
  assert.equal(calls, 1);
});

test('regional lesson languages retain their localized fallback after plan normalization', async (t) => {
  const { resolveConstraints } = await import('./ai/plan.js');
  const post = await serve(t, async (_, init) => JSON.parse(init.body).stream ? streamText('draft') : wrapped({ flagged: [0], uncertain: false }));
  for (const [code, expected] of [['he-IL', /כדאי/], ['ar-EG', /راجع المادة/]]) {
    const language = resolveConstraints({ ...plan, constraints: { ...plan.constraints, language: code } }).language;
    const text = await (await post('teach', requestFor('opening', { lesson: { language } }))).text();
    assert.match(text, expected);
  }
});

test('a failed repair retains flagged steps on provider errors and network failures', async (t) => {
  for (const failure of [429, 401, 'network']) {
    let calls = 0;
    const post = await serve(t, async () => {
      calls++;
      if (calls === 1) return wrapped(plan);
      if (calls === 2) return wrapped({ flagged: [0], uncertain: false });
      if (failure === 'network') throw new Error('offline');
      return new Response('{}', { status: failure });
    });
    const response = await post('plan', { preset: 'gemini', prompt: 'teach', chunks: [{ id: 'c1', text: 'light' }] });
    const body = await response.json();
    assert.deepEqual(body.flagged, [1]);
    assert.equal(body.code, failure === 429 ? 'rate_limited' : failure === 401 ? 'invalid_key' : 'unreachable');
  }
});
