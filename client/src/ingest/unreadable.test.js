import test from 'node:test';
import assert from 'node:assert/strict';
import { unreadable } from './unreadable.js';

test('a page is unreadable with under 20 letters or over 20% broken characters', () => {
  assert.equal(unreadable('Fig. 2'), true);
  assert.equal(unreadable('The nucleus holds the genetic material.'), false);
  const broken = String.fromCharCode(0xfffd, 0xe000, 0x7).repeat(4); // replacement, private-use, control
  assert.equal(unreadable(`The nucleus holds the genetic material ${broken}`), true);
  assert.equal(unreadable('תא הוא יחידת החיים הבסיסית'), false);
});
