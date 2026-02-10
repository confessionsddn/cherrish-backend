import express from 'express';
import { query } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Pricing tables
const SPOTLIGHT_PRICING = {
  30: 5,   // 30 min = 5 credits
  60: 10,  // 1 hour = 10 credits
  120: 15, // 2 hours = 15 credits
  360: 20, // 6 hours = 20 credits
  720: 25, // 12 hours = 25 credits
  1440: 30 // 24 hours = 30 credits
};

const BOOST_PRICING = {
  30: 5,
  60: 10,
  120: 15,
  360: 20,
  720: 25,
  1440: 30
};

const BOOST_MULTIPLIERS = {
  30: 1.3,
  60: 1.5,
  120: 1.7,
  360: 2.0,
  720: 2.3,
  1440: 2.7
};

// Apply Spotlight
router.post('/spotlight/:confessionId', authenticateToken, async (req, res) => {
  try {
    const { confessionId } = req.params;
    const { duration } = req.body;
    const userId = req.user.id;

    if (!SPOTLIGHT_PRICING[duration]) {
      return res.status(400).json({ error: 'Invalid duration' });
    }

    const creditCost = SPOTLIGHT_PRICING[duration];

    // Check confession ownership
    const confessionCheck = await query(
      'SELECT user_id, is_spotlight, spotlight_expires_at FROM confessions WHERE id = $1',
      [confessionId]
    );

    if (confessionCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Confession not found' });
    }

    if (confessionCheck.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'Not your confession' });
    }

    // ✅ CHECK PREMIUM STATUS FIRST
    const premiumCheck = await query(
      `SELECT spotlight_12h_remaining FROM premium_subscriptions 
       WHERE user_id = $1 AND is_active = true AND end_date > NOW()
       ORDER BY end_date DESC LIMIT 1`,
      [userId]
    );

    let usePremium = false;
    let creditsSpent = 0;

    // ✅ If user is premium AND has remaining slots AND choosing 12h duration
if (premiumCheck.rows.length > 0 && (duration === 720 || duration === 1440)) {
      const remaining = premiumCheck.rows[0].spotlight_12h_remaining;
      
      if (remaining > 0) {
        usePremium = true;
        console.log(`👑 Premium user using free spotlight (${remaining} remaining)`);
      }
    }

    // ✅ If NOT using premium, charge credits
    if (!usePremium) {
      const userResult = await query(
        'SELECT credits FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows[0].credits < creditCost) {
        return res.status(400).json({ 
          error: `Not enough credits! Need ${creditCost} credits for ${duration} minutes spotlight.`,
          required: creditCost,
          current: userResult.rows[0].credits
        });
      }

      // Deduct credits
      await query(
        'UPDATE users SET credits = credits - $1 WHERE id = $2',
        [creditCost, userId]
      );

      await query(
        `INSERT INTO credit_transactions (user_id, amount, type, description)
         VALUES ($1, $2, 'spent', $3)`,
        [userId, -creditCost, `Spotlight ${duration}min on confession`]
      );

      creditsSpent = creditCost;
      console.log(`💰 User paid ${creditCost} credits for spotlight`);
    } else {
      // Use premium slot
      await query(
        `UPDATE premium_subscriptions 
         SET spotlight_12h_remaining = spotlight_12h_remaining - 1
         WHERE user_id = $1 AND is_active = true`,
        [userId]
      );
      console.log(`✨ Premium slot used (FREE)`);
    }

    // Calculate expiration
    const currentExpiration = confessionCheck.rows[0].spotlight_expires_at;
    const now = new Date();
    let newExpiration;

    if (currentExpiration && new Date(currentExpiration) > now) {
      newExpiration = new Date(new Date(currentExpiration).getTime() + duration * 60000);
    } else {
      newExpiration = new Date(now.getTime() + duration * 60000);
    }

    // Apply spotlight
    await query(
      `UPDATE confessions 
       SET is_spotlight = true, spotlight_expires_at = $1
       WHERE id = $2`,
      [newExpiration, confessionId]
    );

    // Log purchase
    await query(
      `INSERT INTO visibility_purchases (confession_id, user_id, type, duration_minutes, credits_spent, was_premium)
       VALUES ($1, $2, 'spotlight', $3, $4, $5)`,
      [confessionId, userId, duration, creditsSpent, usePremium]
    );

    console.log(`✨ Spotlight applied: ${confessionId} for ${duration}min`);

    // Get updated credits
    const updatedUser = await query(
      'SELECT credits FROM users WHERE id = $1',
      [userId]
    );

    res.json({
      success: true,
      message: usePremium 
        ? `✨ Spotlight activated for ${duration} minutes! (FREE - Premium Pass)` 
        : `Spotlight activated for ${duration} minutes!`,
      expires_at: newExpiration,
      credits_spent: creditsSpent,
      credits_remaining: updatedUser.rows[0].credits,
      used_premium: usePremium
    });

  } catch (error) {
    console.error('Spotlight error:', error);
    res.status(500).json({ error: 'Failed to apply spotlight' });
  }
});

