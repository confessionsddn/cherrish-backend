// test/paymentCrypto.test.js
// Unit tests for Razorpay signature verification — the logic that gates all
// credit/premium grants. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  safeEqualHex,
  verifyPaymentSignature,
  verifyWebhookSignature
} from '../utils/paymentCrypto.js';

const KEY_SECRET = 'test_secret_key';

function signPayment(orderId, paymentId, secret = KEY_SECRET) {
  return crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
}

function signWebhook(body, secret) {
  return crypto.createHmac('sha256', secret).update(Buffer.from(body)).digest('hex');
}

test('safeEqualHex: equal strings match', () => {
  assert.equal(safeEqualHex('abc123', 'abc123'), true);
});

test('safeEqualHex: different strings do not match', () => {
  assert.equal(safeEqualHex('abc123', 'abc124'), false);
});

test('safeEqualHex: different lengths do not match (no throw)', () => {
  assert.equal(safeEqualHex('abc', 'abcdef'), false);
});

test('safeEqualHex: non-string inputs are rejected', () => {
  assert.equal(safeEqualHex(null, 'x'), false);
  assert.equal(safeEqualHex('x', undefined), false);
  assert.equal(safeEqualHex(123, 123), false);
});

test('verifyPaymentSignature: valid signature passes', () => {
  const orderId = 'order_ABC';
  const paymentId = 'pay_XYZ';
  const signature = signPayment(orderId, paymentId);
  assert.equal(
    verifyPaymentSignature({ orderId, paymentId, signature, keySecret: KEY_SECRET }),
    true
  );
});

test('verifyPaymentSignature: tampered payment id fails', () => {
  const orderId = 'order_ABC';
  const signature = signPayment(orderId, 'pay_XYZ');
  assert.equal(
    verifyPaymentSignature({ orderId, paymentId: 'pay_HACKED', signature, keySecret: KEY_SECRET }),
    false
  );
});

test('verifyPaymentSignature: wrong secret fails', () => {
  const orderId = 'order_ABC';
  const paymentId = 'pay_XYZ';
  const signature = signPayment(orderId, paymentId, 'attacker_secret');
  assert.equal(
    verifyPaymentSignature({ orderId, paymentId, signature, keySecret: KEY_SECRET }),
    false
  );
});

test('verifyPaymentSignature: missing fields fail closed', () => {
  assert.equal(verifyPaymentSignature({ orderId: '', paymentId: 'p', signature: 's', keySecret: KEY_SECRET }), false);
  assert.equal(verifyPaymentSignature({ orderId: 'o', paymentId: 'p', signature: '', keySecret: KEY_SECRET }), false);
  assert.equal(verifyPaymentSignature({ orderId: 'o', paymentId: 'p', signature: 's', keySecret: '' }), false);
});

test('verifyWebhookSignature: valid raw-body signature passes', () => {
  const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1' } } } });
  const signature = signWebhook(body, 'wh_secret');
  assert.equal(verifyWebhookSignature({ rawBody: Buffer.from(body), signature, webhookSecret: 'wh_secret' }), true);
});

test('verifyWebhookSignature: re-serialized body would fail (raw-body matters)', () => {
  const original = '{"event":"payment.captured","amount":100}';
  const signature = signWebhook(original, 'wh_secret');
  // Simulate JSON.parse -> JSON.stringify reordering/whitespace change.
  const reserialized = JSON.stringify({ amount: 100, event: 'payment.captured' });
  assert.equal(
    verifyWebhookSignature({ rawBody: Buffer.from(reserialized), signature, webhookSecret: 'wh_secret' }),
    false
  );
});

test('verifyWebhookSignature: missing secret fails closed', () => {
  const body = '{}';
  const signature = signWebhook(body, 'wh_secret');
  assert.equal(verifyWebhookSignature({ rawBody: Buffer.from(body), signature, webhookSecret: '' }), false);
});
