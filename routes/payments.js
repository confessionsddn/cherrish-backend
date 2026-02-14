//backend/routes/payments.js - UPDATED WITH CORRECT AMOUNTS
import express from 'express';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { query, getClient } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// ✅ UPDATED CREDIT PACKAGES - Match frontend exactly
const CREDIT_PACKAGES = {
  starter: { credits: 70, price: 2900, name: 'Starter', bonus: 0 },      // ₹29
  popular: { credits: 200, price: 6900, name: 'Popular', bonus: 25 },   // ₹69
  best: { credits: 400, price: 13900, name: 'Best Value', bonus: 50 },  // ₹139
  elite: { credits: 800, price: 24900, name: 'Elite', bonus: 100 }      // ₹249
};

// Ensure idempotency storage exists
await query(`
  CREATE TABLE IF NOT EXISTS payment_receipts (
    id SERIAL PRIMARY KEY,
    payment_id TEXT UNIQUE NOT NULL,
    order_id TEXT NOT NULL,
    user_id UUID NOT NULL,
    payment_type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  )
`);

// ✅ Create order for credit purchase
router.post('/create-order', authenticateToken, async (req, res) => {
  try {
    const { package_type } = req.body;

    if (!CREDIT_PACKAGES[package_type]) {
      return res.status(400).json({ error: 'Invalid package type' });
    }

    const pkg = CREDIT_PACKAGES[package_type];
    const totalCredits = pkg.credits + pkg.bonus;

    // Shortened receipt to stay under 40 chars
    const receipt = `cr_${req.user.id}_${Date.now()}`.substring(0, 40);

    const options = {
      amount: pkg.price, // Already in paise
      currency: 'INR',
      receipt: receipt,
      notes: {
        user_id: req.user.id,
        package_type: package_type,
        credits: totalCredits.toString(),
        base_credits: pkg.credits.toString(),
        bonus_credits: pkg.bonus.toString()
      }
    };

    const order = await razorpay.orders.create(options);

    console.log('💰 Order created:', order.id, 'Amount:', pkg.price / 100);

    res.json({
      success: true,
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key: process.env.RAZORPAY_KEY_ID,
      package: pkg,
      total_credits: totalCredits
    });

  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ error: 'Failed to create order', details: error.message });
  }
});

