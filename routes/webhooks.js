// backend/routes/webhooks.js
import express from 'express';
import crypto from 'crypto';
import { query } from '../config/database.js';

const router = express.Router();

router.post('/razorpay-webhook', async (req, res) => {
  try {
    // Verify webhook signature
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];
    
    const body = JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(body)
      .digest('hex');
    
    if (signature !== expectedSignature) {
      return res.status(400).json({ error: 'Invalid signature' });
    }
    
    const event = req.body.event;
    const payload = req.body.payload.payment.entity;
    
    if (event === 'payment.captured') {
      const referenceId = payload.notes.reference_id || '';
      const amount = payload.amount / 100; // Convert paise to rupees
      const customerEmail = payload.email;
      
      // Find user by email
      const userResult = await query(
        'SELECT id, credits FROM users WHERE email = $1',
        [customerEmail]
      );
      
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      const user = userResult.rows[0];
      
      // Process based on reference ID
      if (referenceId.startsWith('CREDITS_')) {
        // Add credits
        const creditMap = {
          'CREDITS_STARTER': 70,
          'CREDITS_POPULAR': 225,
          'CREDITS_PREMIUM': 450,
          'CREDITS_ELITE': 900
        };
        
        const creditsToAdd = creditMap[referenceId];
        
        await query(
          'UPDATE users SET credits = credits + $1 WHERE id = $2',
          [creditsToAdd, user.id]
        );
        
        await query(
          `INSERT INTO credit_transactions (user_id, amount, type, description)
           VALUES ($1, $2, 'purchased', $3)`,
          [user.id, creditsToAdd, `Purchased ${creditsToAdd} credits`]
        );
        
        console.log(`✅ Added ${creditsToAdd} credits to user ${user.id}`);
      }
      
      else if (referenceId === 'PREMIUM_MONTHLY') {
        // Activate premium
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + 1);
        
        await query(
          'UPDATE users SET is_premium = true WHERE id = $1',
          [user.id]
        );
        
        await query(
          `INSERT INTO premium_subscriptions 
           (user_id, start_date, end_date, is_active)
           VALUES ($1, NOW(), $2, true)
           ON CONFLICT (user_id) DO UPDATE
           SET end_date = $2, is_active = true`,
          [user.id, endDate]
        );
        
        console.log(`✅ Activated premium for user ${user.id}`);
      }
      
      else if (referenceId.startsWith('UNBAN_')) {
        // Unban user
        await query(
          'UPDATE users SET is_banned = false, ban_until = NULL WHERE id = $1',
          [user.id]
        );
        
        console.log(`✅ Unbanned user ${user.id}`);
      }
    }
    
    res.json({ status: 'ok' });
    
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
