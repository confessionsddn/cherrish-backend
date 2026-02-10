// ============================================
// LOVECONFESS - POLLS ROUTES (ES6 VERSION)
// File: backend/routes/polls.js
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
// ADMIN ONLY: Create Poll
// ============================================
router.post('/create', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { question, options, allowMultipleAnswers, expiresAt, isPinned } = req.body;

    // Validation
    if (!question || !question.trim()) {
      return res.status(400).json({ error: 'Question is required' });
    }

    if (!options || !Array.isArray(options) || options.length < 2 || options.length > 12) {
      return res.status(400).json({ error: 'Must provide 2-12 options' });
    }

    // Sanitize inputs (XSS protection)
    const sanitizedQuestion = question.trim().slice(0, 500);
    const sanitizedOptions = options.map(opt => opt.trim().slice(0, 200)).filter(opt => opt.length > 0);

    if (sanitizedOptions.length < 2) {
      return res.status(400).json({ error: 'At least 2 valid options required' });
    }

    // Create poll
    const pollResult = await query(
      `INSERT INTO polls (created_by, question, allow_multiple_answers, expires_at, is_pinned)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, question, allow_multiple_answers, is_pinned, expires_at, created_at`,
      [req.user.id, sanitizedQuestion, allowMultipleAnswers || false, expiresAt || null, isPinned || false]
    );

    const poll = pollResult.rows[0];

    // Create options
    const optionPromises = sanitizedOptions.map((optionText, index) =>
      query(
        `INSERT INTO poll_options (poll_id, option_text, display_order)
         VALUES ($1, $2, $3)
         RETURNING id, option_text, display_order, vote_count`,
        [poll.id, optionText, index]
      )
    );

    const optionResults = await Promise.all(optionPromises);
    poll.options = optionResults.map(r => r.rows[0]);
    poll.total_votes = 0;

    // Log admin action
    await logAdminAction(
      req.user.id,
      'poll_created',
      'poll',
      poll.id,
      { question: sanitizedQuestion, optionCount: sanitizedOptions.length },
      req
    );

    // Emit Socket.io event (if io is available)
    if (req.app.get('io')) {
      req.app.get('io').emit('poll_created', poll);
    }

    res.status(201).json({
      message: 'Poll created successfully',
      poll
    });

  } catch (error) {
    console.error('Create poll error:', error);
    res.status(500).json({ error: 'Failed to create poll' });
  }
});

// ============================================
// GET: All Polls (with user's votes)
// ============================================
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { includeExpired } = req.query;

    let queryText = `
      SELECT 
        p.id,
        p.question,
        p.allow_multiple_answers,
        p.is_pinned,
        p.is_active,
        p.expires_at,
        p.total_votes,
        p.created_at,
        u.username AS created_by_username,
        u.is_admin AS created_by_is_admin,
        COALESCE(
          json_agg(
            json_build_object(
              'id', po.id,
              'option_text', po.option_text,
              'vote_count', po.vote_count,
              'display_order', po.display_order
            ) ORDER BY po.display_order
          ) FILTER (WHERE po.id IS NOT NULL),
          '[]'
        ) AS options
      FROM polls p
      LEFT JOIN users u ON u.id = p.created_by
      LEFT JOIN poll_options po ON po.poll_id = p.id
      WHERE p.is_active = true
    `;

    if (!includeExpired) {
      queryText += ' AND (p.expires_at IS NULL OR p.expires_at > NOW())';
    }

    queryText += ' GROUP BY p.id, u.username, u.is_admin ORDER BY p.is_pinned DESC, p.created_at DESC';

    const pollsResult = await query(queryText);

    // Get user's votes
    const votesResult = await query(
      `SELECT poll_id, option_id FROM poll_votes WHERE user_id = $1`,
      [req.user.id]
    );

    const userVotes = {};
    votesResult.rows.forEach(vote => {
      if (!userVotes[vote.poll_id]) {
        userVotes[vote.poll_id] = [];
      }
      userVotes[vote.poll_id].push(vote.option_id);
    });

    // Attach user votes to each poll
    const polls = pollsResult.rows.map(poll => ({
      ...poll,
      user_voted_options: userVotes[poll.id] || []
    }));

    res.json({ polls });

  } catch (error) {
    console.error('Get polls error:', error);
    res.status(500).json({ error: 'Failed to fetch polls' });
  }
});

