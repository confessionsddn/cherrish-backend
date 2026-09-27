// test/notificationPrefs.test.js
// Unit tests for the type -> preference-key mapping that decides whether a
// push is suppressed by user preferences. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapTypeToPreferenceKey } from '../utils/notificationPrefs.js';

test('maps gift -> gifts', () => {
  assert.equal(mapTypeToPreferenceKey('gift'), 'gifts');
});

test('maps theme_unlock -> themes', () => {
  assert.equal(mapTypeToPreferenceKey('theme_unlock'), 'themes');
});

test('maps reply -> replies and reply_like -> reply_likes', () => {
  assert.equal(mapTypeToPreferenceKey('reply'), 'replies');
  assert.equal(mapTypeToPreferenceKey('reply_like'), 'reply_likes');
});

test('maps premium -> account_status', () => {
  assert.equal(mapTypeToPreferenceKey('premium'), 'account_status');
});

test('identity mappings stay stable', () => {
  assert.equal(mapTypeToPreferenceKey('reactions'), 'reactions');
  assert.equal(mapTypeToPreferenceKey('poll'), 'polls');
  assert.equal(mapTypeToPreferenceKey('announcement'), 'announcements');
  assert.equal(mapTypeToPreferenceKey('account_status'), 'account_status');
});

test('unknown type falls back to itself', () => {
  assert.equal(mapTypeToPreferenceKey('some_new_type'), 'some_new_type');
});
