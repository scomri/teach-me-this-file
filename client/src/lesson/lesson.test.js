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

// Answering: the student's message, its evaluation, and the move code picks from it.
const three = {
  title: 'A lesson',
  steps: [
    { id: 's1', title: 'One', objective: 'o', chunkIds: ['c1'], checkQuestion: 'q1?', expected: ['a', 'b'] },
    { id: 's2', title: 'Two', objective: 'o', chunkIds: ['c1'], checkQuestion: 'q2?', expected: ['c'] },
    { id: 's3', title: 'Three', objective: 'o', chunkIds: ['c1'], checkQuestion: 'q3?', expected: ['d'] },
  ],
};
// A started lesson whose first step has been opened (the opening reply is done).
const opened = (p = three) => reduce(reduce(reduce(planned(p), { type: 'lessonStarted' }), begin), { type: 'teachDone' });
const answer = (s, text, evaluation) => {
  s = reduce(s, { type: 'answerSent', text });
  return reduce(s, { type: 'evaluated', evaluation: { relevantChunkIds: [], ...evaluation } });
};
const ans = (...keyPointsMet) => ({ intent: 'answer', keyPointsMet });
const step = (s, id) => s.progress.steps[id];

test('answerSent adds a student message with no intent yet; the progress is untouched', () => {
  const before = opened();
  const s = reduce(before, { type: 'answerSent', text: 'light' });
  assert.deepEqual(s.messages.at(-1), { role: 'student', stepId: 's1', text: 'light', intent: null });
  assert.deepEqual(s.progress, before.progress);
});

test('answerSent is ignored while a reply streams, while an answer awaits its evaluation, or with no active step', () => {
  const streaming = reduce(reduce(planned(three), { type: 'lessonStarted' }), begin);
  assert.equal(reduce(streaming, { type: 'answerSent', text: 'x' }), streaming);
  const pending = reduce(opened(), { type: 'answerSent', text: 'x' });
  assert.equal(reduce(pending, { type: 'answerSent', text: 'y' }), pending);
  const revealed = answer(answer(opened(), 'a', ans()), 'b', ans());
  assert.equal(step(revealed, 's1').status, 'revealed');
  assert.equal(reduce(revealed, { type: 'answerSent', text: 'y' }), revealed);
  const unstarted = planned(three);
  assert.equal(reduce(unstarted, { type: 'answerSent', text: 'x' }), unstarted);
});

test('a correct answer meets every point, masters the step and moves to the next with an advance', () => {
  const s = answer(opened(), 'a and b', ans(0, 1));
  assert.deepEqual(s.messages.at(-1), { role: 'student', stepId: 's1', text: 'a and b', intent: 'answer', result: 'correct', transition: 'advance', relevantChunkIds: [] });
  assert.deepEqual(step(s, 's1'), { status: 'mastered', pointsMet: [0, 1], fails: 0, asks: 0 });
  assert.equal(step(s, 's2').status, 'active');
  assert.equal(s.progress.current, 's2');
});

test('a partial answer with a new point keeps the step active, counts no failure and nudges', () => {
  const s = answer(opened(), 'a', ans(0));
  assert.equal(s.messages.at(-1).result, 'partial');
  assert.equal(s.messages.at(-1).transition, 'nudge');
  assert.deepEqual(step(s, 's1'), { status: 'active', pointsMet: [0], fails: 0, asks: 0 });
  assert.equal(s.progress.current, 's1');
});

test('a partial answer that adds no new point counts a failed attempt', () => {
  const s = answer(answer(opened(), 'a', ans(0)), 'a again', ans(0));
  assert.equal(s.messages.at(-1).result, 'partial');
  assert.equal(s.messages.at(-1).transition, 'nudge');
  assert.equal(step(s, 's1').fails, 1);
  assert.deepEqual(step(s, 's1').pointsMet, [0]);
});

test('a wrong answer on attempt 1 nudges and on attempt 2 reveals, with the step revealed', () => {
  const first = answer(opened(), 'x', ans());
  assert.equal(first.messages.at(-1).result, 'wrong');
  assert.equal(first.messages.at(-1).transition, 'nudge');
  assert.equal(step(first, 's1').fails, 1);
  const second = answer(first, 'y', ans());
  assert.equal(second.messages.at(-1).result, 'wrong');
  assert.equal(second.messages.at(-1).transition, 'reveal');
  assert.equal(step(second, 's1').status, 'revealed');
  assert.equal(step(second, 's1').fails, 2);
  assert.equal(second.progress.current, 's1'); // stays until Continue
});

