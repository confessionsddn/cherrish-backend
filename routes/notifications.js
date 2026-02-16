// backend/routes/notifications.js
import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { query } from '../config/database.js';
import { sendNotification, NotificationTemplates, sendToAll } from '../services/oneSignalService.js';

const router = express.Router();

// ============================================
// SAVE USER'S ONESIGNAL PLAYER ID
// ============================================

router.post('/register', authenticateToken, async (req, res) => {
  try {
    const { player_id, push_enabled = true } = req.body;
    const userId = req.user.id;
    
    if (!player_id) {
      return res.status(400).json({ error: 'Player ID required' });
    }
    
    await query(
      `UPDATE users 
       SET onesignal_player_id = $1, push_enabled = $2 
       WHERE id = $3`,
      [player_id, push_enabled, userId]
    );
    
    console.log(`✅ OneSignal registered: ${userId} → ${player_id}`);
    
    res.json({
      success: true,
      message: 'Push notifications enabled!'
    });
    
  } catch (error) {
    console.error('Register OneSignal error:', error);
    res.status(500).json({ error: 'Failed to register notifications' });
  }
});

// ============================================
// TOGGLE PUSH NOTIFICATIONS
// ============================================

router.post('/toggle', authenticateToken, async (req, res) => {
  try {
    const { enabled } = req.body;
    const userId = req.user.id;
    
    await query(
      'UPDATE users SET push_enabled = $1 WHERE id = $2',
      [enabled, userId]
    );
    
    res.json({
      success: true,
      push_enabled: enabled,
      message: enabled ? 'Notifications enabled' : 'Notifications disabled'
    });
    
  } catch (error) {
    console.error('Toggle notifications error:', error);
    res.status(500).json({ error: 'Failed to toggle notifications' });
  }
});

// ============================================
// GET NOTIFICATION SETTINGS
// ============================================

router.get('/settings', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const result = await query(
      'SELECT onesignal_player_id, push_enabled FROM users WHERE id = $1',
      [userId]
    );
    
    res.json({
      success: true,
      has_player_id: !!result.rows[0].onesignal_player_id,
      push_enabled: result.rows[0].push_enabled
    });
    
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// ============================================
// ADMIN: SEND ANNOUNCEMENT TO ALL USERS
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
    
    // Save announcement to database
    const announcementResult = await query(
      `INSERT INTO system_announcements (created_by, title, message, target_audience)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [req.user.id, title, message, target_audience]
    );
    
    const announcementId = announcementResult.rows[0].id;
    
    // Send push notification
    const template = NotificationTemplates.announcement(title, message);
    
    const result = await sendToAll({
      title: template.title,
      message: template.message,
      data: {
        type: 'announcement',
        announcement_id: announcementId
      },
      url: 'https://www.cherrish.in'
    });
    
    if (result.success) {
      console.log(`📢 Announcement sent: ${title}`);
    }
    
    res.json({
      success: true,
      message: 'Announcement sent to all users!',
      announcement_id: announcementId,
      notification_result: result
    });
    
  } catch (error) {
    console.error('Send announcement error:', error);
    res.status(500).json({ error: 'Failed to send announcement' });
  }
});

// ============================================
// ADMIN: GET ANNOUNCEMENT STATS
// ============================================

router.get('/announcements/stats', authenticateToken, async (req, res) => {
  try {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin only' });
    }
    
    const result = await query(
      `SELECT 
        a.id,
        a.title,
        a.message,
        a.created_at,
        COUNT(ar.id) as read_count,
        (SELECT COUNT(*) FROM users WHERE push_enabled = true) as total_users
       FROM system_announcements a
       LEFT JOIN announcement_reads ar ON a.id = ar.announcement_id
       GROUP BY a.id
       ORDER BY a.created_at DESC
       LIMIT 20`
    );
    
    res.json({
      success: true,
      announcements: result.rows
    });
    
  } catch (error) {
    console.error('Get announcement stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// ============================================
// MARK ANNOUNCEMENT AS READ
// ============================================

router.post('/announcements/:id/read', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    await query(
      `INSERT INTO announcement_reads (announcement_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (announcement_id, user_id) DO NOTHING`,
      [id, userId]
    );
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// ============================================
// GET ACTIVE ANNOUNCEMENTS FOR USER
// ============================================

router.get('/announcements/active', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const result = await query(
      `SELECT 
        a.id,
        a.title,
        a.message,
        a.type,
        a.created_at,
        ar.id IS NOT NULL as is_read
       FROM system_announcements a
       LEFT JOIN announcement_reads ar ON a.id = ar.announcement_id AND ar.user_id = $1
       WHERE a.is_active = true
       AND (a.show_until IS NULL OR a.show_until > NOW())
       ORDER BY a.created_at DESC`,
      [userId]
    );
    
    res.json({
      success: true,
      announcements: result.rows
    });
    
  } catch (error) {
    console.error('Get active announcements error:', error);
    res.status(500).json({ error: 'Failed to get announcements' });
  }
});

export default router;

// ============================================
// HELPER FUNCTIONS TO TRIGGER NOTIFICATIONS
// (Call these from other routes)
// ============================================

// Trigger reply notification
export const notifyReply = async (confessionId, replierId, replyContent) => {
  try {
    // Get confession owner
    const confessionResult = await query(
      `SELECT c.user_id, c.content, u.onesignal_player_id, u.push_enabled
       FROM confessions c
       JOIN users u ON c.user_id = u.id
       WHERE c.id = $1`,
      [confessionId]
    );
    
    if (confessionResult.rows.length === 0) return;
    
    const owner = confessionResult.rows[0];
    
    // Don't notify if replier is owner
    if (owner.user_id === replierId) return;
    
    // Get replier info
    const replierResult = await query(
      'SELECT username FROM users WHERE id = $1',
      [replierId]
    );
    
    const replierUsername = replierResult.rows[0]?.username || 'Someone';
    const confessionPreview = owner.content.substring(0, 50) + (owner.content.length > 50 ? '...' : '');
    
    // Queue notification
    const template = NotificationTemplates.reply(replierUsername, confessionPreview);
    
    await query(
      `INSERT INTO notification_queue (user_id, notification_type, title, message, data)
       VALUES ($1, 'reply', $2, $3, $4)`,
      [
        owner.user_id,
        template.title,
        template.message,
        JSON.stringify({
          confession_id: confessionId,
          replier_username: replierUsername,
          url: `https://www.cherrish.in/?confession=${confessionId}`
        })
      ]
    );
    
  } catch (error) {
    console.error('Notify reply error:', error);
  }
};

