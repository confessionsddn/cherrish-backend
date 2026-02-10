import express from 'express';
import { query } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import crypto from 'crypto';

const router = express.Router();

// Request access code with Instagram handle
router.post('/request', async (req, res) => {
  try {
    const { email, googleId, instagramHandle } = req.body;
    
    if (!email || !googleId || !instagramHandle) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    // Validate Instagram handle format
    const cleanHandle = instagramHandle.trim().replace('@', '');
    if (cleanHandle.length < 3 || cleanHandle.length > 30) {
      return res.status(400).json({ error: 'Invalid Instagram handle' });
    }
    
    // Check if email already requested
    const existingEmail = await query(
      'SELECT * FROM access_requests WHERE email = $1',
      [email]
    );
    
    if (existingEmail.rows.length > 0) {
      const request = existingEmail.rows[0];
      return res.json({
        success: true,
        status: request.status,
        message: request.status === 'pending' 
          ? 'Your request is being reviewed. Check your Instagram DMs!'
          : request.status === 'approved'
          ? 'Your request was approved! Use the code sent to your Instagram.'
          : 'Your request was rejected. Contact admin for details.',
        generatedCode: request.generated_code,
        requestedAt: request.requested_at
      });
    }
    
    // Check if Instagram handle already used
    const existingHandle = await query(
      'SELECT * FROM access_requests WHERE instagram_handle = $1',
      [cleanHandle]
    );
    
    if (existingHandle.rows.length > 0) {
      return res.status(400).json({ 
        error: 'This Instagram handle is already registered. Contact admin if this is a mistake.' 
      });
    }
    
    // Create access request
    const newRequest = await query(
      `INSERT INTO access_requests (email, google_id, instagram_handle, status)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, instagram_handle, status, requested_at`,
      [email, googleId, cleanHandle, 'pending']
    );
    
    console.log('📥 New access request:', email, '@' + cleanHandle);
    
    res.status(201).json({
      success: true,
      status: 'pending',
      message: 'Request submitted! Check your Instagram DMs for verification.',
      request: newRequest.rows[0]
    });
    
  } catch (error) {
    console.error('Request access error:', error);
    res.status(500).json({ error: 'Failed to submit request' });
  }
});

// Check request status
router.get('/status/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    const result = await query(
      'SELECT id, email, instagram_handle, status, generated_code, requested_at, reviewed_at FROM access_requests WHERE email = $1',
      [email]
    );
    
    if (result.rows.length === 0) {
      return res.json({ 
        success: true, 
        status: 'none',
        message: 'No request found' 
      });
    }
    
    const request = result.rows[0];
    
    res.json({
      success: true,
      status: request.status,
      instagramHandle: request.instagram_handle,
      generatedCode: request.status === 'approved' ? request.generated_code : null,
      requestedAt: request.requested_at,
      reviewedAt: request.reviewed_at,
      message: request.status === 'pending'
        ? 'Your request is being reviewed'
        : request.status === 'approved'
        ? 'Approved! Use the code below'
        : 'Request was rejected'
    });
    
  } catch (error) {
    console.error('Check status error:', error);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

// Admin: Get all pending requests (requires auth)
router.get('/admin/pending', authenticateToken, async (req, res) => {
  try {
    // TODO: Add admin role check
    // For now, any authenticated user can see (you'll add admin check in Phase 2)
    
    const result = await query(
      `SELECT id, email, google_id, instagram_handle, status, requested_at 
       FROM access_requests 
       WHERE status = 'pending' 
       ORDER BY requested_at DESC`
    );
    
    res.json({
      success: true,
      requests: result.rows
    });
    
  } catch (error) {
    console.error('Get pending requests error:', error);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

// Admin: Approve request and generate code
router.post('/admin/approve/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // TODO: Add admin role check
    
    // Get request
    const requestResult = await query(
      'SELECT * FROM access_requests WHERE id = $1',
      [id]
    );
    
    if (requestResult.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }
    
    const request = requestResult.rows[0];
    
    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Request already reviewed' });
    }
    
    // Generate access code
    const code = generateAccessCode();
    
    // Save code to access_codes table
    await query(
      'INSERT INTO access_codes (code, is_used) VALUES ($1, false)',
      [code]
    );
    
    // Update request
    await query(
      `UPDATE access_requests 
       SET status = $1, generated_code = $2, reviewed_at = NOW(), reviewed_by = $3
       WHERE id = $4`,
      ['approved', code, req.user.email, id]
    );
    
    console.log('✅ Request approved:', request.email, 'Code:', code);
    
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

// Admin: Reject request
router.post('/admin/reject/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    // TODO: Add admin role check
    
    // Update request
    const result = await query(
      `UPDATE access_requests 
       SET status = $1, admin_notes = $2, reviewed_at = NOW(), reviewed_by = $3
       WHERE id = $4 AND status = 'pending'
       RETURNING email, instagram_handle`,
      ['rejected', reason || 'Not verified', req.user.email, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found or already reviewed' });
    }
    
    console.log('❌ Request rejected:', result.rows[0].email);
    
    res.json({
      success: true,
      message: 'Request rejected'
    });
    
  } catch (error) {
    console.error('Reject request error:', error);
    res.status(500).json({ error: 'Failed to reject request' });
  }
});

// Helper: Generate random access code
function generateAccessCode() {
  const prefix = 'LOVE';
  const year = new Date().getFullYear();
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}${year}-${random}`;
}

export default router;