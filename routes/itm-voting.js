// routes/itm-voting.js
// ITM Votes League - Voting API routes
// Add to Cherrish backend: app.use('/api/itm-voting', itmVotingRoutes);

import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { query } from '../config/database.js';

const router = express.Router();

// ============================================
// POST /api/itm-voting/vote
// Cast a vote (one per category per day)
// ============================================
router.post('/vote', authenticateToken, async (req, res) => {
  try {
    const { categoryId, teacherId } = req.body;
    const userId = req.user.id;

    if (!categoryId || !teacherId) {
      return res.status(400).json({ success: false, error: 'Missing categoryId or teacherId' });
    }

    // Check if already voted today in this category
    const existing = await query(
      `SELECT id FROM itm_votes 
       WHERE user_id = $1 AND category_id = $2 AND vote_date = CURRENT_DATE`,
      [userId, categoryId]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ 
        success: false, 
        error: 'Already voted today in this category' 
      });
    }

    // Insert vote
    await query(
      `INSERT INTO itm_votes (user_id, category_id, teacher_id) VALUES ($1, $2, $3)`,
      [userId, categoryId, teacherId]
    );

    console.log(`🗳️ ITM Vote: User #${req.user.user_number} voted teacher ${teacherId} in category ${categoryId}`);

    res.json({ success: true, message: 'Vote recorded!' });
  } catch (error) {
    // Handle unique constraint violation (race condition)
    if (error.code === '23505') {
      return res.status(409).json({ 
        success: false, 
        error: 'Already voted today in this category' 
      });
    }
    console.error('ITM Vote error:', error);
    res.status(500).json({ success: false, error: 'Failed to record vote' });
  }
});

// ============================================
// GET /api/itm-voting/results
// Get aggregated vote counts (public)
// ============================================
router.get('/results', async (req, res) => {
  try {
    const result = await query(
      `SELECT category_id, teacher_id, COUNT(*) as vote_count
       FROM itm_votes
       GROUP BY category_id, teacher_id
       ORDER BY category_id, vote_count DESC`
    );

    // Format as { categoryId: { teacherId: count } }
    const results = {};
    for (const row of result.rows) {
      const cat = row.category_id;
      if (!results[cat]) results[cat] = {};
      results[cat][row.teacher_id] = parseInt(row.vote_count);
    }

    res.json(results);
  } catch (error) {
    console.error('ITM Results error:', error);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

// ============================================
// GET /api/itm-voting/my-votes
// Get current user's votes for today
// ============================================
router.get('/my-votes', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await query(
      `SELECT category_id, teacher_id, voted_at
       FROM itm_votes
       WHERE user_id = $1 AND vote_date = CURRENT_DATE
       ORDER BY voted_at DESC`,
      [userId]
    );

    res.json({ votes: result.rows });
  } catch (error) {
    console.error('ITM My Votes error:', error);
    res.status(500).json({ error: 'Failed to fetch your votes' });
  }
});

// ============================================
// GET /api/itm-voting/my-history
// Get all votes by current user (all time)
// ============================================
router.get('/my-history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await query(
      `SELECT category_id, teacher_id, voted_at
       FROM itm_votes
       WHERE user_id = $1
       ORDER BY voted_at DESC
       LIMIT 200`,
      [userId]
    );

    res.json({ votes: result.rows });
  } catch (error) {
    console.error('ITM History error:', error);
    res.status(500).json({ error: 'Failed to fetch vote history' });
  }
});

// ============================================
// GET /api/itm-voting/stats
// Get overall voting statistics (public)
// ============================================
router.get('/stats', async (req, res) => {
  try {
    const totalVotes = await query('SELECT COUNT(*) as total FROM itm_votes');
    const totalVoters = await query('SELECT COUNT(DISTINCT user_id) as total FROM itm_votes');
    const todayVotes = await query(
      'SELECT COUNT(*) as total FROM itm_votes WHERE vote_date = CURRENT_DATE'
    );

    res.json({
      total_votes: parseInt(totalVotes.rows[0].total),
      total_voters: parseInt(totalVoters.rows[0].total),
      today_votes: parseInt(todayVotes.rows[0].total)
    });
  } catch (error) {
    console.error('ITM Stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

export default router;
