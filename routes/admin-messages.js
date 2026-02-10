// backend/routes/admin-messages.js
import express from 'express';
import { query } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';

const router = express.Router();

// Send message (user → admin OR admin → user)
router.post('/send', authenticateToken, async (req, res) => {
  try {
    const { message, recipient_user_id } = req.body;
    const isAdmin = req.user.is_admin;
    
    if (!message || message.trim() === '') {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }
    
    let userId;
    let senderType;
    
    if (isAdmin && recipient_user_id) {
      // Admin sending to specific user
      userId = recipient_user_id;
      senderType = 'admin';
    } else {
      // User sending to admin
      userId = req.user.id;
      senderType = 'user';
    }
    
    const result = await query(
      `INSERT INTO admin_messages (user_id, sender_type, message, is_read)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, senderType, message.trim(), false]
    );
    
    console.log(`💬 Message: ${senderType} → ${userId.substring(0, 8)}`);
    
    res.json({
      success: true,
      message: result.rows[0]
    });
    
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Get conversation (user's view OR admin's view of specific user)
router.get('/conversation/:userId?', authenticateToken, async (req, res) => {
  try {
    const isAdmin = req.user.is_admin;
    const userId = req.params.userId || req.user.id;
    
    // Non-admin can only see their own conversation
    if (!isAdmin && userId !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const result = await query(
      `SELECT * FROM admin_messages 
       WHERE user_id = $1 
       ORDER BY created_at ASC`,
      [userId]
    );
    
    // Mark as read if user is viewing
    if (!isAdmin) {
      await query(
        `UPDATE admin_messages 
         SET is_read = true 
         WHERE user_id = $1 AND sender_type = 'admin' AND is_read = false`,
        [userId]
      );
    }
    
    res.json({
      success: true,
      messages: result.rows
    });
    
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

// Get unread count (for badge)
router.get('/unread-count', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const result = await query(
      `SELECT COUNT(*) as count FROM admin_messages 
       WHERE user_id = $1 AND sender_type = 'admin' AND is_read = false`,
      [userId]
    );
    
    res.json({
      success: true,
      unread_count: parseInt(result.rows[0].count)
    });
    
  } catch (error) {
    console.error('Unread count error:', error);
    res.status(500).json({ error: 'Failed to get count' });
  }
});

// ADMIN: Get all conversations (list of users with messages)
router.get('/admin/all-conversations', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await query(
      `SELECT DISTINCT ON (am.user_id)
        am.user_id,
        u.username,
        u.user_number,
        u.email,
        am.message as last_message,
        am.sender_type as last_sender,
        am.created_at as last_message_time,
        (SELECT COUNT(*) FROM admin_messages 
         WHERE user_id = am.user_id AND sender_type = 'user' AND is_read = false) as unread_count
       FROM admin_messages am
       JOIN users u ON am.user_id = u.id
       ORDER BY am.user_id, am.created_at DESC`
    );
    
    res.json({
      success: true,
      conversations: result.rows
    });
    
  } catch (error) {
    console.error('Get all conversations error:', error);
    res.status(500).json({ error: 'Failed to get conversations' });
  }
});

// ADMIN: Mark conversation as read
router.post('/admin/mark-read/:userId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    await query(
      `UPDATE admin_messages 
       SET is_read = true 
       WHERE user_id = $1 AND sender_type = 'user'`,
      [userId]
    );
    
    res.json({
      success: true,
      message: 'Marked as read'
    });
    
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

export default router;