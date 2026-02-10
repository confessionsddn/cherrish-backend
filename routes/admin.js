//routes/admin.js - FIXED WITH MESSAGES ROUTE
import express from 'express';
import { query } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import crypto from 'crypto';

const router = express.Router();

// All admin routes require authentication AND admin role
router.use(authenticateToken);
router.use(requireAdmin);

// Dashboard stats
router.get('/stats', async (req, res) => {
  try {
    const pendingRequests = await query(
      "SELECT COUNT(*) as count FROM access_requests WHERE status = 'pending'"
    );
    
    const totalUsers = await query('SELECT COUNT(*) as count FROM users');
    
    const unusedCodes = await query(
      'SELECT COUNT(*) as count FROM access_codes WHERE is_used = false'
    );
    
    const totalConfessions = await query('SELECT COUNT(*) as count FROM confessions');
    
    res.json({
      success: true,
      stats: {
        pendingRequests: parseInt(pendingRequests.rows[0].count),
        totalUsers: parseInt(totalUsers.rows[0].count),
        unusedCodes: parseInt(unusedCodes.rows[0].count),
        totalConfessions: parseInt(totalConfessions.rows[0].count)
      }
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// FIXED: Add conversations route for Messages tab
router.get('/messages/conversations', async (req, res) => {
  try {
    const result = await query(
      `SELECT DISTINCT ON (am.user_id)
        am.user_id,
        u.username,
        u.user_number,
        u.email,
        u.last_activity,
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
    console.error('Get conversations error:', error);
    res.status(500).json({ error: 'Failed to get conversations' });
  }
});

// Activity logs route
router.get('/activity-logs', async (req, res) => {
  try {
    const { limit = 50, user_id } = req.query;
    
    let queryText = `
      SELECT 
        ual.id,
        ual.user_id,
        ual.action_type,
        ual.action_details,
        ual.credits_change,
        ual.created_at,
        u.username,
        u.user_number,
        u.email
      FROM user_activity_log ual
      JOIN users u ON ual.user_id = u.id
    `;
    
    const params = [];
    
    if (user_id) {
      queryText += ` WHERE ual.user_id = $1`;
      params.push(user_id);
    }
    
    queryText += ` ORDER BY ual.created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));
    
    const result = await query(queryText, params);
    
    res.json({
      success: true,
      logs: result.rows
    });
    
  } catch (error) {
    console.error('Get activity logs error:', error);
    res.status(500).json({ error: 'Failed to get activity logs' });
  }
});

// Get pending requests
router.get('/pending-requests', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, email, google_id, instagram_handle, requested_at 
       FROM access_requests 
       WHERE status = 'pending' 
       ORDER BY requested_at ASC`
    );
    
    res.json({
      success: true,
      requests: result.rows
    });
  } catch (error) {
    console.error('Get pending requests error:', error);
    res.status(500).json({ error: 'Failed to get pending requests' });
  }
});

// Approve request
router.post('/approve-request/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const requestResult = await query(
      'SELECT * FROM access_requests WHERE id = $1 AND status = $2',
      [id, 'pending']
    );
    
    if (requestResult.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }
    
    const request = requestResult.rows[0];
    const code = generateAccessCode();
    
    await query('INSERT INTO access_codes (code, is_used) VALUES ($1, false)', [code]);
    
    await query(
      `UPDATE access_requests 
       SET status = $1, generated_code = $2, reviewed_at = NOW(), reviewed_by = $3
       WHERE id = $4`,
      ['approved', code, req.user.email, id]
    );
    
    console.log('✅ Approved:', request.email, 'Code:', code);
    
    res.json({
      success: true,
      message: 'Request approved!',
      code: code,
      email: request.email,
      instagramHandle: request.instagram_handle
    });
  } catch (error) {
    console.error('Approve request error:', error);
    res.status(500).json({ error: 'Failed to approve request' });
  }
});

// Reject request
router.post('/reject-request/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    const result = await query(
      `UPDATE access_requests 
       SET status = $1, admin_notes = $2, reviewed_at = NOW(), reviewed_by = $3
       WHERE id = $4 AND status = 'pending'
       RETURNING email, instagram_handle`,
      ['rejected', reason || 'Not verified', req.user.email, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }
    
    console.log('❌ Rejected:', result.rows[0].email);
    
    res.json({ success: true, message: 'Request rejected' });
  } catch (error) {
    console.error('Reject request error:', error);
    res.status(500).json({ error: 'Failed to reject request' });
  }
});

// Generate codes
router.post('/generate-codes', async (req, res) => {
  try {
    const { count = 10 } = req.body;
    
    if (count < 1 || count > 100) {
      return res.status(400).json({ error: 'Count must be between 1 and 100' });
    }
    
    const codes = [];
    for (let i = 0; i < count; i++) {
      const code = generateAccessCode();
      await query('INSERT INTO access_codes (code, is_used) VALUES ($1, false)', [code]);
      codes.push(code);
    }
    
    console.log(`✅ Generated ${count} codes`);
    
    res.json({
      success: true,
      message: `${count} codes generated`,
      codes: codes
    });
  } catch (error) {
    console.error('Generate codes error:', error);
    res.status(500).json({ error: 'Failed to generate codes' });
  }
});

// Get all codes
router.get('/codes', async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        ac.id,
        ac.code,
        ac.is_used,
        ac.created_at,
        u.username,
        u.user_number,
        u.email
      FROM access_codes ac
      LEFT JOIN users u ON ac.used_by_user_id = u.id
      ORDER BY ac.created_at DESC
      LIMIT 100
    `);
    
    res.json({
      success: true,
      codes: result.rows
    });
  } catch (error) {
    console.error('Get codes error:', error);
    res.status(500).json({ error: 'Failed to get codes' });
  }
});

router.get('/users', async (req, res) => {
  try {
    console.log('📥 Fetching users... Search:', req.query.search);
    
    const { search = '' } = req.query;
    
    let queryText = `
      SELECT 
        u.id, 
        u.username, 
        u.user_number, 
        u.email, 
        u.credits, 
        u.is_premium, 
        u.is_banned, 
        u.is_admin, 
        u.ban_until,
        u.created_at, 
        u.last_login,
        u.last_activity
      FROM users u
      WHERE 1=1
    `;
    
    const params = [];
    
    if (search && search.trim() !== '') {
      queryText += ` AND (
        u.username ILIKE $1 OR 
        u.email ILIKE $1 OR 
        u.user_number::text = $1
      )`;
      params.push(`%${search}%`);
    }
    
    queryText += ` ORDER BY u.created_at DESC LIMIT 100`;
    
    console.log('📝 Query:', queryText);
    console.log('📝 Search term:', search);
    
    const result = await query(queryText, params);
    
    console.log(`✅ Found ${result.rows.length} users`);
    
    // Get Instagram handles
    const emails = result.rows.map(u => u.email);
    let instagramData = {};
    
    if (emails.length > 0) {
      try {
        const igResult = await query(
          `SELECT DISTINCT ON (email) email, instagram_handle 
           FROM access_requests 
           WHERE status = 'approved' AND email = ANY($1)`,
          [emails]
        );
        
        igResult.rows.forEach(row => {
          instagramData[row.email] = row.instagram_handle;
        });
      } catch (err) {
        console.log('⚠️ Instagram fetch error:', err.message);
      }
    }
    
    // Get confession counts
    const userIds = result.rows.map(u => u.id);
    let confessionCounts = {};
    
    if (userIds.length > 0) {
      try {
        const confResult = await query(
          `SELECT user_id, COUNT(*) as count 
           FROM confessions 
           WHERE user_id = ANY($1)
           GROUP BY user_id`,
          [userIds]
        );
        
        confResult.rows.forEach(row => {
          confessionCounts[row.user_id] = parseInt(row.count);
        });
      } catch (err) {
        console.log('⚠️ Confessions fetch error:', err.message);
      }
    }
    
    // Get reactions GIVEN by users
    let reactionCounts = {};
    
    if (userIds.length > 0) {
      try {
        const reactResult = await query(
          `SELECT user_id, COUNT(*) as count 
           FROM reactions 
           WHERE user_id = ANY($1)
           GROUP BY user_id`,
          [userIds]
        );
        
        reactResult.rows.forEach(row => {
          reactionCounts[row.user_id] = parseInt(row.count);
        });
      } catch (err) {
        console.log('⚠️ Reactions fetch error (table might not exist):', err.message);
      }
    }
    
    // Combine data
    const enrichedUsers = result.rows.map(user => ({
      ...user,
      instagram_handle: instagramData[user.email] || null,
      total_confessions: confessionCounts[user.id] || 0,
      total_reactions_received: 0,
      total_reactions_given: reactionCounts[user.id] || 0
    }));
    
    res.json({
      success: true,
      users: enrichedUsers,
      total: enrichedUsers.length
    });
    
  } catch (error) {
    console.error('❌ Get users error:', error);
    res.status(500).json({ error: 'Failed to get users', details: error.message });
  }
});

// Ban user
router.post('/users/:id/ban', async (req, res) => {
  try {
    const { id } = req.params;
    const { banned, duration } = req.body;
    
    let banUntil = null;
    
    if (banned && duration !== 'permanent') {
      const days = parseInt(duration);
      banUntil = new Date();
      banUntil.setDate(banUntil.getDate() + days);
      
      console.log('🚫 Banning user for', days, 'days until:', banUntil);
    }
    
    const result = await query(
      'UPDATE users SET is_banned = $1, ban_until = $2 WHERE id = $3 RETURNING username, email',
      [banned, banUntil, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      success: true,
      message: banned ? `User banned` : 'User unbanned'
    });
  } catch (error) {
    console.error('Ban user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Get pending confessions for moderation
router.get('/confessions/pending', async (req, res) => {
  try {
    const result = await query(
      `SELECT 
        c.*,
        u.username,
        u.user_number,
        u.email
       FROM confessions c
       JOIN users u ON c.user_id = u.id
       WHERE c.status = 'pending'
       ORDER BY c.created_at ASC`
    );
    
    res.json({
      success: true,
      confessions: result.rows
    });
  } catch (error) {
    console.error('Get pending confessions error:', error);
    res.status(500).json({ error: 'Failed to get pending confessions' });
  }
});

// Approve confession
router.post('/confessions/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    
    await query(
      `UPDATE confessions 
       SET status = 'approved', reviewed_by = $1, reviewed_at = NOW()
       WHERE id = $2`,
      [req.user.email, id]
    );
    
    console.log('✅ Confession approved:', id);
    
    res.json({
      success: true,
      message: 'Confession approved and published!'
    });
  } catch (error) {
    console.error('Approve confession error:', error);
    res.status(500).json({ error: 'Failed to approve confession' });
  }
});

// Reject confession
router.post('/confessions/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    // Get confession to refund user
    const confResult = await query('SELECT user_id FROM confessions WHERE id = $1', [id]);
    
    if (confResult.rows.length > 0) {
      // Refund 5 credits
      await query('UPDATE users SET credits = credits + 5 WHERE id = $1', [confResult.rows[0].user_id]);
    }
    
    await query(
      `UPDATE confessions 
       SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), rejection_reason = $2
       WHERE id = $3`,
      [req.user.email, reason || 'Inappropriate content', id]
    );
    
    console.log('❌ Confession rejected:', id);
    
    res.json({
      success: true,
      message: 'Confession rejected. User refunded 5 credits.'
    });
  } catch (error) {
    console.error('Reject confession error:', error);
    res.status(500).json({ error: 'Failed to reject confession' });
  }
});

// ADMIN DELETE CONFESSION (NEW)
router.delete('/confessions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    await query('DELETE FROM confessions WHERE id = $1', [id]);
    
    console.log('🗑️ Admin deleted confession:', id);
    
    res.json({
      success: true,
      message: 'Confession deleted by admin'
    });
  } catch (error) {
    console.error('Admin delete confession error:', error);
    res.status(500).json({ error: 'Failed to delete confession' });
  }
});

