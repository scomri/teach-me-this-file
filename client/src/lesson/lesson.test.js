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
  assert.deepEqual(s.source, { ...next, language: null, dir: 'ltr' });
  assert.equal(s.teacher.prompt, 'teach it');
  assert.deepEqual(s.teacher.constraints, noConstraints);
  assert.equal(s.plan, null);
});

test('fileRead with no file (a pick started or failed) empties the source and the plan', () => {
  const s = reduce(reduce(reduce(initialLesson(), { type: 'fileRead', source: doc }), received), { type: 'fileRead', source: null });
  assert.equal(s.source, null);
  assert.equal(s.plan, null);
});

test('fileRead sets the direction from the main script; the language waits for the planner', () => {
  const hebrew = { ...doc, chunks: [{ id: 'c1', page: 1, text: 'Chapter 1' }, { id: 'c2', page: 1, text: 'פוטוסינתזה הופכת אור לסוכר.' }] };
  const s = reduce(initialLesson(), { type: 'fileRead', source: hebrew });
  assert.deepEqual(s.source, { ...hebrew, language: null, dir: 'rtl' });
  assert.deepEqual(hebrew, { ...doc, chunks: hebrew.chunks }); // the ingested file is left as it was
});

test('planReceived names the file language as the planner read it, and a new file forgets it', () => {
  let s = reduce(reduce(initialLesson(), { type: 'fileRead', source: doc }), { ...received, documentLanguage: 'Hebrew' });
  assert.equal(s.source.language, 'Hebrew');
  assert.equal(s.source.dir, 'ltr');
  s = reduce(s, { type: 'fileRead', source: doc });
  assert.equal(s.source.language, null);
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

test('planReceived without constraints still stores the plan and keeps the empty teacher constraints', () => {
  const { constraints: _omitted, ...bare } = received;
  const s = reduce(reduce(initialLesson(), { type: 'fileRead', source: doc }), bare);
  assert.deepEqual(s.teacher.constraints, noConstraints);
  assert.deepEqual(s.plan, { ...plan, coverage: 'partial', coverageNote: 'the Krebs cycle', maxSteps: undefined, requested: { steps: undefined, outsideSources: undefined } });
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
  assert.deepEqual(s.source, { ...doc, language: null, dir: 'ltr' });
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

test('an unknown event leaves the state as it is', () => {
  const s = reduce(initialLesson(), { type: 'fileRead', source: doc });
  assert.equal(reduce(s, { type: 'nope' }), s);
});

// Teaching: start, then one streamed tutor reply at a time.
const two = { ...plan, steps: [plan.steps[0], { ...plan.steps[0], id: 's2', title: 'Two' }] };
const planned = (p = plan) => reduce(reduce(initialLesson(), { type: 'fileRead', source: doc }), { ...received, plan: p });
const begin = { type: 'teachStarted', stepId: 's1', transition: 'opening', chunkIds: ['c1'] };

test('lessonStarted opens step 1 and leaves the other steps pending', () => {
  const s = reduce(planned(two), { type: 'lessonStarted' });
  assert.deepEqual(s.progress, {
    current: 's1',
    steps: {
      s1: { status: 'active', pointsMet: [], fails: 0, asks: 0 },
      s2: { status: 'pending', pointsMet: [], fails: 0, asks: 0 },
    },
  });
  assert.deepEqual(s.messages, []);
});

test('lessonStarted without a plan, or twice, changes nothing', () => {
  const bare = reduce(initialLesson(), { type: 'fileRead', source: doc });
  assert.equal(reduce(bare, { type: 'lessonStarted' }), bare);
  const started = reduce(planned(), { type: 'lessonStarted' });
  assert.equal(reduce(started, { type: 'lessonStarted' }), started);
});

test('teachStarted adds an empty streaming tutor message; chunks append to it', () => {
  let s = reduce(reduce(planned(), { type: 'lessonStarted' }), begin);
  assert.deepEqual(s.messages, [{ role: 'tutor', stepId: 's1', text: '', transition: 'opening', chunkIds: ['c1'], status: 'streaming' }]);
  s = reduce(reduce(s, { type: 'teachChunk', text: 'Plants ' }), { type: 'teachChunk', text: 'eat light.' });
  assert.equal(s.messages[0].text, 'Plants eat light.');
  assert.equal(s.messages[0].status, 'streaming');
});

test('teachStarted before the lesson started changes nothing', () => {
  const s = planned();
  assert.equal(reduce(s, begin), s);
});

test('teachDone, teachStopped and teachFailed set the status and keep the text', () => {
  const streaming = reduce(reduce(reduce(planned(), { type: 'lessonStarted' }), begin), { type: 'teachChunk', text: 'Plants' });
  for (const [type, status] of [['teachDone', 'done'], ['teachStopped', 'stopped'], ['teachFailed', 'failed']]) {
    const s = reduce(streaming, { type });
    assert.equal(s.messages[0].status, status);
    assert.equal(s.messages[0].text, 'Plants');
    assert.deepEqual(s.progress, streaming.progress);
  }
});

test('a late chunk or status after the reply settled changes nothing', () => {
  const stopped = reduce(reduce(reduce(planned(), { type: 'lessonStarted' }), begin), { type: 'teachStopped' });
  assert.equal(reduce(stopped, { type: 'teachChunk', text: 'more' }), stopped);
  assert.equal(reduce(stopped, { type: 'teachDone' }), stopped);
  assert.equal(reduce(stopped, { type: 'teachFailed' }), stopped);
});

test('regenerate replaces the last reply with an empty streaming one of the same transition, progress untouched', () => {
  const done = reduce(reduce(reduce(reduce(planned(), { type: 'lessonStarted' }), begin), { type: 'teachChunk', text: 'Plants' }), { type: 'teachDone' });
  const s = reduce(done, { type: 'regenerate' });
  assert.deepEqual(s.messages, [{ role: 'tutor', stepId: 's1', text: '', transition: 'opening', chunkIds: ['c1'], status: 'streaming' }]);
  assert.deepEqual(s.progress, done.progress);
});

test('regenerate works from a failed or stopped reply, and not while one streams', () => {
  const streaming = reduce(reduce(planned(), { type: 'lessonStarted' }), begin);
  assert.equal(reduce(streaming, { type: 'regenerate' }), streaming);
  for (const type of ['teachFailed', 'teachStopped']) {
    const s = reduce(reduce(streaming, { type }), { type: 'regenerate' });
    assert.equal(s.messages.length, 1);
    assert.equal(s.messages[0].status, 'streaming');
  }
});

test('regenerate with no reply to replace changes nothing', () => {
  const s = reduce(planned(), { type: 'lessonStarted' });
  assert.equal(reduce(s, { type: 'regenerate' }), s);
});

test('a new plan, a new file and New lesson drop progress and messages', () => {
  const taught = reduce(reduce(planned(), { type: 'lessonStarted' }), begin);
  for (const event of [received, { type: 'fileRead', source: doc }, { type: 'planCleared' }]) {
    const s = reduce(taught, event);
    assert.equal(s.progress, null);
    assert.deepEqual(s.messages, []);
  }
  assert.deepEqual(reduce(taught, { type: 'newLesson' }), initialLesson());
});
