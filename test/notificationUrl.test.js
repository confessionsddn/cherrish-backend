// test/notificationUrl.test.js
// Ensures notification deep-link URLs are absolute for OneSignal web_url.
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toAbsoluteUrl, SITE_ORIGIN } from '../utils/notificationUrl.js';

test('relative deep-link is prefixed with site origin', () => {
  assert.equal(toAbsoluteUrl('/?confession=abc'), `${SITE_ORIGIN}/?confession=abc`);
});

test('relative path without leading slash gets one', () => {
  assert.equal(toAbsoluteUrl('community'), `${SITE_ORIGIN}/community`);
});

test('absolute http(s) URLs pass through unchanged', () => {
  assert.equal(toAbsoluteUrl('https://www.cherrish.in/community'), 'https://www.cherrish.in/community');
  assert.equal(toAbsoluteUrl('http://example.com/x'), 'http://example.com/x');
});

test('empty/nullish falls back to site origin', () => {
  assert.equal(toAbsoluteUrl(''), SITE_ORIGIN);
  assert.equal(toAbsoluteUrl(null), SITE_ORIGIN);
  assert.equal(toAbsoluteUrl(undefined), SITE_ORIGIN);
});

test('bare slash maps to origin root', () => {
  assert.equal(toAbsoluteUrl('/'), `${SITE_ORIGIN}/`);
});
