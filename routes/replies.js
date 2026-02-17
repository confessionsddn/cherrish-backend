import express from 'express';
import { query } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { notifyReply } from './notifications.js';
import { logManualActivity } from '../middleware/activity-logger.js';
const router = express.Router();

// Get all replies for a confession
router.get('/confession/:confessionId', authenticateToken, async (req, res) => {
  try {
    const { confessionId } = req.params;
    
    const result = await query(
      `SELECT 
        r.id, r.confession_id, r.user_id, r.content, r.likes_count,
        to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at, /* <--- FIXED TIMEZONE */
        u.username,
        u.user_number,
        EXISTS(SELECT 1 FROM reply_likes WHERE reply_id = r.id AND user_id = $1) as user_has_liked
       FROM confession_replies r
       JOIN users u ON r.user_id = u.id
       WHERE r.confession_id = $2
       ORDER BY r.created_at ASC`,
      [req.user.id, confessionId]
    );
    
    res.json({
      success: true,
      replies: result.rows
    });
    
  } catch (error) {
    console.error('Get replies error:', error);
    res.status(500).json({ error: 'Failed to get replies' });
  }
});

// Post a reply (FREE)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { confession_id, content } = req.body;
    
    if (!confession_id || !content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Confession ID and content required' });
    }
    
    if (content.length > 500) {
      return res.status(400).json({ error: 'Reply too long (max 500 characters)' });
    }
    
    // Check confession exists
    const confessionCheck = await query(
      'SELECT id FROM confessions WHERE id = $1',
      [confession_id]
    );
    
    if (confessionCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Confession not found' });
    }
    
    // Create reply (FREE - no credit cost)
    // We explicitly format created_at in the RETURNING clause
    const result = await query(
      `INSERT INTO confession_replies (confession_id, user_id, content)
       VALUES ($1, $2, $3)
       RETURNING id, confession_id, user_id, content, likes_count,
       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at`, /* <--- FIXED TIMEZONE */
      [confession_id, req.user.id, content.trim()]
    );
    await notifyReply(confession_id, req.user.id, content);
logManualActivity(req.user.id, 'post_reply', { confession_id }, confession_id, 0);    // Increment confession replies count
    await query(
      'UPDATE confessions SET replies_count = replies_count + 1 WHERE id = $1',
      [confession_id]
    );
    
    // Get user info
    const userInfo = await query(
      'SELECT username, user_number FROM users WHERE id = $1',
      [req.user.id]
    );
    
    console.log('✅ Reply posted:', req.user.username);
    
    res.json({
      success: true,
      reply: {
        ...result.rows[0],
        username: userInfo.rows[0].username,
        user_number: userInfo.rows[0].user_number,
        user_has_liked: false
      }
    });
    
  } catch (error) {
    console.error('Post reply error:', error);
    res.status(500).json({ error: 'Failed to post reply' });
  }
});

// Like a reply (1 CREDIT)
router.post('/:replyId/like', authenticateToken, async (req, res) => {
  try {
    const { replyId } = req.params;
    const userId = req.user.id;
    
    // Check if reply exists
    const replyCheck = await query(
      'SELECT id FROM confession_replies WHERE id = $1',
      [replyId]
    );
    
    if (replyCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Reply not found' });
    }
    
    // Check if already liked
    const likeCheck = await query(
      'SELECT id FROM reply_likes WHERE reply_id = $1 AND user_id = $2',
      [replyId, userId]
    );
    
    if (likeCheck.rows.length > 0) {
      // Unlike (toggle off)
      await query(
        'DELETE FROM reply_likes WHERE reply_id = $1 AND user_id = $2',
        [replyId, userId]
      );
      
      await query(
        'UPDATE confession_replies SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = $1',
        [replyId]
      );
      
      const updated = await query(
        'SELECT likes_count FROM confession_replies WHERE id = $1',
        [replyId]
      );
      
      return res.json({
        success: true,
        action: 'unliked',
        likes_count: updated.rows[0].likes_count,
        user_has_liked: false
      });
    }
    
    // Check credits
    const userResult = await query(
      'SELECT credits FROM users WHERE id = $1',
      [userId]
    );
    
    if (userResult.rows[0].credits < 1) {
      return res.status(400).json({ 
        error: 'Not enough credits! Need 1 credit to like a reply.',
        required: 1,
        current: userResult.rows[0].credits
      });
    }
    
    // Like reply
    await query(
      'UPDATE users SET credits = credits - 1 WHERE id = $1',
      [userId]
    );
    
    await query(
      'INSERT INTO reply_likes (reply_id, user_id) VALUES ($1, $2)',
      [replyId, userId]
    );
    
    await query(
      'UPDATE confession_replies SET likes_count = likes_count + 1 WHERE id = $1',
      [replyId]
    );
    
    // Log transaction
    await query(
      `INSERT INTO credit_transactions (user_id, amount, type, description)
       VALUES ($1, -1, 'spent', 'Liked a reply')`,
      [userId]
    );
    
    const updated = await query(
      'SELECT likes_count FROM confession_replies WHERE id = $1',
      [replyId]
    );
    
    res.json({
      success: true,
      action: 'liked',
      credits_spent: 1,
      credits_remaining: userResult.rows[0].credits - 1,
      likes_count: updated.rows[0].likes_count,
      user_has_liked: true
    });
    
  } catch (error) {
    console.error('Like reply error:', error);
    res.status(500).json({ error: 'Failed to like reply' });
  }
});

// Delete own reply
router.delete('/:replyId', authenticateToken, async (req, res) => {
  try {
    const { replyId } = req.params;
    
    const result = await query(
      'DELETE FROM confession_replies WHERE id = $1 AND user_id = $2 RETURNING confession_id',
      [replyId, req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reply not found or unauthorized' });
    }
    
    // Decrement confession replies count
    await query(
      'UPDATE confessions SET replies_count = GREATEST(replies_count - 1, 0) WHERE id = $1',
      [result.rows[0].confession_id]
    );
    
    res.json({
      success: true,
      message: 'Reply deleted'
    });
    
  } catch (error) {
    console.error('Delete reply error:', error);
    res.status(500).json({ error: 'Failed to delete reply' });
  }
});

export default router;
