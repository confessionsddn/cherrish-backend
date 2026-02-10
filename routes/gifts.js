// backend/routes/gifts.js
import express from 'express';
import { query } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { logActivity } from '../middleware/activity-logger.js';

const router = express.Router();

// Get all available gifts (catalog)
router.get('/catalog', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM gift_catalog ORDER BY price ASC`
    );
    
    res.json({
      success: true,
      gifts: result.rows
    });
  } catch (error) {
    console.error('Get catalog error:', error);
    res.status(500).json({ error: 'Failed to get gifts' });
  }
});

// Get user's unlocked gifts
router.get('/my-unlocked', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const result = await query(
      `SELECT 
        gr.gift_id,
        gc.title,
        gc.icon,
        gc.type,
        gr.total_credits_received,
        gr.gift_count,
        gr.is_unlocked,
        gr.unlocked_at,
        gc.unlock_threshold
       FROM gifts_received gr
       JOIN gift_catalog gc ON gr.gift_id = gc.id
       WHERE gr.user_id = $1
       ORDER BY gr.is_unlocked DESC, gr.total_credits_received DESC`,
      [userId]
    );
    
    res.json({
      success: true,
      gifts: result.rows
    });
  } catch (error) {
    console.error('Get unlocked gifts error:', error);
    res.status(500).json({ error: 'Failed to get unlocked gifts' });
  }
});

// Send a gift
router.post('/send', authenticateToken, logActivity('gift_sent'), async (req, res) => {
  try {
    const { gift_id, receiver_id, confession_id } = req.body;
    const senderId = req.user.id;
    
    // Validate inputs
    if (!gift_id || !receiver_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Can't send gift to yourself
    if (senderId === receiver_id) {
      return res.status(400).json({ error: 'Cannot send gift to yourself!' });
    }
    
    // Get gift info
    const giftResult = await query(
      'SELECT * FROM gift_catalog WHERE id = $1',
      [gift_id]
    );
    
    if (giftResult.rows.length === 0) {
      return res.status(404).json({ error: 'Gift not found' });
    }
    
    const gift = giftResult.rows[0];
    
    // Check sender has enough credits
    const senderResult = await query(
      'SELECT credits FROM users WHERE id = $1',
      [senderId]
    );
    
    if (senderResult.rows[0].credits < gift.price) {
      return res.status(400).json({ 
        error: 'Not enough credits!',
        required: gift.price,
        current: senderResult.rows[0].credits
      });
    }
    
    // Deduct credits from sender
    await query(
      'UPDATE users SET credits = credits - $1 WHERE id = $2',
      [gift.price, senderId]
    );
    
    // Log transaction
    await query(
      `INSERT INTO credit_transactions (user_id, amount, type, description)
       VALUES ($1, $2, 'spent', $3)`,
      [senderId, -gift.price, `Sent ${gift.title} gift`]
    );
    
    // Record gift sent
    await query(
      `INSERT INTO gifts_sent (gift_id, sender_id, receiver_id, confession_id, credits_spent)
       VALUES ($1, $2, $3, $4, $5)`,
      [gift_id, senderId, receiver_id, confession_id, gift.price]
    );
    
    // Update receiver's gift progress
    await query(
      `INSERT INTO gifts_received (user_id, gift_id, total_credits_received, gift_count)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (user_id, gift_id) 
       DO UPDATE SET 
         total_credits_received = gifts_received.total_credits_received + $3,
         gift_count = gifts_received.gift_count + 1`,
      [receiver_id, gift_id, gift.price]
    );
    
    // Check if unlocked
    const progressResult = await query(
      `SELECT total_credits_received, is_unlocked 
       FROM gifts_received 
       WHERE user_id = $1 AND gift_id = $2`,
      [receiver_id, gift_id]
    );
    
    const progress = progressResult.rows[0];
    let justUnlocked = false;
    
    if (!progress.is_unlocked && progress.total_credits_received >= gift.unlock_threshold) {
      // UNLOCK THE GIFT!
      await query(
        `UPDATE gifts_received 
         SET is_unlocked = true, unlocked_at = NOW()
         WHERE user_id = $1 AND gift_id = $2`,
        [receiver_id, gift_id]
      );
      justUnlocked = true;
    }
    
    console.log(`🎁 Gift sent: ${gift.title} from ${senderId} to ${receiver_id}`);
    
    res.json({
      success: true,
      message: `${gift.title} sent!`,
      credits_spent: gift.price,
      credits_remaining: senderResult.rows[0].credits - gift.price,
      receiver_progress: {
        total_received: progress.total_credits_received,
        unlock_threshold: gift.unlock_threshold,
        unlocked: justUnlocked || progress.is_unlocked,
        just_unlocked: justUnlocked
      }
    });
    
  } catch (error) {
    console.error('Send gift error:', error);
    res.status(500).json({ error: 'Failed to send gift' });
  }
});

// Get received gifts (for a user to see their inventory)
router.get('/received', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const result = await query(
      `SELECT 
        gc.id as gift_id,
        gc.title,
        gc.icon,
        gc.price,
        gc.unlock_threshold,
        gc.type,
        gr.total_credits_received,
        gr.gift_count,
        gr.is_unlocked,
        gr.unlocked_at
       FROM gifts_received gr
       JOIN gift_catalog gc ON gr.gift_id = gc.id
       WHERE gr.user_id = $1
       ORDER BY gr.is_unlocked DESC, gr.total_credits_received DESC`,
      [userId]
    );
    
    res.json({
      success: true,
      gifts: result.rows
    });
  } catch (error) {
    console.error('Get received gifts error:', error);
    res.status(500).json({ error: 'Failed to get gifts' });
  }
});

// Apply gift to confession (only unlocked effects)
router.post('/apply', authenticateToken, async (req, res) => {
  try {
    const { confession_id, gift_id } = req.body;
    const userId = req.user.id;
    
    // Check if user owns this confession
    const confessionResult = await query(
      'SELECT user_id FROM confessions WHERE id = $1',
      [confession_id]
    );
    
    if (confessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Confession not found' });
    }
    
    if (confessionResult.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'Not your confession!' });
    }
    
    // Check if gift is unlocked
    const giftCheck = await query(
      `SELECT gr.is_unlocked, gc.type 
       FROM gifts_received gr
       JOIN gift_catalog gc ON gr.gift_id = gc.id
       WHERE gr.user_id = $1 AND gr.gift_id = $2`,
      [userId, gift_id]
    );
    
    if (giftCheck.rows.length === 0 || !giftCheck.rows[0].is_unlocked) {
      return res.status(400).json({ error: 'Gift not unlocked yet!' });
    }
    
    // Only effects can be applied
    if (giftCheck.rows[0].type !== 'effect') {
      return res.status(400).json({ error: 'Only effects can be applied to confessions!' });
    }
    
    // Apply gift (replaces existing if any)
    await query(
      `INSERT INTO applied_gifts (confession_id, user_id, gift_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (confession_id) 
       DO UPDATE SET gift_id = $3, applied_at = NOW()`,
      [confession_id, userId, gift_id]
    );
    
    console.log(`✨ Applied gift ${gift_id} to confession ${confession_id}`);
    
    res.json({
      success: true,
      message: 'Gift effect applied!'
    });
    
  } catch (error) {
    console.error('Apply gift error:', error);
    res.status(500).json({ error: 'Failed to apply gift' });
  }
});

// Remove applied gift
router.delete('/remove/:confessionId', authenticateToken, async (req, res) => {
  try {
    const { confessionId } = req.params;
    const userId = req.user.id;
    
    await query(
      'DELETE FROM applied_gifts WHERE confession_id = $1 AND user_id = $2',
      [confessionId, userId]
    );
    
    res.json({
      success: true,
      message: 'Gift effect removed'
    });
    
  } catch (error) {
    console.error('Remove gift error:', error);
    res.status(500).json({ error: 'Failed to remove gift' });
  }
});

// ADMIN: Get gift stats
router.get('/admin/stats', authenticateToken, async (req, res) => {
  try {
    // Total gifts sent
    const totalSent = await query(
      'SELECT COUNT(*) as count, SUM(credits_spent) as total_credits FROM gifts_sent'
    );
    
    // Top senders
    const topSenders = await query(
      `SELECT 
        u.username,
        u.user_number,
        COUNT(*) as gifts_sent,
        SUM(gs.credits_spent) as credits_spent
       FROM gifts_sent gs
       JOIN users u ON gs.sender_id = u.id
       GROUP BY u.id, u.username, u.user_number
       ORDER BY credits_spent DESC
       LIMIT 10`
    );
    
    // Top receivers
    const topReceivers = await query(
      `SELECT 
        u.username,
        u.user_number,
        COUNT(*) as gifts_received,
        SUM(gs.credits_spent) as credits_received
       FROM gifts_sent gs
       JOIN users u ON gs.receiver_id = u.id
       GROUP BY u.id, u.username, u.user_number
       ORDER BY credits_received DESC
       LIMIT 10`
    );
    
    // Most popular gifts
    const popularGifts = await query(
      `SELECT 
        gc.title,
        gc.icon,
        COUNT(*) as times_sent,
        SUM(gs.credits_spent) as total_revenue
       FROM gifts_sent gs
       JOIN gift_catalog gc ON gs.gift_id = gc.id
       GROUP BY gc.id, gc.title, gc.icon
       ORDER BY times_sent DESC`
    );
    
    res.json({
      success: true,
      stats: {
        total_gifts_sent: parseInt(totalSent.rows[0].count),
        total_revenue: parseInt(totalSent.rows[0].total_credits || 0),
        top_senders: topSenders.rows,
        top_receivers: topReceivers.rows,
        popular_gifts: popularGifts.rows
      }
    });
    
  } catch (error) {
    console.error('Gift stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

export default router;