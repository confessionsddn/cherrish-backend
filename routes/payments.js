//backend/routes/payments.js - FIXED FOR BANNED USERS
import express from 'express';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { query, getClient } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import jwt from 'jsonwebtoken';
import { logManualActivity } from '../middleware/activity-logger.js';
const router = express.Router();

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Credit packages
const CREDIT_PACKAGES = {
  starter: { credits: 70, price: 2900, name: 'Starter', bonus: 0 },
  popular: { credits: 200, price: 6900, name: 'Popular', bonus: 25 },
  best: { credits: 400, price: 13900, name: 'Best Value', bonus: 50 },
  elite: { credits: 800, price: 24900, name: 'Elite', bonus: 100 }
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

// ✅ SPECIAL AUTH FOR BANNED USERS
const authenticateEvenIfBanned = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user (even if banned!)
    const userResult = await query(
      'SELECT id, email, username, is_banned FROM users WHERE id = $1',
      [decoded.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    req.user = userResult.rows[0];
    next();

  } catch (error) {
    console.error('Auth error:', error);
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// ==========================================
// CREDIT PURCHASE ROUTES
// ==========================================

// Create order for credit purchase
router.post('/create-order', authenticateToken, async (req, res) => {
  try {
    const { package_type } = req.body;

    if (!CREDIT_PACKAGES[package_type]) {
      return res.status(400).json({ error: 'Invalid package type' });
    }

    const pkg = CREDIT_PACKAGES[package_type];
    const totalCredits = pkg.credits + pkg.bonus;
    const receipt = `cr_${req.user.id}_${Date.now()}`.substring(0, 40);

    const options = {
      amount: pkg.price,
      currency: 'INR',
      receipt: receipt,
      notes: {
        user_id: String(req.user.id),
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
    console.error('❌ Create order error:', error);
    res.status(500).json({ error: 'Failed to create order', details: error.message });
  }
});

// Verify credit payment
router.post('/verify-payment', authenticateToken, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    console.log('🔍 Verifying payment:', {
      order_id: razorpay_order_id,
      payment_id: razorpay_payment_id,
      user_id: req.user.id
    });

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
      console.error('❌ Invalid signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    console.log('✅ Signature verified');

    // Fetch order and payment details
    const [order, payment] = await Promise.all([
      razorpay.orders.fetch(razorpay_order_id),
      razorpay.payments.fetch(razorpay_payment_id)
    ]);

    console.log('📦 Order details:', {
      status: payment.status,
      amount: payment.amount
    });

    if (payment.status !== 'captured') {
      console.error('❌ Payment not captured');
      return res.status(400).json({ error: 'Payment not captured' });
    }

    if (payment.order_id !== razorpay_order_id) {
      console.error('❌ Payment/order mismatch');
      return res.status(400).json({ error: 'Payment/order mismatch' });
    }

    // Verify user ID
    const orderUserId = String(order.notes?.user_id || '');
    const currentUserId = String(req.user.id);

    console.log('👤 User ID comparison:', {
      order_user_id: orderUserId,
      current_user_id: currentUserId,
      match: orderUserId === currentUserId
    });

    if (!orderUserId || orderUserId !== currentUserId) {
      console.error('❌ User ID mismatch');
      return res.status(403).json({ error: 'Order does not belong to authenticated user' });
    }

    const credits = parseInt(order.notes.credits);
    if (!Number.isInteger(credits) || credits <= 0) {
      console.error('❌ Invalid credits');
      return res.status(400).json({ error: 'Invalid credits in order metadata' });
    }

    console.log('💰 Processing credits:', credits);

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
        console.log('⚠️ Payment already processed');
        
        const userResult = await query(
          'SELECT credits FROM users WHERE id = $1',
          [req.user.id]
        );
        
        return res.json({
          success: true,
          credits_added: 0,
          total_credits: userResult.rows[0].credits,
          message: 'Payment already processed',
          already_processed: true
        });
      }

      // Add credits
      const updateResult = await client.query(
        'UPDATE users SET credits = credits + $1 WHERE id = $2 RETURNING credits',
        [credits, req.user.id]
      );

      // Log transaction
      await client.query(
        `INSERT INTO credit_transactions (user_id, amount, type, description)
         VALUES ($1, $2, 'purchased', $3)`,
        [req.user.id, credits, `Purchased ${order.notes.package_type} - ₹${order.amount / 100}`]
      );
logManualActivity(req.user.id, 'buy_credits', { credits_added: credits, package: order.notes.package_type }, null, credits);      
      await client.query('COMMIT');
      
      const newCredits = updateResult.rows[0].credits;
      
      console.log('✅ Credits added:', {
        added: credits,
        new_total: newCredits,
        user_id: req.user.id
      });

      res.json({
        success: true,
        credits_added: credits,
        total_credits: newCredits,
        message: `${credits} credits added successfully!`
      });

    } catch (dbError) {
      await client.query('ROLLBACK');
      console.error('❌ Database error:', dbError);
      throw dbError;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('❌ Verify payment error:', error);
    res.status(500).json({ 
      error: 'Verification failed',
      details: error.message 
    });
  }
});

// ==========================================
// PREMIUM SUBSCRIPTION ROUTES
// ==========================================

// Create premium subscription
router.post('/create-subscription', authenticateToken, async (req, res) => {
  try {
    const receipt = `pm_${req.user.id}_${Date.now()}`.substring(0, 40);

    const options = {
      amount: 9900, // ₹99
      currency: 'INR',
      receipt: receipt,
      notes: {
        user_id: String(req.user.id),
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
    console.error('❌ Create subscription error:', error);
    res.status(500).json({ error: 'Failed to create subscription', details: error.message });
  }
});

// Verify premium subscription
router.post('/verify-subscription', authenticateToken, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    console.log('👑 Verifying premium:', {
      order_id: razorpay_order_id,
      payment_id: razorpay_payment_id,
      user_id: req.user.id
    });

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
      console.error('❌ Invalid signature');
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

    // Verify user ID
    const orderUserId = String(order.notes?.user_id || '');
    const currentUserId = String(req.user.id);

    if (!orderUserId || orderUserId !== currentUserId) {
      console.error('❌ User ID mismatch');
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
        console.log('⚠️ Premium already processed');
        return res.json({
          success: true,
          message: 'Premium already activated',
          already_processed: true
        });
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
logManualActivity(req.user.id, 'buy_premium', { premium_until: endDate }, null, 150);
      await client.query(
        `INSERT INTO credit_transactions (user_id, amount, type, description)
         VALUES ($1, 150, 'earned', 'Premium subscription bonus')`,
        [req.user.id]
      );

      await client.query('COMMIT');
      console.log('✅ Premium activated:', req.user.id);

    } catch (dbError) {
      await client.query('ROLLBACK');
      console.error('❌ Database error:', dbError);
      throw dbError;
    } finally {
      client.release();
    }

    res.json({
      success: true,
      message: 'Premium activated! Welcome to the elite club!',
      premium_until: endDate
    });

  } catch (error) {
    console.error('❌ Verify subscription error:', error);
    res.status(500).json({ 
      error: 'Verification failed',
      details: error.message 
    });
  }
});

// ==========================================
// UNBAN PAYMENT ROUTES (SPECIAL AUTH!)
// ==========================================

// Create unban order - WORKS EVEN IF BANNED
router.post('/create-unban-order', authenticateEvenIfBanned, async (req, res) => {
  try {
    const { ban_duration } = req.body;
    
    console.log('🚫 Unban order request:', {
      user_id: req.user.id,
      is_banned: req.user.is_banned,
      ban_duration: ban_duration
    });
    
    const validDurations = ['3', '7', 'permanent'];
    if (!validDurations.includes(ban_duration)) {
      return res.status(400).json({ error: 'Invalid ban duration' });
    }

    const prices = {
      '3': 3000,      // ₹30
      '7': 7000,      // ₹70
      'permanent': 30000  // ₹300
    };

    const amount = prices[ban_duration];
    const receipt = `unban_${req.user.id}_${Date.now()}`.substring(0, 40);

    const options = {
      amount: amount,
      currency: 'INR',
      receipt: receipt,
      notes: {
        user_id: String(req.user.id),
        type: 'unban',
        ban_duration: ban_duration
      }
    };

    const order = await razorpay.orders.create(options);
    console.log('🚫 Unban order created:', order.id, 'Amount:', amount / 100);

    res.json({
      success: true,
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key: process.env.RAZORPAY_KEY_ID
    });

  } catch (error) {
    console.error('❌ Create unban order error:', error);
    res.status(500).json({ error: 'Failed to create unban order', details: error.message });
  }
});

// Verify unban payment - WORKS EVEN IF BANNED
router.post('/verify-unban-payment', authenticateEvenIfBanned, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    console.log('🚫 Verifying unban payment:', {
      order_id: razorpay_order_id,
      payment_id: razorpay_payment_id,
      user_id: req.user.id,
      is_banned: req.user.is_banned
    });

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
      console.error('❌ Invalid signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    console.log('✅ Signature verified');

    // Fetch order and payment details
    const [order, payment] = await Promise.all([
      razorpay.orders.fetch(razorpay_order_id),
      razorpay.payments.fetch(razorpay_payment_id)
    ]);

    if (payment.status !== 'captured') {
      console.error('❌ Payment not captured');
      return res.status(400).json({ error: 'Payment not captured' });
    }

    if (payment.order_id !== razorpay_order_id) {
      console.error('❌ Payment/order mismatch');
      return res.status(400).json({ error: 'Payment/order mismatch' });
    }

    // Verify user ID
    const orderUserId = String(order.notes?.user_id || '');
    const currentUserId = String(req.user.id);

    if (!orderUserId || orderUserId !== currentUserId) {
      console.error('❌ User ID mismatch');
      return res.status(403).json({ error: 'Order does not belong to authenticated user' });
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Idempotency check
      const insertReceipt = await client.query(
        `INSERT INTO payment_receipts (payment_id, order_id, user_id, payment_type, amount)
         VALUES ($1, $2, $3, 'unban', $4)
         ON CONFLICT (payment_id) DO NOTHING
         RETURNING id`,
        [razorpay_payment_id, razorpay_order_id, req.user.id, payment.amount]
      );

      if (insertReceipt.rows.length === 0) {
        await client.query('ROLLBACK');
        console.log('⚠️ Unban payment already processed');
        return res.json({
          success: true,
          message: 'Payment already processed',
          already_processed: true
        });
      }

      // Unban user
      await client.query(
        'UPDATE users SET is_banned = false, ban_until = NULL WHERE id = $1',
        [req.user.id]
      );

      await client.query('COMMIT');
      console.log('✅ User unbanned:', req.user.id);

      res.json({
        success: true,
        message: 'Account unbanned successfully!'
      });

    } catch (dbError) {
      await client.query('ROLLBACK');
      console.error('❌ Database error:', dbError);
      throw dbError;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('❌ Verify unban payment error:', error);
    res.status(500).json({ 
      error: 'Verification failed',
      details: error.message 
    });
  }
});

export default router;