// ============================================
// POST: Vote on Poll
// ============================================
router.post('/:pollId/vote', authenticateToken, async (req, res) => {
  try {
    const { pollId } = req.params;
    const { optionId } = req.body;

    if (!optionId) {
      return res.status(400).json({ error: 'Option ID required' });
    }

    // Get poll details
    const pollResult = await query(
      `SELECT id, allow_multiple_answers, is_active, expires_at FROM polls WHERE id = $1`,
      [pollId]
    );

    if (pollResult.rows.length === 0) {
      return res.status(404).json({ error: 'Poll not found' });
    }

    const poll = pollResult.rows[0];

    if (!poll.is_active) {
      return res.status(400).json({ error: 'Poll is closed' });
    }

    if (poll.expires_at && new Date(poll.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Poll has expired' });
    }

    // Verify option belongs to poll
    const optionResult = await query(
      `SELECT id FROM poll_options WHERE id = $1 AND poll_id = $2`,
      [optionId, pollId]
    );

    if (optionResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid option for this poll' });
    }

    // Check if user already voted
    if (!poll.allow_multiple_answers) {
      const existingVote = await query(
        `SELECT id FROM poll_votes WHERE poll_id = $1 AND user_id = $2`,
        [pollId, req.user.id]
      );

      if (existingVote.rows.length > 0) {
        return res.status(400).json({ error: 'You have already voted on this poll' });
      }
    } else {
      // Check if user voted for THIS specific option
      const existingOptionVote = await query(
        `SELECT id FROM poll_votes WHERE poll_id = $1 AND user_id = $2 AND option_id = $3`,
        [pollId, req.user.id, optionId]
      );

      if (existingOptionVote.rows.length > 0) {
        return res.status(400).json({ error: 'You have already voted for this option' });
      }
    }

    // Cast vote
    await query(
      `INSERT INTO poll_votes (poll_id, option_id, user_id) VALUES ($1, $2, $3)`,
      [pollId, optionId, req.user.id]
    );

    // Get updated poll results
    const updatedPollResult = await query(
      `SELECT 
        p.id,
        p.question,
        p.total_votes,
        COALESCE(
          json_agg(
            json_build_object(
              'id', po.id,
              'option_text', po.option_text,
              'vote_count', po.vote_count,
              'percentage', CASE 
                WHEN p.total_votes > 0 THEN ROUND((po.vote_count::DECIMAL / p.total_votes) * 100, 2)
                ELSE 0 
              END
            ) ORDER BY po.display_order
          ) FILTER (WHERE po.id IS NOT NULL),
          '[]'
        ) AS options
      FROM polls p
      LEFT JOIN poll_options po ON po.poll_id = p.id
      WHERE p.id = $1
      GROUP BY p.id`,
      [pollId]
    );

    const updatedPoll = updatedPollResult.rows[0];

    // Emit Socket.io event
    if (req.app.get('io')) {
      req.app.get('io').emit('vote_cast', { pollId, updatedPoll });
    }

    res.json({
      message: 'Vote recorded successfully',
      poll: updatedPoll
    });

  } catch (error) {
    console.error('Vote error:', error);
    res.status(500).json({ error: 'Failed to record vote' });
  }
});

// ============================================
// DELETE: Remove Vote
// ============================================
router.delete('/:pollId/vote/:optionId', authenticateToken, async (req, res) => {
  try {
    const { pollId, optionId } = req.params;

    const deleteResult = await query(
      `DELETE FROM poll_votes 
       WHERE poll_id = $1 AND option_id = $2 AND user_id = $3
       RETURNING id`,
      [pollId, optionId, req.user.id]
    );

    if (deleteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Vote not found' });
    }

    // Get updated results
    const updatedPollResult = await query(
      `SELECT 
        p.id,
        p.total_votes,
        COALESCE(
          json_agg(
            json_build_object(
              'id', po.id,
              'vote_count', po.vote_count
            )
          ) FILTER (WHERE po.id IS NOT NULL),
          '[]'
        ) AS options
      FROM polls p
      LEFT JOIN poll_options po ON po.poll_id = p.id
      WHERE p.id = $1
      GROUP BY p.id`,
      [pollId]
    );

    // Emit Socket.io event
    if (req.app.get('io')) {
      req.app.get('io').emit('vote_removed', { 
        pollId, 
        updatedPoll: updatedPollResult.rows[0] 
      });
    }

    res.json({ 
      message: 'Vote removed successfully',
      poll: updatedPollResult.rows[0]
    });

  } catch (error) {
    console.error('Remove vote error:', error);
    res.status(500).json({ error: 'Failed to remove vote' });
  }
});

// ============================================
// ADMIN ONLY: Pin/Unpin Poll
// ============================================
router.patch('/:pollId/pin', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { pollId } = req.params;
    const { isPinned } = req.body;

    const result = await query(
      `UPDATE polls SET is_pinned = $1, updated_at = NOW() 
       WHERE id = $2 
       RETURNING id, question, is_pinned`,
      [isPinned, pollId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Poll not found' });
    }

    await logAdminAction(
      req.user.id,
      isPinned ? 'poll_pinned' : 'poll_unpinned',
      'poll',
      pollId,
      {},
      req
    );

    // Emit Socket.io event
    if (req.app.get('io')) {
      req.app.get('io').emit('poll_pinned', result.rows[0]);
    }

    res.json({
      message: `Poll ${isPinned ? 'pinned' : 'unpinned'} successfully`,
      poll: result.rows[0]
    });

  } catch (error) {
    console.error('Pin poll error:', error);
    res.status(500).json({ error: 'Failed to update poll' });
  }
});

