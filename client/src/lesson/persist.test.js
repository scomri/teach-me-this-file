import test from 'node:test';
import assert from 'node:assert/strict';
import { initialLesson, reduce, normalizeSaved, savedRecord } from './lesson.js';
import { shouldSave } from './persist.js';

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
