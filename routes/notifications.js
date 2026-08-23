// backend/routes/notifications.js — COMPLETE with in-app + push endpoints
import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { query } from '../config/database.js';
import { sendToAll, NotificationTemplates } from '../services/oneSignalService.js';
import { enqueueBroadcast } from '../services/notificationService.js';

const router = express.Router();

// ============================================
// REGISTER PLAYER ID (multi-device)
// ============================================
router.post('/register', authenticateToken, async (req, res) => {
  try {
    const { player_id, device_type = 'web' } = req.body;
    const userId = req.user.id;

    if (!player_id) {
      return res.status(400).json({ error: 'Player ID required' });
    }

    // Upsert into user_player_ids (multi-device)
    await query(
      `INSERT INTO user_player_ids (user_id, player_id, device_type, last_active_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (player_id) 
       DO UPDATE SET user_id = $1, last_active_at = NOW()`,
      [userId, player_id, device_type]
    );

    console.log(`✅ Player registered: ${userId} → ${player_id} (${device_type})`);

    res.json({ success: true, message: 'Push notifications enabled!' });
  } catch (error) {
    console.error('Register player error:', error);
    res.status(500).json({ error: 'Failed to register' });
  }
});

// ============================================
// UNREGISTER PLAYER ID (on logout)
// ============================================
router.delete('/unregister', authenticateToken, async (req, res) => {
  try {
    const { player_id } = req.body;
    const userId = req.user.id;

    if (player_id) {
      await query(
        'DELETE FROM user_player_ids WHERE player_id = $1 AND user_id = $2',
        [player_id, userId]
      );
    }

    res.json({ success: true, message: 'Device unregistered' });
  } catch (error) {
    console.error('Unregister error:', error);
    res.status(500).json({ error: 'Failed to unregister' });
  }
});

// ============================================
// GET IN-APP NOTIFICATIONS (paginated)
// ============================================
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 50, offset = 0 } = req.query;

    const result = await query(
      `SELECT id, type, title, message, data, is_read, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, parseInt(limit), parseInt(offset)]
    );

    res.json({ success: true, notifications: result.rows });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Failed to get notifications' });
  }
});

// ============================================
// GET UNREAD COUNT (for bell badge)
// ============================================
router.get('/unread-count', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await query(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND is_read = false',
      [userId]
    );

    res.json({ success: true, unread_count: parseInt(result.rows[0].count) });
  } catch (error) {
    console.error('Unread count error:', error);
    res.status(500).json({ error: 'Failed to get count' });
  }
});

// ============================================
// MARK ALL AS READ
// ============================================
router.post('/mark-read', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    await query(
      'UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false',
      [userId]
    );

    res.json({ success: true, unread_count: 0 });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// ============================================
// GET PREFERENCES
// ============================================
router.get('/preferences', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await query(
      'SELECT notification_preferences FROM users WHERE id = $1',
      [userId]
    );

    const prefs = result.rows[0]?.notification_preferences || {
      reactions: true, gifts: true, themes: true, replies: true,
      reply_likes: true, announcements: true, polls: true, account_status: true
    };

    res.json({ success: true, preferences: prefs });
  } catch (error) {
    console.error('Get preferences error:', error);
    res.status(500).json({ error: 'Failed to get preferences' });
  }
});

// ============================================
// UPDATE PREFERENCES
// ============================================
router.put('/preferences', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { preferences } = req.body;

    if (!preferences || typeof preferences !== 'object') {
      return res.status(400).json({ error: 'Invalid preferences object' });
    }

    await query(
      'UPDATE users SET notification_preferences = $1 WHERE id = $2',
      [JSON.stringify(preferences), userId]
    );

    res.json({ success: true, preferences });
  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

// ============================================
// ADMIN: SEND ANNOUNCEMENT (enhanced with NotificationService)
// ============================================
router.post('/announce', authenticateToken, async (req, res) => {
  try {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin only' });
    }

    const { title, message, target_audience = 'all' } = req.body;

    if (!title || !message) {
      return res.status(400).json({ error: 'Title and message required' });
    }

    // Broadcast via NotificationService (in-app + push queue)
    const io = req.app.get('io');
    const count = await enqueueBroadcast({
      type: 'announcement',
      title: `📢 ${title}`,
      message,
      data: { url: '/community' },
      excludeUserId: req.user.id,
      io
    });

    // Also send directly via OneSignal "All" segment for immediate push
    await sendToAll({
      title: `📢 ${title}`,
      message,
      data: { type: 'announcement' },
      url: 'https://www.cherrish.in/community'
    });

    console.log(`📢 Announcement: "${title}" → ${count} users`);

    res.json({
      success: true,
      message: 'Announcement sent!',
      recipients: count
    });
  } catch (error) {
    console.error('Announce error:', error);
    res.status(500).json({ error: 'Failed to send announcement' });
  }
});

export default router;

// ============================================
// EXPORTED HELPERS (called from other routes)
// These are kept for backward compatibility but
// new code should use NotificationService directly
// ============================================

export const notifyGift = async (confessionId, senderId, giftType, giftName) => {
  // Handled by NotificationService in gifts.js now
  // This export is kept so existing imports don't break
};

export const notifyReply = async (confessionId, replierId, replyContent) => {
  // Handled by NotificationService in replies.js now
};

export const notifyReactions = async (confessionId, count) => {
  // Handled by NotificationService in confessions.js now
};
