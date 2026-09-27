// utils/paymentCrypto.js
// Pure, dependency-light helpers for Razorpay signature verification.
// Extracted so the money-guarding logic can be unit-tested without spinning
// up Express, a DB, or the Razorpay SDK.
import crypto from 'crypto';

/** Timing-safe comparison of two hex/utf8 strings. */
export function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Verify a Razorpay PAYMENT signature.
 * Razorpay signs `${orderId}|${paymentId}` with the key secret (HMAC-SHA256).
 */
export function verifyPaymentSignature({ orderId, paymentId, signature, keySecret }) {
  if (!orderId || !paymentId || !signature || !keySecret) return false;
  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return safeEqualHex(signature, expected);
}

/**
 * Verify a Razorpay WEBHOOK signature over the RAW request body bytes.
 * `rawBody` must be a Buffer or string of the exact bytes Razorpay sent.
 */
export function verifyWebhookSignature({ rawBody, signature, webhookSecret }) {
  if (!rawBody || !signature || !webhookSecret) return false;
  const buf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody));
  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(buf)
    .digest('hex');
  return safeEqualHex(signature, expected);
}
