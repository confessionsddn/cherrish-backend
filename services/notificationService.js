// services/notificationService.js
// Central notification service — handles enqueue, deduplication, batching, preferences
import { query } from '../config/database.js';

const MILESTONES = [10, 25, 50, 100, 250, 500];

/**
 * Enqueue a notification for a single user
 * Checks preferences, handles deduplication, emits Socket.io event
 */
export async function enqueueNotification({ userId, type, title, message, data = {}, io, authorId = null }) {
  try {
    // Self-notification exclusion
    if (authorId && authorId === userId) return null;

    // Check user preferences
    const userResult = await query(
      'SELECT notification_preferences FROM users WHERE id = $1',
      [userId]
    );
    if (userResult.rows.length === 0) return null;

    const prefs = userResult.rows[0].notification_preferences || {};
    const typeKey = mapTypeToPreferenceKey(type);

    // Always insert into in-app notifications table
    const notifResult = await query(
      `INSERT INTO notifications (user_id, type, title, message, data)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [userId, type, title, message, JSON.stringify(data)]
    );

    // Emit real-time Socket.io event
    if (io) {
      io.to(`user_${userId}`).emit('new_notification', {
        id: notifResult.rows[0].id,
        type, title, message, data,
        created_at: notifResult.rows[0].created_at
      });
    }

    // Skip push if preference disabled
    if (prefs[typeKey] === false) return notifResult.rows[0];

    // Insert into push queue
    await query(
      `INSERT INTO notification_queue (user_id, notification_type, title, message, data, is_sent)
       VALUES ($1, $2, $3, $4, $5, false)`,
      [userId, type, title, message, JSON.stringify(data)]
    );

    return notifResult.rows[0];
  } catch (error) {
    console.error('NotificationService enqueue error:', error.message);
    return null;
  }
}

/**
 * Broadcast notification to all users (announcements, polls)
 */
export async function enqueueBroadcast({ type, title, message, data = {}, excludeUserId = null, io }) {
  try {
    // Get all active user IDs
    let queryText = 'SELECT id FROM users WHERE is_banned = false';
    const params = [];

    if (excludeUserId) {
      queryText += ' AND id != $1';
      params.push(excludeUserId);
    }

    const usersResult = await query(queryText, params);

    let count = 0;
    for (const user of usersResult.rows) {
      await enqueueNotification({
        userId: user.id,
        type, title, message, data, io
      });
      count++;
    }

    console.log(`📢 Broadcast: ${count} users notified (${type})`);
    return count;
  } catch (error) {
    console.error('NotificationService broadcast error:', error.message);
    return 0;
  }
}

/**
 * Enqueue reaction milestone notification (with deduplication)
 */
export async function enqueueReactionMilestone({ confessionId, userId, totalReactions, confessionPreview, io }) {
  try {
    // Find which milestone was crossed
    const milestone = MILESTONES.find(m => totalReactions >= m);
    if (!milestone) return null;

    // Check the highest milestone not yet sent
    const sentResult = await query(
      'SELECT milestone FROM reaction_milestones_sent WHERE confession_id = $1 ORDER BY milestone DESC LIMIT 1',
      [confessionId]
    );

    const lastSent = sentResult.rows.length > 0 ? sentResult.rows[0].milestone : 0;

    // Find the next milestone to notify about
    const nextMilestone = MILESTONES.find(m => m > lastSent && totalReactions >= m);
    if (!nextMilestone) return null;

    // Deduplicate: insert with unique constraint
    try {
      await query(
        'INSERT INTO reaction_milestones_sent (confession_id, milestone) VALUES ($1, $2)',
        [confessionId, nextMilestone]
      );
    } catch (e) {
      if (e.code === '23505') return null; // Already sent
      throw e;
    }

    const preview = confessionPreview?.substring(0, 50) || 'your confession';

    return enqueueNotification({
      userId,
      type: 'reactions',
      title: `🔥 ${nextMilestone} reactions!`,
      message: `Your confession "${preview}..." hit ${nextMilestone} reactions!`,
      data: { confession_id: confessionId, milestone: nextMilestone, url: '/' },
      io
    });
  } catch (error) {
    console.error('Milestone notification error:', error.message);
    return null;
  }
}

/**
 * Enqueue reply-like notification with 5-minute batching
 */
export async function enqueueReplyLike({ replyId, replyAuthorId, likerId, replyPreview, io }) {
  try {
    // Self-like exclusion
    if (likerId === replyAuthorId) return null;

    // Check for existing unsent reply_like notification within 5 minutes
    const existing = await query(
      `SELECT id, data FROM notification_queue 
       WHERE user_id = $1 AND notification_type = 'reply_like' AND is_sent = false
       AND created_at > NOW() - INTERVAL '5 minutes'
       AND data::text LIKE $2
       LIMIT 1`,
      [replyAuthorId, `%"reply_id":"${replyId}"%`]
    );

    if (existing.rows.length > 0) {
      // Batch: update existing notification count
      const existingData = typeof existing.rows[0].data === 'string' 
        ? JSON.parse(existing.rows[0].data) 
        : existing.rows[0].data;
      const newCount = (existingData.batch_count || 1) + 1;

      await query(
        `UPDATE notification_queue SET message = $1, data = $2 WHERE id = $3`,
        [
          `${newCount} people liked your reply "${replyPreview?.substring(0, 40)}..."`,
          JSON.stringify({ ...existingData, batch_count: newCount }),
          existing.rows[0].id
        ]
      );

      // Also update in-app notification
      await query(
        `UPDATE notifications SET message = $1 WHERE user_id = $2 AND type = 'reply_like' 
         AND created_at > NOW() - INTERVAL '5 minutes'
         AND data::text LIKE $3
         ORDER BY created_at DESC LIMIT 1`,
        [
          `${newCount} people liked your reply`,
          replyAuthorId,
          `%"reply_id":"${replyId}"%`
        ]
      );

      return null;
    }

    // New notification
    const preview = replyPreview?.substring(0, 40) || 'your reply';
    return enqueueNotification({
      userId: replyAuthorId,
      type: 'reply_like',
      title: '❤️ Reply liked!',
      message: `Someone liked your reply "${preview}..."`,
      data: { reply_id: replyId, batch_count: 1, url: '/' },
      io,
      authorId: likerId
    });
  } catch (error) {
    console.error('Reply-like notification error:', error.message);
    return null;
  }
}

/**
 * Map notification type to preference key
 */
function mapTypeToPreferenceKey(type) {
  const map = {
    'reactions': 'reactions',
    'gift': 'gifts',
    'theme_unlock': 'themes',
    'reply': 'replies',
    'reply_like': 'reply_likes',
    'announcement': 'announcements',
    'poll': 'polls',
    'premium': 'account_status',
    'account_status': 'account_status'
  };
  return map[type] || type;
}

export default {
  enqueueNotification,
  enqueueBroadcast,
  enqueueReactionMilestone,
  enqueueReplyLike
};