// ============================================
// ADMIN ONLY: Delete Poll
// ============================================
router.delete('/:pollId', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { pollId } = req.params;

    // Soft delete (set is_active to false)
    const result = await query(
      `UPDATE polls SET is_active = false, updated_at = NOW() 
       WHERE id = $1 
       RETURNING id, question`,
      [pollId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Poll not found' });
    }

    await logAdminAction(
      req.user.id,
      'poll_deleted',
      'poll',
      pollId,
      { question: result.rows[0].question },
      req
    );

    res.json({ message: 'Poll deleted successfully' });

  } catch (error) {
    console.error('Delete poll error:', error);
    res.status(500).json({ error: 'Failed to delete poll' });
  }
});

// ============================================
// ADMIN ONLY: Get Analytics
// ============================================
router.get('/:pollId/analytics', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { pollId } = req.params;

    const result = await query(
      `SELECT 
        p.id,
        p.question,
        p.total_votes,
        p.created_at,
        COALESCE(
          json_agg(
            json_build_object(
              'id', po.id,
              'option_text', po.option_text,
              'vote_count', po.vote_count,
              'percentage', CASE 
                WHEN p.total_votes > 0 THEN ROUND((po.vote_count::DECIMAL / p.total_votes) * 100, 2)
                ELSE 0 
              END
            ) ORDER BY po.vote_count DESC
          ) FILTER (WHERE po.id IS NOT NULL),
          '[]'
        ) AS options
      FROM polls p
      LEFT JOIN poll_options po ON po.poll_id = p.id
      WHERE p.id = $1
      GROUP BY p.id`,
      [pollId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Poll not found' });
    }

    // Get vote timeline (votes over time)
    const timelineResult = await query(
      `SELECT 
        DATE_TRUNC('hour', created_at) AS hour,
        COUNT(*) AS vote_count
      FROM poll_votes
      WHERE poll_id = $1
      GROUP BY hour
      ORDER BY hour ASC`,
      [pollId]
    );

    res.json({
      poll: result.rows[0],
      timeline: timelineResult.rows
    });

  } catch (error) {
    console.error('Get analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

export default router;