import test from 'node:test';
import assert from 'node:assert/strict';
import { detectScript, textDir } from './script.js';

test('Hebrew that starts with a Latin word is still right-to-left', () => {
  assert.deepEqual(detectScript('Chapter 1: פוטוסינתזה היא התהליך שבו צמחים הופכים אור לסוכר'), {
    script: 'hebrew',
    rtl: true,
  });
});

test('Arabic is right-to-left', () => {
  assert.deepEqual(detectScript('2024 التمثيل الضوئي'), { script: 'arabic', rtl: true });
});

test('English with a Hebrew term is left-to-right', () => {
  assert.deepEqual(detectScript('Photosynthesis (פוטוסינתזה) turns light into sugar.'), {
    script: 'latin',
    rtl: false,
  });
});

test('no letters at all is other, left-to-right', () => {
  assert.deepEqual(detectScript('3.14 + 2 = 5.14'), { script: 'other', rtl: false });
});

test('textDir names the direction of the main script', () => {
  assert.equal(textDir('Photosynthesis פוטוסינתזה הופכת אור'), 'rtl');
  assert.equal(textDir('Light becomes sugar'), 'ltr');
  assert.equal(textDir('123'), 'ltr');
});
