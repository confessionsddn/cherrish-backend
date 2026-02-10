// backend/middleware/activity-logger.js
import { query } from '../config/database.js';

/**
 * Activity Logger Middleware
 * Logs every user action to user_activity_log table
 * 
 * Usage: logActivity('action_type', creditsChange)
 * Example: router.post('/confessions', authenticateToken, logActivity('post_confession', -2), async (req, res) => {...})
 */

export function logActivity(actionType, creditsChange = 0) {
  return async (req, res, next) => {
    // Store original send
    const originalSend = res.send;
    
    // Override send to capture response
    res.send = function(data) {
      // Log activity after response is sent
      logActivityAsync(req, actionType, creditsChange, data);
      
      // Call original send
      originalSend.call(this, data);
    };
    
    next();
  };
}

async function logActivityAsync(req, actionType, creditsChange, responseData) {
  try {
    if (!req.user || !req.user.id) return; // No user authenticated
    
    const userId = req.user.id;
    let actionDetails = {};
    let targetId = null;
    
    // Extract relevant details based on action type
    switch (actionType) {
      case 'login':
        actionDetails = { ip: req.ip, user_agent: req.headers['user-agent'] };
        break;
        
      case 'post_confession':
        targetId = req.body.confession_id || extractIdFromResponse(responseData, 'confession');
        actionDetails = { 
          mood_zone: req.body.mood_zone,
          has_audio: !!req.file,
          content_length: req.body.content?.length || 0
        };
        break;
        
      case 'react':
        targetId = req.params.id || req.body.confession_id;
        actionDetails = { 
          reaction_type: req.body.reaction_type,
          action: req.body.action
        };
        break;
        
      case 'reply':
        targetId = req.body.confession_id;
        actionDetails = { 
          reply_length: req.body.content?.length || 0
        };
        break;
        
      case 'gift_sent':
        targetId = req.body.receiver_id;
        actionDetails = { 
          gift_id: req.body.gift_id,
          confession_id: req.body.confession_id
        };
        break;
        
      case 'buy_credits':
        actionDetails = { 
          package: req.body.package,
          amount: req.body.amount
        };
        break;
        
      case 'subscribe_premium':
        actionDetails = { 
          duration: req.body.duration || '1 month'
        };
        break;
        
      case 'username_change':
        actionDetails = { 
          old_username: req.user.username,
          new_username: req.body.new_username
        };
        break;
        
      case 'report_confession':
        targetId = req.params.id || req.body.confession_id;
        actionDetails = { 
          reason: req.body.reason
        };
        break;
        
      case 'poll_vote':
        targetId = req.body.poll_id;
        actionDetails = { 
          option_id: req.body.option_id
        };
        break;
        
      case 'message_reaction':
        targetId = req.body.message_id;
        actionDetails = { 
          reaction_type: req.body.reaction_type
        };
        break;
        
      default:
        actionDetails = { 
          method: req.method,
          path: req.path,
          body: sanitizeBody(req.body)
        };
    }
    
    // Insert log
    await query(
      `INSERT INTO user_activity_log (user_id, action_type, action_details, target_id, credits_change)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, actionType, JSON.stringify(actionDetails), targetId, creditsChange]
    );
    
    // Also update last_activity timestamp
    await query(
      'UPDATE users SET last_activity = NOW() WHERE id = $1',
      [userId]
    );
    
  } catch (error) {
    // Don't fail the request if logging fails
    console.error('Activity log error:', error.message);
  }
}

// Helper: Extract ID from response data
function extractIdFromResponse(data, type) {
  try {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    if (type === 'confession' && parsed.confession?.id) {
      return parsed.confession.id;
    }
    return parsed.id || null;
  } catch {
    return null;
  }
}

// Helper: Remove sensitive data from body
function sanitizeBody(body) {
  const sanitized = { ...body };
  delete sanitized.password;
  delete sanitized.token;
  delete sanitized.api_key;
  return sanitized;
}

// Standalone function to log activity manually
export async function logManualActivity(userId, actionType, actionDetails = {}, targetId = null, creditsChange = 0) {
  try {
    await query(
      `INSERT INTO user_activity_log (user_id, action_type, action_details, target_id, credits_change)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, actionType, JSON.stringify(actionDetails), targetId, creditsChange]
    );
    
    await query(
      'UPDATE users SET last_activity = NOW() WHERE id = $1',
      [userId]
    );
  } catch (error) {
    console.error('Manual activity log error:', error);
  }
}

export default { logActivity, logManualActivity };