// Get reported confessions
router.get('/reports', async (req, res) => {
  try {
    const result = await query(
      `SELECT 
        cr.*,
        c.content as confession_content,
        c.mood_zone,
        c.id as confession_id,
        u.username as reporter_username,
        u.email as reporter_email
       FROM confession_reports cr
       JOIN confessions c ON cr.confession_id = c.id
       JOIN users u ON cr.reported_by = u.id
       WHERE cr.status = 'pending'
       ORDER BY cr.created_at DESC`
    );
    
    res.json({
      success: true,
      reports: result.rows
    });
  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({ error: 'Failed to get reports' });
  }
});

// Resolve report
router.post('/reports/:id/resolve', async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body; // 'dismiss' or 'remove_confession'
    
    if (action === 'remove_confession') {
      const reportResult = await query('SELECT confession_id FROM confession_reports WHERE id = $1', [id]);
      
      if (reportResult.rows.length > 0) {
        await query('DELETE FROM confessions WHERE id = $1', [reportResult.rows[0].confession_id]);
      }
    }
    
    await query(
      `UPDATE confession_reports 
       SET status = 'resolved', reviewed_by = $1, reviewed_at = NOW()
       WHERE id = $2`,
      [req.user.email, id]
    );
    
    res.json({
      success: true,
      message: action === 'remove_confession' ? 'Confession removed!' : 'Report dismissed'
    });
  } catch (error) {
    console.error('Resolve report error:', error);
    res.status(500).json({ error: 'Failed to resolve report' });
  }
});

// Get user stats
router.get('/users/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;
    
    const reactionsGiven = await query(
      'SELECT COUNT(*) as count FROM reactions WHERE user_id = $1',
      [id]
    );
    
    const recentConfessions = await query(
      `SELECT content, 
        (heart_count + like_count + cry_count + laugh_count) as total_reactions,
        created_at
       FROM confessions 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 5`,
      [id]
    );
    
    res.json({
      success: true,
      stats: {
        reactions_given: parseInt(reactionsGiven.rows[0].count),
        recent_confessions: recentConfessions.rows
      }
    });
  } catch (error) {
    console.error('Get user stats error:', error);
    res.status(500).json({ error: 'Failed to get user stats' });
  }
});

// Helper
function generateAccessCode() {
  const prefix = 'LOVE';
  const year = new Date().getFullYear();
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}${year}-${random}`;
}

export default router;