// Trigger gift notification
export const notifyGift = async (confessionId, senderId, giftType, giftName) => {
  try {
    const confessionResult = await query(
      `SELECT c.user_id, c.content, u.is_premium
       FROM confessions c
       JOIN users u ON c.user_id = u.id
       WHERE c.id = $1`,
      [confessionId]
    );
    
    if (confessionResult.rows.length === 0) return;
    
    const owner = confessionResult.rows[0];
    const isPremium = owner.is_premium;
    
    // Get sender info (only if recipient is premium)
    let senderUsername = 'Someone';
    if (isPremium) {
      const senderResult = await query(
        'SELECT username FROM users WHERE id = $1',
        [senderId]
      );
      senderUsername = senderResult.rows[0]?.username || 'Someone';
    }
    
    const confessionPreview = owner.content.substring(0, 40) + '...';
    const template = NotificationTemplates.gift(senderUsername, giftName, confessionPreview);
    
    await query(
      `INSERT INTO notification_queue (user_id, notification_type, title, message, data)
       VALUES ($1, 'gift', $2, $3, $4)`,
      [
        owner.user_id,
        template.title,
        template.message,
        JSON.stringify({
          confession_id: confessionId,
          gift_type: giftType,
          sender_username: isPremium ? senderUsername : 'Anonymous',
          url: `https://www.cherrish.in/?confession=${confessionId}`
        })
      ]
    );
    
  } catch (error) {
    console.error('Notify gift error:', error);
  }
};

// Trigger reactions notification (batched - send once per hour)
export const notifyReactions = async (confessionId, newReactionsCount) => {
  try {
    // Only send if 5+ new reactions
    if (newReactionsCount < 5) return;
    
    const confessionResult = await query(
      `SELECT user_id, content FROM confessions WHERE id = $1`,
      [confessionId]
    );
    
    if (confessionResult.rows.length === 0) return;
    
    const confession = confessionResult.rows[0];
    const confessionPreview = confession.content.substring(0, 50) + '...';
    
    const template = NotificationTemplates.reactions(newReactionsCount, confessionPreview);
    
    await query(
      `INSERT INTO notification_queue (user_id, notification_type, title, message, data)
       VALUES ($1, 'reactions', $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [
        confession.user_id,
        template.title,
        template.message,
        JSON.stringify({
          confession_id: confessionId,
          reactions_count: newReactionsCount,
          url: `https://www.cherrish.in/?confession=${confessionId}`
        })
      ]
    );
    
  } catch (error) {
    console.error('Notify reactions error:', error);
  }
};

// Trigger premium expiry warning (run daily via cron)
export const notifyPremiumExpiry = async () => {
  try {
    // Get users whose premium expires in 3 days
    const result = await query(
      `SELECT ps.user_id, ps.end_date
       FROM premium_subscriptions ps
       JOIN users u ON ps.user_id = u.id
       WHERE ps.is_active = true
       AND ps.end_date > NOW()
       AND ps.end_date < NOW() + INTERVAL '3 days'
       AND u.push_enabled = true`
    );
    
    for (const sub of result.rows) {
      const daysLeft = Math.ceil((new Date(sub.end_date) - new Date()) / (1000 * 60 * 60 * 24));
      
      const template = NotificationTemplates.premiumExpiry(daysLeft);
      
      await query(
        `INSERT INTO notification_queue (user_id, notification_type, title, message, data)
         VALUES ($1, 'premium_expiry', $2, $3, $4)`,
        [
          sub.user_id,
          template.title,
          template.message,
          JSON.stringify({
            days_left: daysLeft,
            url: 'https://www.cherrish.in/premium'
          })
        ]
      );
    }
    
  } catch (error) {
    console.error('Notify premium expiry error:', error);
  }
};
