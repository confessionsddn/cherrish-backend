// backend/services/oneSignalService.js
// ============================================
// ONESIGNAL NOTIFICATION SERVICE
// Handles all push notifications via OneSignal
// ============================================

import fetch from 'node-fetch';

// ⚠️ ADD THESE TO YOUR .env FILE:
// ONESIGNAL_APP_ID=your_app_id_here
// ONESIGNAL_REST_API_KEY=your_rest_api_key_here

const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;
const ONESIGNAL_API_URL = 'https://onesignal.com/api/v1';

// ============================================
// SEND NOTIFICATION TO USER
// ============================================

export const sendNotification = async ({
  user_id,
  player_id,
  title,
  message,
  data = {},
  url = null
}) => {
  try {
    if (!player_id) {
      console.warn(`⚠️ No player_id for user ${user_id}, skipping notification`);
      return { success: false, reason: 'no_player_id' };
    }

    const notification = {
      app_id: ONESIGNAL_APP_ID,
      include_player_ids: [player_id],
      headings: { en: title },
      contents: { en: message },
      data: data,
      web_url: url || `https://www.cherrish.in`,
      chrome_web_icon: 'https://www.cherrish.in/icon-192.png',
      chrome_web_badge: 'https://www.cherrish.in/badge-72.png'
    };

    const response = await fetch(`${ONESIGNAL_API_URL}/notifications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`
      },
      body: JSON.stringify(notification)
    });

    const result = await response.json();

    if (result.id) {
      console.log(`✅ Notification sent: ${title} to user ${user_id}`);
      return { success: true, notification_id: result.id };
    } else {
      console.error('❌ OneSignal error:', result);
      return { success: false, error: result };
    }

  } catch (error) {
    console.error('❌ Send notification error:', error);
    return { success: false, error: error.message };
  }
};

// ============================================
// SEND TO MULTIPLE USERS
// ============================================

export const sendBulkNotification = async ({
  player_ids,
  title,
  message,
  data = {},
  url = null
}) => {
  try {
    const notification = {
      app_id: ONESIGNAL_APP_ID,
      include_player_ids: player_ids,
      headings: { en: title },
      contents: { en: message },
      data: data,
      web_url: url || `https://www.cherrish.in`
    };

    const response = await fetch(`${ONESIGNAL_API_URL}/notifications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`
      },
      body: JSON.stringify(notification)
    });

    const result = await response.json();

    if (result.id) {
      console.log(`✅ Bulk notification sent to ${player_ids.length} users`);
      return { success: true, notification_id: result.id, recipients: result.recipients };
    } else {
      console.error('❌ OneSignal bulk error:', result);
      return { success: false, error: result };
    }

  } catch (error) {
    console.error('❌ Send bulk notification error:', error);
    return { success: false, error: error.message };
  }
};

// ============================================
// SEND TO ALL USERS (ANNOUNCEMENTS)
// ============================================

export const sendToAll = async ({
  title,
  message,
  data = {},
  url = null,
  filters = null // Optional: filter by premium, etc.
}) => {
  try {
    const notification = {
      app_id: ONESIGNAL_APP_ID,
      included_segments: ['All'],
      headings: { en: title },
      contents: { en: message },
      data: data,
      web_url: url || `https://www.cherrish.in`
    };

    // Add filters if provided (e.g., premium users only)
    if (filters) {
      notification.filters = filters;
    }

    const response = await fetch(`${ONESIGNAL_API_URL}/notifications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`
      },
      body: JSON.stringify(notification)
    });

    const result = await response.json();

    if (result.id) {
      console.log(`✅ Announcement sent to all users`);
      return { success: true, notification_id: result.id };
    } else {
      console.error('❌ OneSignal announcement error:', result);
      return { success: false, error: result };
    }

  } catch (error) {
    console.error('❌ Send announcement error:', error);
    return { success: false, error: error.message };
  }
};

// ============================================
// NOTIFICATION TEMPLATES
// ============================================

export const NotificationTemplates = {
  
  // Reply notification
  reply: (replierUsername, confessionPreview) => ({
    title: '💬 New Reply!',
    message: `${replierUsername} replied to your confession: "${confessionPreview}"`
  }),
  
  // Gift notification
  gift: (senderUsername, giftName, confessionPreview) => ({
    title: '🎁 Gift Received!',
    message: `${senderUsername} sent you ${giftName} on your confession: "${confessionPreview}"`
  }),
  
  // Theme unlocked
  themeUnlocked: (themeName) => ({
    title: '🎨 Theme Unlocked!',
    message: `Congratulations! You've unlocked the ${themeName} theme!`
  }),
  
  // Reaction notification (batched)
  reactions: (count, confessionPreview) => ({
    title: `❤️ ${count} New Reactions!`,
    message: `Your confession "${confessionPreview}" received ${count} new reactions!`
  }),
  
  // Premium expiry warning
  premiumExpiry: (daysLeft) => ({
    title: '⭐ Premium Expiring Soon!',
    message: `Your premium subscription expires in ${daysLeft} days. Renew to keep unlimited access!`
  }),
  
  // Confession approved
  confessionApproved: (confessionPreview) => ({
    title: '✅ Confession Approved!',
    message: `Your confession "${confessionPreview}" is now live!`
  }),
  
  // Confession rejected
  confessionRejected: (reason) => ({
    title: '❌ Confession Rejected',
    message: `Your confession was not approved. Reason: ${reason}`
  }),
  
  // Admin announcement
  announcement: (title, message) => ({
    title: `📢 ${title}`,
    message: message
  }),
  
  // Ban notification
  banned: (duration) => ({
    title: '🚫 Account Restricted',
    message: `Your account has been banned for ${duration}. Pay to unban.`
  })
};

