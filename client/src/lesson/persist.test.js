import test from 'node:test';
import assert from 'node:assert/strict';
import { initialLesson, reduce, normalizeSaved, savedRecord } from './lesson.js';
import { shouldSave, createWriter } from './persist.js';

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