import test from 'node:test';
import assert from 'node:assert/strict';
import { initialLesson, reduce, normalizeSaved, savedRecord, splitSaved, joinSaved } from './lesson.js';
import { shouldSave, createWriter, coalesce, writeOp } from './persist.js';

const doc = { kind: 'txt', name: 'a.txt', chunks: [{ id: 'c1', page: null, text: 'Photosynthesis.' }] };
const plan = { title: 'A lesson', steps: [{ id: 's1', title: 'One', objective: 'o', chunkIds: ['c1'], checkQuestion: 'q?', expected: ['p'] }] };
const constraints = { language: 'English', audience: null, style: null, minutes: null, steps: null, outsideSources: false, maxSteps: 5 };
const planned = () => reduce(reduce(initialLesson(), { type: 'fileRead', source: doc }), { type: 'planReceived', plan, constraints, coverage: 'full', coverageNote: null });
const midLesson = () => reduce(reduce(planned(), { type: 'lessonStarted' }), { type: 'teachStarted', stepId: 's1', transition: 'open', chunkIds: ['c1'] });

test('normalizeSaved turns a streaming reply into stopped, keeping its text', () => {
  const saved = reduce(midLesson(), { type: 'teachChunk', text: 'Plants make ' });
  const { lesson, discarded } = normalizeSaved(saved);
  assert.equal(discarded, false);
  assert.equal(lesson.messages.at(-1).status, 'stopped');
  assert.equal(lesson.messages.at(-1).text, 'Plants make ');
  assert.equal(reduce(lesson, { type: 'regenerate' }).messages.at(-1).status, 'streaming');
});

test('normalizeSaved discards a version mismatch or a non-lesson', () => {
  for (const bad of [{ ...initialLesson(), version: 2 }, 'x', {}]) {
    assert.deepEqual(normalizeSaved(bad), { lesson: null, discarded: true });
  }
});

test('normalizeSaved discards a record without a teacher object', () => {
  for (const teacher of [undefined, null, 'x']) {
    assert.deepEqual(normalizeSaved({ ...initialLesson(), teacher }), { lesson: null, discarded: true });
  }
});

test('normalizeSaved passes a valid lesson through; nothing saved is not a discard', () => {
  const plain = planned();
  assert.deepEqual(normalizeSaved(plain), { lesson: plain, discarded: false });
  assert.deepEqual(normalizeSaved(undefined), { lesson: null, discarded: false });
  const done = reduce(midLesson(), { type: 'teachDone' });
  assert.deepEqual(normalizeSaved(done).lesson, done);
});

test('savedRecord holds lesson state only: no API key, no settings', () => {
  const state = { ...midLesson(), apiKey: 'sk-secret', settings: { apiKey: 'sk-secret' } };
  const rec = savedRecord(state);
  assert.deepEqual(Object.keys(rec).sort(), ['messages', 'plan', 'progress', 'source', 'teacher', 'version']);
  assert.ok(!JSON.stringify(rec).includes('sk-secret'));
});

test('shouldSave skips stream chunks and saves every other change', () => {
  const started = midLesson();
  const chunk = reduce(started, { type: 'teachChunk', text: 'a' });
  assert.equal(shouldSave(started, chunk), false);
  assert.equal(shouldSave(chunk, reduce(chunk, { type: 'teachChunk', text: 'b' })), false);
  assert.equal(shouldSave(planned(), started), true);
  assert.equal(shouldSave(chunk, reduce(chunk, { type: 'teachDone' })), true);
  assert.equal(shouldSave(chunk, reduce(chunk, { type: 'teachStopped' })), true);
  assert.equal(shouldSave(chunk, reduce(chunk, { type: 'teachFailed' })), true);
  assert.equal(shouldSave(started, started), false);
});

const gated = () => { // a store whose writes finish when released
  const log = []; const gates = [];
  const perform = (op) => { log.push(op); return new Promise((res, rej) => gates.push({ res, rej })); };
  return { log, gates, perform };
};

