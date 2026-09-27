// backend/routes/webhooks.js
import express from 'express';
import { query, getClient } from '../config/database.js';
import { verifyWebhookSignature } from '../utils/paymentCrypto.js';

const router = express.Router();

// NOTE: This route is mounted in server.js with express.raw() so req.body is a
// Buffer of the exact bytes Razorpay signed. Webhook HMAC MUST be verified over
// the raw payload — verifying over JSON.stringify(parsedBody) is unreliable and
// insecure.
router.post('/razorpay-webhook', async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('❌ RAZORPAY_WEBHOOK_SECRET not set — rejecting webhook');
      return res.status(500).json({ error: 'Webhook not configured' });
    }

    const signature = req.headers['x-razorpay-signature'];
    // req.body is a Buffer (express.raw). Use it directly for the HMAC.
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');

    if (!verifyWebhookSignature({ rawBody, signature, webhookSecret })) {
      console.error('❌ Invalid webhook signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    // Signature verified — now safe to parse.
    let parsed;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    const event = parsed.event;
    const payment = parsed.payload?.payment?.entity;
    if (!payment) {
      return res.json({ status: 'ignored' });
    }

    if (event !== 'payment.captured') {
      return res.json({ status: 'ignored' });
    }

    const paymentId = payment.id;
    const notes = payment.notes || {};
    // Prefer binding to the order's user_id (set when we create the order).
    // Fall back to email only if user_id is absent.
    const userId = notes.user_id || null;
    const referenceId = notes.reference_id || '';

    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Idempotency: record the payment id; if already present, skip.
      const receipt = await client.query(
        `INSERT INTO payment_receipts (payment_id, order_id, user_id, payment_type, amount)
         VALUES ($1, $2, $3, 'webhook', $4)
         ON CONFLICT (payment_id) DO NOTHING
         RETURNING id`,
        [paymentId, payment.order_id || 'webhook', userId, payment.amount || 0]
      );

      if (receipt.rows.length === 0) {
        await client.query('ROLLBACK');
        console.log('⚠️ Webhook already processed:', paymentId);
        return res.json({ status: 'already_processed' });
      }

      // Resolve the target user: by id if we have it, else by email.
      let user;
      if (userId) {
        const r = await client.query('SELECT id FROM users WHERE id = $1', [userId]);
        user = r.rows[0];
      } else if (payment.email) {
        const r = await client.query('SELECT id FROM users WHERE email = $1', [payment.email]);
        user = r.rows[0];
      }

      if (!user) {
        await client.query('ROLLBACK');
        console.error('❌ Webhook: user not found for payment', paymentId);
        return res.status(404).json({ error: 'User not found' });
      }

      if (referenceId.startsWith('CREDITS_')) {
        const creditMap = {
          CREDITS_STARTER: 70,
          CREDITS_POPULAR: 225,
          CREDITS_PREMIUM: 450,
          CREDITS_ELITE: 900
        };
        const creditsToAdd = creditMap[referenceId];
        if (creditsToAdd) {
          await client.query('UPDATE users SET credits = credits + $1 WHERE id = $2', [creditsToAdd, user.id]);
          await client.query(
            `INSERT INTO credit_transactions (user_id, amount, type, description)
             VALUES ($1, $2, 'purchased', $3)`,
            [user.id, creditsToAdd, `Purchased ${creditsToAdd} credits (webhook)`]
          );
          console.log(`✅ Webhook added ${creditsToAdd} credits to user ${user.id}`);
        }
      } else if (referenceId === 'PREMIUM_MONTHLY') {
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + 1);
        await client.query('UPDATE users SET is_premium = true WHERE id = $1', [user.id]);
        await client.query(
          `INSERT INTO premium_subscriptions (user_id, start_date, end_date, is_active)
           VALUES ($1, NOW(), $2, true)
           ON CONFLICT (user_id) DO UPDATE SET end_date = $2, is_active = true`,
          [user.id, endDate]
        );
        console.log(`✅ Webhook activated premium for user ${user.id}`);
      } else if (referenceId.startsWith('UNBAN_')) {
        await client.query('UPDATE users SET is_banned = false, ban_until = NULL WHERE id = $1', [user.id]);
        console.log(`✅ Webhook unbanned user ${user.id}`);
      }

      await client.query('COMMIT');
      res.json({ status: 'ok' });
    } catch (dbErr) {
      await client.query('ROLLBACK');
      throw dbErr;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
