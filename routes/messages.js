// ============================================
// LOVECONFESS - COMMUNITY MESSAGES ROUTES (ES6 VERSION)
// File: backend/routes/messages.js
// ============================================

import express from 'express';
import { query } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// ============================================
// MIDDLEWARE: Check if user is admin
// ============================================
const isAdmin = async (req, res, next) => {
  try {
    const result = await query(
      'SELECT is_admin FROM users WHERE id = $1',
      [req.user.id]
    );

    if (!result.rows[0]?.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    next();
  } catch (error) {
    console.error('Admin check error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// ============================================
// HELPER: Log admin actions
// ============================================
const logAdminAction = async (adminId, actionType, entityType, entityId, details, req) => {
  try {
    await query(
      `INSERT INTO admin_audit_log (admin_id, action_type, entity_type, entity_id, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        adminId,
        actionType,
        entityType,
        entityId,
        JSON.stringify(details),
        req.ip,
        req.get('user-agent')
      ]
    );
  } catch (error) {
    console.error('Audit log error:', error);
  }
};

// ============================================
// ADMIN ONLY: Send Community Message
// ============================================
router.post('/send', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { messageText, isPinned } = req.body;

    // Validation
    if (!messageText || !messageText.trim()) {
      return res.status(400).json({ error: 'Message text is required' });
    }

    // Sanitize input (XSS protection)
    const sanitizedMessage = messageText.trim().slice(0, 2000);

    const result = await query(
      `INSERT INTO community_messages (created_by, message_text, is_pinned)
       VALUES ($1, $2, $3)
       RETURNING id, message_text, is_pinned, total_reactions, created_at`,
      [req.user.id, sanitizedMessage, isPinned || false]
    );

    const message = result.rows[0];

    // Add admin info
    const userResult = await query(
      'SELECT username, is_admin FROM users WHERE id = $1',
      [req.user.id]
    );

    message.created_by_username = userResult.rows[0].username;
    message.created_by_is_admin = userResult.rows[0].is_admin;
    message.reactions = {
      thumbs_up: 0,
      thumbs_down: 0,
      heart: 0,
      fire: 0,
      celebrate: 0
    };
    message.user_reactions = [];

    await logAdminAction(
      req.user.id,
      'message_sent',
      'message',
      message.id,
      { messagePreview: sanitizedMessage.slice(0, 50) },
      req
    );

    // Emit Socket.io event
    if (req.app.get('io')) {
      req.app.get('io').emit('message_broadcast', message);
    }

    res.status(201).json({
      message: 'Message sent successfully',
      data: message
    });

  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// ============================================
// GET: All Messages (with reactions)
// ============================================
router.get('/', authenticateToken, async (req, res) => {
  try {
    const messagesResult = await query(
      `SELECT 
        cm.id,
        cm.message_text,
        cm.is_pinned,
        cm.total_reactions,
        cm.created_at,
        u.username AS created_by_username,
        u.is_admin AS created_by_is_admin,
        COUNT(CASE WHEN mr.reaction_type = 'thumbs_up' THEN 1 END)::INTEGER AS thumbs_up_count,
        COUNT(CASE WHEN mr.reaction_type = 'thumbs_down' THEN 1 END)::INTEGER AS thumbs_down_count,
        COUNT(CASE WHEN mr.reaction_type = 'heart' THEN 1 END)::INTEGER AS heart_count,
        COUNT(CASE WHEN mr.reaction_type = 'fire' THEN 1 END)::INTEGER AS fire_count,
        COUNT(CASE WHEN mr.reaction_type = 'celebrate' THEN 1 END)::INTEGER AS celebrate_count
      FROM community_messages cm
      LEFT JOIN users u ON u.id = cm.created_by
      LEFT JOIN message_reactions mr ON mr.message_id = cm.id
      WHERE cm.is_deleted = false
      GROUP BY cm.id, u.username, u.is_admin
      ORDER BY cm.is_pinned DESC, cm.created_at DESC
      LIMIT 100`
    );

    // Get user's reactions
    const userReactionsResult = await query(
      `SELECT message_id, reaction_type 
       FROM message_reactions 
       WHERE user_id = $1`,
      [req.user.id]
    );

    const userReactionsMap = {};
    userReactionsResult.rows.forEach(reaction => {
      if (!userReactionsMap[reaction.message_id]) {
        userReactionsMap[reaction.message_id] = [];
      }
      userReactionsMap[reaction.message_id].push(reaction.reaction_type);
    });

    // Attach user reactions to each message
    const messages = messagesResult.rows.map(msg => ({
      ...msg,
      reactions: {
        thumbs_up: msg.thumbs_up_count,
        thumbs_down: msg.thumbs_down_count,
        heart: msg.heart_count,
        fire: msg.fire_count,
        celebrate: msg.celebrate_count
      },
      user_reactions: userReactionsMap[msg.id] || []
    }));

    // Remove raw count fields
    messages.forEach(msg => {
      delete msg.thumbs_up_count;
      delete msg.thumbs_down_count;
      delete msg.heart_count;
      delete msg.fire_count;
      delete msg.celebrate_count;
    });

    res.json({ messages });

  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// ============================================
// POST: React to Message
// ============================================
router.post('/:messageId/react', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { reactionType } = req.body;

    // Validate reaction type
    const validReactions = ['thumbs_up', 'thumbs_down', 'heart', 'fire', 'celebrate'];
    if (!validReactions.includes(reactionType)) {
      return res.status(400).json({ error: 'Invalid reaction type' });
    }

    // Check if message exists
    const messageExists = await query(
      'SELECT id FROM community_messages WHERE id = $1 AND is_deleted = false',
      [messageId]
    );

    if (messageExists.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    // Check if user already reacted with this type
    const existingReaction = await query(
      `SELECT id FROM message_reactions 
       WHERE message_id = $1 AND user_id = $2 AND reaction_type = $3`,
      [messageId, req.user.id, reactionType]
    );

    if (existingReaction.rows.length > 0) {
      // Toggle off (remove reaction)
      await query(
        `DELETE FROM message_reactions 
         WHERE message_id = $1 AND user_id = $2 AND reaction_type = $3`,
        [messageId, req.user.id, reactionType]
      );

      // Get updated reaction counts
      const updatedResult = await query(
        `SELECT 
          COUNT(CASE WHEN reaction_type = 'thumbs_up' THEN 1 END)::INTEGER AS thumbs_up,
          COUNT(CASE WHEN reaction_type = 'thumbs_down' THEN 1 END)::INTEGER AS thumbs_down,
          COUNT(CASE WHEN reaction_type = 'heart' THEN 1 END)::INTEGER AS heart,
          COUNT(CASE WHEN reaction_type = 'fire' THEN 1 END)::INTEGER AS fire,
          COUNT(CASE WHEN reaction_type = 'celebrate' THEN 1 END)::INTEGER AS celebrate
        FROM message_reactions
        WHERE message_id = $1`,
        [messageId]
      );

      // Emit Socket.io event
      if (req.app.get('io')) {
        req.app.get('io').emit('reaction_removed', {
          messageId,
          reactionType,
          reactions: updatedResult.rows[0]
        });
      }

      res.json({
        message: 'Reaction removed',
        action: 'removed',
        reactions: updatedResult.rows[0]
      });

    } else {
      // Add reaction
      await query(
        `INSERT INTO message_reactions (message_id, user_id, reaction_type)
         VALUES ($1, $2, $3)`,
        [messageId, req.user.id, reactionType]
      );

      // Get updated reaction counts
      const updatedResult = await query(
        `SELECT 
          COUNT(CASE WHEN reaction_type = 'thumbs_up' THEN 1 END)::INTEGER AS thumbs_up,
          COUNT(CASE WHEN reaction_type = 'thumbs_down' THEN 1 END)::INTEGER AS thumbs_down,
          COUNT(CASE WHEN reaction_type = 'heart' THEN 1 END)::INTEGER AS heart,
          COUNT(CASE WHEN reaction_type = 'fire' THEN 1 END)::INTEGER AS fire,
          COUNT(CASE WHEN reaction_type = 'celebrate' THEN 1 END)::INTEGER AS celebrate
        FROM message_reactions
        WHERE message_id = $1`,
        [messageId]
      );

      // Emit Socket.io event
      if (req.app.get('io')) {
        req.app.get('io').emit('reaction_added', {
          messageId,
          reactionType,
          reactions: updatedResult.rows[0]
        });
      }

      res.json({
        message: 'Reaction added',
        action: 'added',
        reactions: updatedResult.rows[0]
      });
    }

  } catch (error) {
    console.error('React error:', error);
    res.status(500).json({ error: 'Failed to process reaction' });
  }
});

// ============================================
// ADMIN ONLY: Pin/Unpin Message
// ============================================
router.patch('/:messageId/pin', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { isPinned } = req.body;

    const result = await query(
      `UPDATE community_messages 
       SET is_pinned = $1, updated_at = NOW() 
       WHERE id = $2 
       RETURNING id, message_text, is_pinned`,
      [isPinned, messageId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    await logAdminAction(
      req.user.id,
      isPinned ? 'message_pinned' : 'message_unpinned',
      'message',
      messageId,
      {},
      req
    );

    // Emit Socket.io event
    if (req.app.get('io')) {
      req.app.get('io').emit('message_pinned', result.rows[0]);
    }

    res.json({
      message: `Message ${isPinned ? 'pinned' : 'unpinned'} successfully`,
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Pin message error:', error);
    res.status(500).json({ error: 'Failed to update message' });
  }
});

// ============================================
// ADMIN ONLY: Delete Message
// ============================================
router.delete('/:messageId', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { messageId } = req.params;

    // Soft delete
    const result = await query(
      `UPDATE community_messages 
       SET is_deleted = true, updated_at = NOW() 
       WHERE id = $1 
       RETURNING id, message_text`,
      [messageId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    await logAdminAction(
      req.user.id,
      'message_deleted',
      'message',
      messageId,
      { messagePreview: result.rows[0].message_text.slice(0, 50) },
      req
    );

    res.json({ message: 'Message deleted successfully' });

  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

export default router;