test('a burst of saves during a write leaves two writes, the second with the last record', async () => {
  const { log, gates, perform } = gated();
  const write = createWriter(perform);
  const all = [1, 2, 3, 4, 5].map((n) => write({ type: 'put', record: n }));
  assert.equal(log.length, 1);
  gates[0].res();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(log, [{ type: 'put', record: 1 }, { type: 'put', record: 5 }]);
  gates[1].res();
  await Promise.all(all);
});

test('a clear after a put lands last', async () => {
  const { log, gates, perform } = gated();
  const write = createWriter(perform);
  const a = write({ type: 'put', record: 1 });
  const b = write({ type: 'put', record: 2 });
  const c = write({ type: 'clear' });
  gates[0].res(); await new Promise((r) => setImmediate(r)); gates[1].res();
  await Promise.all([a, b, c]);
  assert.deepEqual(log.map((o) => o.type), ['put', 'clear']);
});

test('a failing write rejects its callers, and later writes still run', async () => {
  const { log, gates, perform } = gated();
  const write = createWriter(perform);
  const a = write({ type: 'put', record: 1 });
  const b = write({ type: 'put', record: 2 });
  gates[0].rej(new Error('blocked'));
  await assert.rejects(a, /blocked/);
  await new Promise((r) => setImmediate(r));
  gates[1].res();
  await b;
  assert.equal(log.length, 2);
});
test('the saved pair holds lesson state only, the file in its own record', () => {
  const state = { ...midLesson(), apiKey: 'sk-secret', settings: { apiKey: 'sk-secret' } };
  const { main, source } = splitSaved(state);
  assert.deepEqual(Object.keys(main).sort(), ['hasSource', 'messages', 'plan', 'progress', 'teacher', 'version']);
  assert.equal(source, state.source);
  assert.ok(!JSON.stringify([main, source]).includes('sk-secret'));
});

test('joinSaved rebuilds the lesson from its two records, and flags a mismatched pair', () => {
  const s = reduce(midLesson(), { type: 'teachDone' });
  const { main, source } = splitSaved(s);
  assert.deepEqual(normalizeSaved(joinSaved(main, source)).lesson, s);
  assert.equal(joinSaved(undefined, undefined), undefined);
  const typed = reduce(initialLesson(), { type: 'promptChanged', prompt: 'hi' }); // no file: no source record
  assert.deepEqual(normalizeSaved(joinSaved(splitSaved(typed).main, undefined)).lesson, typed);
  for (const [m, src] of [[main, undefined], [undefined, source], [{ ...main, hasSource: false }, source]]) {
    assert.deepEqual(normalizeSaved(joinSaved(m, src)), { lesson: null, discarded: true });
  }
});

test('writeOp writes the file only when it changed', () => {
  const s = planned();
  assert.equal(writeOp(s, null).writeSource, true);
  assert.equal(writeOp(s, s.source).writeSource, false);
  const typed = reduce(s, { type: 'promptChanged', prompt: 'more' });
  assert.equal(writeOp(typed, s.source).writeSource, false);
  assert.equal(writeOp(reduce(typed, { type: 'fileRead', source: { ...doc, name: 'b.txt' } }), s.source).writeSource, true);
});

test('a superseded save still writes the newer file; a put after a clear writes it too', () => {
  const a = { type: 'put', main: 1, source: 'A', writeSource: true };
  const b = { type: 'put', main: 2, source: 'A', writeSource: false };
  assert.deepEqual(coalesce(a, b), { type: 'put', main: 2, source: 'A', writeSource: true });
  assert.deepEqual(coalesce(b, { ...a, source: 'B' }), { type: 'put', main: 1, source: 'B', writeSource: true });
  assert.deepEqual(coalesce(a, { type: 'clear' }), { type: 'clear' });
  assert.equal(coalesce({ type: 'clear' }, b).writeSource, true);
  assert.equal(coalesce(undefined, b).writeSource, false);
});