// ============================================
// HELPER: GET USER'S PLAYER ID
// ============================================

import { query } from '../config/database.js';

export const getUserPlayerIds = async (userIds) => {
  try {
    const result = await query(
      `SELECT user_id, player_id 
       FROM user_player_ids 
       WHERE user_id = ANY($1)`,
      [userIds]
    );
    
    // Group by user_id: { userId: [player_id1, player_id2, ...] }
    return result.rows.reduce((acc, row) => {
      if (!acc[row.user_id]) acc[row.user_id] = [];
      acc[row.user_id].push(row.player_id);
      return acc;
    }, {});
    
  } catch (error) {
    console.error('Error getting player IDs:', error);
    return {};
  }
};

// ============================================
// PROCESS NOTIFICATION QUEUE (ENHANCED)
// Multi-device, retry logic, proper failure handling
// ============================================

export const processNotificationQueue = async () => {
  try {
    // Get pending notifications (not sent, not permanently failed, max 100)
    const result = await query(
      `SELECT * FROM notification_queue 
       WHERE is_sent = false AND failed = false
       ORDER BY created_at ASC 
       LIMIT 100`
    );
    
    if (result.rows.length === 0) {
      return;
    }
    
    console.log(`📬 Processing ${result.rows.length} push notifications`);
    
    for (const notification of result.rows) {
      try {
        // Get ALL player IDs for this user (multi-device)
        const playerResult = await query(
          'SELECT player_id FROM user_player_ids WHERE user_id = $1',
          [notification.user_id]
        );
        
        if (playerResult.rows.length === 0) {
          // No subscribed devices — mark as sent with reason
          await query(
            `UPDATE notification_queue 
             SET is_sent = true, fail_reason = 'no_player_ids'
             WHERE id = $1`,
            [notification.id]
          );
          continue;
        }
        
        const playerIds = playerResult.rows.map(r => r.player_id);
        const notificationData = typeof notification.data === 'string' 
          ? JSON.parse(notification.data) 
          : (notification.data || {});
        
        // Send to all devices
        const sendResult = await sendBulkNotification({
          player_ids: playerIds,
          title: notification.title,
          message: notification.message,
          data: notificationData,
          url: notificationData.url || 'https://www.cherrish.in'
        });
        
        if (sendResult.success) {
          // Success — mark as sent
          await query(
            `UPDATE notification_queue 
             SET is_sent = true, onesignal_notification_id = $1
             WHERE id = $2`,
            [sendResult.notification_id, notification.id]
          );
        } else {
          // Failure — increment retry or mark as permanently failed
          const newRetryCount = (notification.retry_count || 0) + 1;
          
          if (newRetryCount >= 3) {
            await query(
              `UPDATE notification_queue 
               SET failed = true, retry_count = $1, fail_reason = $2
               WHERE id = $3`,
              [newRetryCount, JSON.stringify(sendResult.error || 'max_retries_exceeded'), notification.id]
            );
          } else {
            await query(
              `UPDATE notification_queue 
               SET retry_count = $1, fail_reason = $2
               WHERE id = $3`,
              [newRetryCount, JSON.stringify(sendResult.error || 'delivery_failed'), notification.id]
            );
          }
          
          // Handle 410 Gone — remove stale player IDs
          if (sendResult.error?.errors?.invalid_player_ids) {
            for (const staleId of sendResult.error.errors.invalid_player_ids) {
              await query('DELETE FROM user_player_ids WHERE player_id = $1', [staleId]);
              console.log(`🗑️ Removed stale player_id: ${staleId}`);
            }
          }
        }
        
      } catch (error) {
        console.error(`❌ Error processing notification ${notification.id}:`, error.message);
        const newRetry = (notification.retry_count || 0) + 1;
        await query(
          `UPDATE notification_queue SET retry_count = $1, fail_reason = $2 WHERE id = $3`,
          [newRetry, error.message, notification.id]
        );
      }
    }
    
    console.log('✅ Push notification queue processed');
    
  } catch (error) {
    console.error('❌ Process queue error:', error);
  }
};