test('points from several answers are a union; the answer that completes it is correct', () => {
  let s = answer(opened(), 'b', ans(1));
  assert.deepEqual(step(s, 's1').pointsMet, [1]);
  s = answer(s, 'a', ans(0));
  assert.deepEqual(step(s, 's1').pointsMet, [0, 1]);
  assert.equal(s.messages.at(-1).result, 'correct');
  assert.equal(s.messages.at(-1).transition, 'advance');
});

test('out-of-range, repeated and non-integer point indexes are ignored by the reducer too', () => {
  const s = answer(opened(), 'a', ans(0, 0, 7, -1, 1.5));
  assert.deepEqual(step(s, 's1').pointsMet, [0]);
});

test('mastered means all points met before a reveal; a revealed step stays revealed', () => {
  let s = reduce(answer(answer(opened(), 'x', ans()), 'y', ans()), { type: 'continued' });
  s = reduce(reduce(s, { type: 'teachStarted', stepId: 's2', transition: 'opening', chunkIds: ['c1'] }), { type: 'teachDone' });
  s = answer(s, 'c', ans(0));
  assert.equal(step(s, 's1').status, 'revealed');
  assert.equal(step(s, 's2').status, 'mastered');
});

test('continued after a reveal opens the next step', () => {
  const revealed = answer(answer(opened(), 'x', ans()), 'y', ans());
  const s = reduce(revealed, { type: 'continued' });
  assert.equal(s.progress.current, 's2');
  assert.equal(step(s, 's2').status, 'active');
  assert.equal(step(s, 's1').status, 'revealed');
});

test('continued does nothing unless the current step was revealed and has a next step', () => {
  const active = opened();
  assert.equal(reduce(active, { type: 'continued' }), active);
  const revealed = answer(answer(opened(plan), 'x', ans()), 'y', ans());
  assert.equal(step(revealed, 's1').status, 'revealed');
  assert.equal(reduce(revealed, { type: 'continued' }), revealed);
});

test('a correct answer on the last step is a recap, and the lesson has nothing left to answer', () => {
  const s = answer(opened(plan), 'p', ans(0));
  assert.equal(s.messages.at(-1).transition, 'recap');
  assert.equal(step(s, 's1').status, 'mastered');
  assert.equal(s.progress.current, 's1');
  assert.equal(reduce(s, { type: 'answerSent', text: 'more' }), s);
});

test('the reply step is the progress step after evaluated: the next step on an advance, else the answered one', () => {
  assert.equal(answer(opened(), 'a and b', ans(0, 1)).progress.current, 's2');
  assert.equal(answer(opened(), 'a', ans(0)).progress.current, 's1');
  assert.equal(answer(opened(plan), 'p', ans(0)).progress.current, 's1'); // a recap stays on the last step
});

test('answerSent waits for the tutor reply to be done or stopped: not while it failed', () => {
  const failed = reduce(reduce(reduce(planned(three), { type: 'lessonStarted' }), begin), { type: 'teachFailed' });
  assert.equal(reduce(failed, { type: 'answerSent', text: 'x' }), failed);
  const stopped = reduce(reduce(reduce(planned(three), { type: 'lessonStarted' }), begin), { type: 'teachStopped' });
  assert.equal(reduce(stopped, { type: 'answerSent', text: 'x' }).messages.length, 2);
});

test('a message that is not an answer gets its intent and changes no progress or points', () => {
  const before = opened();
  const s = answer(before, 'what is the answer?', { intent: 'asks_for_answer', keyPointsMet: [0, 1] });
  assert.equal(s.messages.at(-1).intent, 'asks_for_answer');
  assert.equal(s.messages.at(-1).transition, undefined);
  assert.deepEqual(s.progress, before.progress);
});

test('evaluated with no answer waiting for it changes nothing', () => {
  const s = opened();
  assert.equal(reduce(s, { type: 'evaluated', evaluation: ans(0) }), s);
});

test('Stop after an evaluation keeps the applied transition', () => {
  let s = answer(opened(), 'a and b', ans(0, 1));
  s = reduce(s, { type: 'teachStarted', stepId: 's2', transition: 'advance', chunkIds: ['c1'] });
  s = reduce(reduce(s, { type: 'teachChunk', text: 'Right' }), { type: 'teachStopped' });
  assert.equal(s.messages.at(-1).status, 'stopped');
  assert.equal(s.progress.current, 's2');
  assert.equal(step(s, 's1').status, 'mastered');
  const again = reduce(s, { type: 'regenerate' }); // Regenerate repeats the move, not the evaluation
  assert.equal(again.messages.at(-1).transition, 'advance');
  assert.equal(again.progress, s.progress);
});

test('the chunk ids the evaluator named are kept on the student message for the tutor reply', () => {
  const s = answer(opened(), 'a', { intent: 'answer', keyPointsMet: [0], relevantChunkIds: ['c1'] });
  assert.deepEqual(s.messages.at(-1).relevantChunkIds, ['c1']);
});
