import test from 'node:test';
import assert from 'node:assert/strict';
import { nearBottom } from './scroll.js';

// A 2000px page in a 600px window, scrolled to leave `gap` pixels below the view.
const page = (gap) => ({ scrollHeight: 2000, clientHeight: 600, scrollTop: 1400 - gap });

test('the view is near the bottom within 80px of it', () => {
  assert.equal(nearBottom(page(0)), true);
  assert.equal(nearBottom(page(79)), true);
  assert.equal(nearBottom(page(81)), false);
  assert.equal(nearBottom(page(500)), false);
});