// ✅ Verify payment
router.post('/verify-payment', authenticateToken, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment verification fields' });
    }

    // Verify signature
    const sign = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSign = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(sign.toString())
      .digest('hex');

    if (razorpay_signature !== expectedSign) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    // Fetch order and payment details from Razorpay
    const [order, payment] = await Promise.all([
      razorpay.orders.fetch(razorpay_order_id),
      razorpay.payments.fetch(razorpay_payment_id)
    ]);

    if (payment.status !== 'captured') {
      return res.status(400).json({ error: 'Payment not captured' });
    }

    if (payment.order_id !== razorpay_order_id) {
      return res.status(400).json({ error: 'Payment/order mismatch' });
    }

    if (!order.notes?.user_id || order.notes.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Order does not belong to authenticated user' });
    }

    const credits = parseInt(order.notes.credits);
    if (!Number.isInteger(credits) || credits <= 0) {
      return res.status(400).json({ error: 'Invalid credits in order metadata' });
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Idempotency check
      const insertReceipt = await client.query(
        `INSERT INTO payment_receipts (payment_id, order_id, user_id, payment_type, amount)
         VALUES ($1, $2, $3, 'credits', $4)
         ON CONFLICT (payment_id) DO NOTHING
         RETURNING id`,
        [razorpay_payment_id, razorpay_order_id, req.user.id, payment.amount]
      );

      if (insertReceipt.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Payment already processed' });
      }

      // Add credits to user
      await client.query(
        'UPDATE users SET credits = credits + $1 WHERE id = $2',
        [credits, req.user.id]
      );

      // Log transaction
      await client.query(
        `INSERT INTO credit_transactions (user_id, amount, type, description)
         VALUES ($1, $2, 'purchased', $3)`,
        [req.user.id, credits, `Purchased ${order.notes.package_type} - ₹${order.amount / 100}`]
      );

      await client.query('COMMIT');
    } catch (dbError) {
      await client.query('ROLLBACK');
      throw dbError;
    } finally {
      client.release();
    }

    // Get updated credits
    const userResult = await query(
      'SELECT credits FROM users WHERE id = $1',
      [req.user.id]
    );

    console.log('✅ Credits added:', credits, 'New total:', userResult.rows[0].credits);

    res.json({
      success: true,
      credits_added: credits,
      total_credits: userResult.rows[0].credits,
      message: `${credits} credits added successfully!`
    });

  } catch (error) {
    console.error('Verify payment error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ✅ Create premium subscription
router.post('/create-subscription', authenticateToken, async (req, res) => {
  try {
    const receipt = `pm_${req.user.id}_${Date.now()}`.substring(0, 40);

    const options = {
      amount: 9900, // ₹99 in paise
      currency: 'INR',
      receipt: receipt,
      notes: {
        user_id: req.user.id,
        type: 'premium_subscription'
      }
    };

    const order = await razorpay.orders.create(options);

    console.log('👑 Premium order created:', order.id);

    res.json({
      success: true,
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key: process.env.RAZORPAY_KEY_ID
    });

  } catch (error) {
    console.error('Create subscription error:', error);
    res.status(500).json({ error: 'Failed to create subscription', details: error.message });
  }
});

// ✅ Verify premium subscription
router.post('/verify-subscription', authenticateToken, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment verification fields' });
    }

    // Verify signature
    const sign = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSign = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(sign.toString())
      .digest('hex');

    if (razorpay_signature !== expectedSign) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    // Fetch order and payment details
    const [order, payment] = await Promise.all([
      razorpay.orders.fetch(razorpay_order_id),
      razorpay.payments.fetch(razorpay_payment_id)
    ]);

    if (payment.status !== 'captured') {
      return res.status(400).json({ error: 'Payment not captured' });
    }

    if (payment.order_id !== razorpay_order_id) {
      return res.status(400).json({ error: 'Payment/order mismatch' });
    }

    if (!order.notes?.user_id || order.notes.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Order does not belong to authenticated user' });
    }

    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 1);

    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Idempotency check
      const insertReceipt = await client.query(
        `INSERT INTO payment_receipts (payment_id, order_id, user_id, payment_type, amount)
         VALUES ($1, $2, $3, 'premium', $4)
         ON CONFLICT (payment_id) DO NOTHING
         RETURNING id`,
        [razorpay_payment_id, razorpay_order_id, req.user.id, payment.amount]
      );

      if (insertReceipt.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Payment already processed' });
      }

      // Create or update premium subscription
      await client.query(
        `INSERT INTO premium_subscriptions (
          user_id, start_date, end_date, is_active, 
          spotlight_uses_remaining, spotlight_12h_remaining, boost_12h_remaining
        )
        VALUES ($1, NOW(), $2, true, 10, 10, 10)
        ON CONFLICT (user_id) 
        DO UPDATE SET 
          end_date = $2, 
          is_active = true, 
          spotlight_uses_remaining = 10, 
          spotlight_12h_remaining = 10, 
          boost_12h_remaining = 10, 
          daily_edit_used = false, 
          daily_voice_used = false`,
        [req.user.id, endDate]
      );

      // Update user as premium and add 150 bonus credits
      await client.query(
        'UPDATE users SET is_premium = true, credits = credits + 150 WHERE id = $1',
        [req.user.id]
      );

      // Log bonus credits transaction
      await client.query(
        `INSERT INTO credit_transactions (user_id, amount, type, description)
         VALUES ($1, 150, 'earned', 'Premium subscription bonus')`,
        [req.user.id]
      );

      await client.query('COMMIT');
    } catch (dbError) {
      await client.query('ROLLBACK');
      throw dbError;
    } finally {
      client.release();
    }

    console.log('👑 Premium activated for user:', req.user.email);

    res.json({
      success: true,
      message: 'Premium activated! Welcome to the elite club!',
      premium_until: endDate
    });

  } catch (error) {
    console.error('Verify subscription error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

export default router;