// Apply Boost
router.post('/boost/:confessionId', authenticateToken, async (req, res) => {
  try {
    const { confessionId } = req.params;
    const { duration } = req.body;
    const userId = req.user.id;

    if (!BOOST_PRICING[duration]) {
      return res.status(400).json({ error: 'Invalid duration' });
    }

    const creditCost = BOOST_PRICING[duration];
    const multiplier = BOOST_MULTIPLIERS[duration];

    // Check confession ownership
    const confessionCheck = await query(
      'SELECT user_id, boost_expires_at FROM confessions WHERE id = $1',
      [confessionId]
    );

    if (confessionCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Confession not found' });
    }

    if (confessionCheck.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'Not your confession' });
    }

    // ✅ CHECK PREMIUM STATUS FIRST
    const premiumCheck = await query(
      `SELECT boost_12h_remaining FROM premium_subscriptions 
       WHERE user_id = $1 AND is_active = true AND end_date > NOW()
       ORDER BY end_date DESC LIMIT 1`,
      [userId]
    );

    let usePremium = false;
    let creditsSpent = 0;

    // ✅ If premium AND has remaining boosts AND 12h duration
if (premiumCheck.rows.length > 0 && (duration === 720 || duration === 1440)) {
        const remaining = premiumCheck.rows[0].boost_12h_remaining;
      
      if (remaining > 0) {
        usePremium = true;
        console.log(`👑 Premium user using free boost (${remaining} remaining)`);
      }
    }

    // ✅ If NOT using premium, charge credits
    if (!usePremium) {
      const userResult = await query(
        'SELECT credits FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows[0].credits < creditCost) {
        return res.status(400).json({ 
          error: `Not enough credits! Need ${creditCost} credits for ${duration} minutes boost.`,
          required: creditCost,
          current: userResult.rows[0].credits
        });
      }

      await query(
        'UPDATE users SET credits = credits - $1 WHERE id = $2',
        [creditCost, userId]
      );

      await query(
        `INSERT INTO credit_transactions (user_id, amount, type, description)
         VALUES ($1, $2, 'spent', $3)`,
        [userId, -creditCost, `Boost ${duration}min on confession`]
      );

      creditsSpent = creditCost;
      console.log(`💰 User paid ${creditCost} credits for boost`);
    } else {
      await query(
        `UPDATE premium_subscriptions 
         SET boost_12h_remaining = boost_12h_remaining - 1
         WHERE user_id = $1 AND is_active = true`,
        [userId]
      );
      console.log(`🚀 Premium slot used (FREE)`);
    }

    // Calculate expiration
    const currentExpiration = confessionCheck.rows[0].boost_expires_at;
    const now = new Date();
    let newExpiration;

    if (currentExpiration && new Date(currentExpiration) > now) {
      newExpiration = new Date(new Date(currentExpiration).getTime() + duration * 60000);
    } else {
      newExpiration = new Date(now.getTime() + duration * 60000);
    }

    // Apply boost
    await query(
      `UPDATE confessions 
       SET boost_multiplier = $1, boost_expires_at = $2
       WHERE id = $3`,
      [multiplier, newExpiration, confessionId]
    );

    // Log purchase
    await query(
      `INSERT INTO visibility_purchases (confession_id, user_id, type, duration_minutes, credits_spent, was_premium)
       VALUES ($1, $2, 'boost', $3, $4, $5)`,
      [confessionId, userId, duration, creditsSpent, usePremium]
    );

    console.log(`🚀 Boost applied: ${confessionId} for ${duration}min (${multiplier}x)`);

    // Get updated credits
    const updatedUser = await query(
      'SELECT credits FROM users WHERE id = $1',
      [userId]
    );

    res.json({
      success: true,
      message: usePremium 
        ? `🚀 Boost activated for ${duration} minutes! (FREE - Premium Pass)` 
        : `Boost activated for ${duration} minutes!`,
      multiplier: multiplier,
      expires_at: newExpiration,
      credits_spent: creditsSpent,
      credits_remaining: updatedUser.rows[0].credits,
      used_premium: usePremium
    });

  } catch (error) {
    console.error('Boost error:', error);
    res.status(500).json({ error: 'Failed to apply boost' });
  }
});

export default router;