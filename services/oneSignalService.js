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
      `SELECT id, onesignal_player_id 
       FROM users 
       WHERE id = ANY($1) 
       AND onesignal_player_id IS NOT NULL
       AND push_enabled = true`,
      [userIds]
    );
    
    return result.rows.reduce((acc, row) => {
      acc[row.id] = row.onesignal_player_id;
      return acc;
    }, {});
    
  } catch (error) {
    console.error('Error getting player IDs:', error);
    return {};
  }
};

// ============================================
// PROCESS NOTIFICATION QUEUE
// (Run this periodically via cron job)
// ============================================

export const processNotificationQueue = async () => {
  try {
    // Get pending notifications
    const result = await query(
      `SELECT * FROM notification_queue 
       WHERE sent = false 
       ORDER BY created_at ASC 
       LIMIT 100`
    );
    
    if (result.rows.length === 0) {
      console.log('📭 Notification queue empty');
      return;
    }
    
    console.log(`📬 Processing ${result.rows.length} notifications`);
    
    for (const notification of result.rows) {
      try {
        // Get user's player ID
        const userResult = await query(
          'SELECT onesignal_player_id, push_enabled FROM users WHERE id = $1',
          [notification.user_id]
        );
        
        if (userResult.rows.length === 0 || !userResult.rows[0].push_enabled) {
          // Mark as sent even if user doesn't have push enabled
          await query(
            `UPDATE notification_queue 
             SET sent = true, sent_at = NOW(), error = 'push_disabled'
             WHERE id = $1`,
            [notification.id]
          );
          continue;
        }
        
        const player_id = userResult.rows[0].onesignal_player_id;
        
        if (!player_id) {
          await query(
            `UPDATE notification_queue 
             SET sent = true, sent_at = NOW(), error = 'no_player_id'
             WHERE id = $1`,
            [notification.id]
          );
          continue;
        }
        
        // Send notification
        const notificationData = notification.data ? JSON.parse(notification.data) : {};
        
        const sendResult = await sendNotification({
          user_id: notification.user_id,
          player_id: player_id,
          title: notification.title,
          message: notification.message,
          data: notificationData,
          url: notificationData.url
        });
        
        if (sendResult.success) {
          await query(
            `UPDATE notification_queue 
             SET sent = true, sent_at = NOW()
             WHERE id = $1`,
            [notification.id]
          );
        } else {
          await query(
            `UPDATE notification_queue 
             SET error = $1
             WHERE id = $2`,
            [JSON.stringify(sendResult.error), notification.id]
          );
        }
        
      } catch (error) {
        console.error(`❌ Error processing notification ${notification.id}:`, error);
        await query(
          `UPDATE notification_queue 
           SET error = $1
           WHERE id = $2`,
          [error.message, notification.id]
        );
      }
    }
    
    console.log('✅ Notification queue processed');
    
  } catch (error) {
    console.error('❌ Process queue error:', error);
  }
};
