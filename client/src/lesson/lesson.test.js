import test from 'node:test';
import assert from 'node:assert/strict';
import { initialLesson, reduce } from './lesson.js';

const doc = { kind: 'txt', name: 'a.txt', chunks: [{ id: 'c1', page: null, text: 'Photosynthesis.' }] };
const plan = { title: 'A lesson', steps: [{ id: 's1', title: 'One', objective: 'o', chunkIds: ['c1'], checkQuestion: 'q?', expected: ['p'] }] };
const constraints = { language: 'English', audience: null, style: null, minutes: null, steps: null, outsideSources: false, maxSteps: 5 };
const received = { type: 'planReceived', plan, constraints, coverage: 'partial', coverageNote: 'the Krebs cycle' };
const noConstraints = { language: null, minutes: null, audience: null, style: null };

test('a new lesson is in setup: no file, empty prompt, no plan, no progress, no messages', () => {
  assert.deepEqual(initialLesson(), {
    version: 1,
    source: null,
    teacher: { prompt: '', constraints: noConstraints },
    plan: null,
    progress: null,
    messages: [],
  });
});

test('promptChanged sets the prompt and touches nothing else', () => {
  const before = reduce(reduce(initialLesson(), { type: 'fileRead', source: doc }), received);
  const after = reduce(before, { type: 'promptChanged', prompt: 'teach it' });
  assert.equal(after.teacher.prompt, 'teach it');
  assert.deepEqual({ ...after, teacher: before.teacher }, before);
  assert.equal(before.teacher.prompt, '');
});

test('fileRead stores the file, keeps the typed prompt and drops the plan of the old file', () => {
  let s = reduce(initialLesson(), { type: 'promptChanged', prompt: 'teach it' });
  s = reduce(reduce(s, { type: 'fileRead', source: doc }), received);
  assert.ok(s.plan);
  const next = { ...doc, name: 'b.txt' };
  s = reduce(s, { type: 'fileRead', source: next });
  assert.equal(s.source, next);
  assert.equal(s.teacher.prompt, 'teach it');
  assert.deepEqual(s.teacher.constraints, noConstraints);
  assert.equal(s.plan, null);
});

test('fileRead with no file (a pick started or failed) empties the source and the plan', () => {
  const s = reduce(reduce(reduce(initialLesson(), { type: 'fileRead', source: doc }), received), { type: 'fileRead', source: null });
  assert.equal(s.source, null);
  assert.equal(s.plan, null);
});

test('planReceived stores the teacher constraints, and the plan with its coverage and the requests it bounded', () => {
  const asked = { ...constraints, minutes: 5, steps: 20, outsideSources: true, maxSteps: 2 };
  const s = reduce(reduce(initialLesson(), { type: 'fileRead', source: doc }), { ...received, constraints: asked });
  assert.deepEqual(s.teacher.constraints, { language: 'English', minutes: 5, audience: null, style: null });
  assert.deepEqual(s.plan, {
    ...plan, coverage: 'partial', coverageNote: 'the Krebs cycle', maxSteps: 2, requested: { steps: 20, outsideSources: true },
  });
  assert.equal(s.progress, null);
  assert.deepEqual(s.messages, []);
});

test('planReceived replaces an earlier plan', () => {
  const second = { ...received, plan: { ...plan, title: 'Another' }, coverage: 'full', coverageNote: '' };
  const s = reduce(reduce(initialLesson(), received), second);
  assert.equal(s.plan.title, 'Another');
  assert.equal(s.plan.coverage, 'full');
});

test('planCleared returns to setup and keeps the file and the prompt', () => {
  let s = reduce(initialLesson(), { type: 'fileRead', source: doc });
  s = reduce(s, { type: 'promptChanged', prompt: 'teach it' });
  s = reduce(reduce(s, received), { type: 'planCleared' });
  assert.equal(s.plan, null);
  assert.deepEqual(s.teacher.constraints, noConstraints);
  assert.equal(s.source, doc);
  assert.equal(s.teacher.prompt, 'teach it');
});

test('newLesson starts over, prompt included', () => {
  let s = reduce(initialLesson(), { type: 'fileRead', source: doc });
  s = reduce(reduce(s, { type: 'promptChanged', prompt: 'teach it' }), received);
  assert.deepEqual(reduce(s, { type: 'newLesson' }), initialLesson());
});

test('reduce does not mutate its input', () => {
  const s = reduce(initialLesson(), { type: 'fileRead', source: doc });
  const frozen = structuredClone(s);
  reduce(s, received);
  reduce(s, { type: 'promptChanged', prompt: 'x' });
  reduce(s, { type: 'planCleared' });
  assert.deepEqual(s, frozen);
});

test('an unknown event is an error, not a silent no-op', () => {
  assert.throws(() => reduce(initialLesson(), { type: 'nope' }), /nope/);
});
