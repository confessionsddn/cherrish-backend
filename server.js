//server.js - COMPLETE WITH ALL ROUTES
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import http from 'http';
import { Server } from 'socket.io';
import rateLimit from 'express-rate-limit';
import passport from './middleware/auth.js';
import webhookRoutes from './routes/webhooks.js';
import { confessionRateLimit } from './middleware/rateLimit.js';
import { trackRegistrationIP, trackActionIP } from './middleware/ipTracking.js';
import giftsRouter from './routes/gifts.js';
import notificationsRouter from './routes/notifications.js';

// Import ALL routes
import authRoutes from './routes/auth.js';
import confessionRoutes from './routes/confessions.js';
import paymentRoutes from './routes/payments.js';
import repliesRouter from './routes/replies.js';
import visibilityRouter from './routes/visibility.js';
import accessRequestRoutes from './routes/access-requests.js';
import adminRoutes from './routes/admin.js';
import adminMessagesRouter from './routes/admin-messages.js';
import pollsRoutes from './routes/polls.js';
import messagesRoutes from './routes/messages.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const server = http.createServer(app);

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

io.on('connection', (socket) => {
  console.log(`✅ Socket connected: ${socket.id}`);
  socket.on('join_user_room', (userId) => {
    socket.join(`user_${userId}`);
  });
  socket.on('disconnect', () => {
    console.log(`❌ Socket disconnected: ${socket.id}`);
  });
});

app.set('io', io);

// Middleware
app.use(helmet());
app.use(cors({
  origin: [
    'https://cherrish.in',
    'https://www.cherrish.in',
    'http://localhost:3000' // Keep for local dev
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}))
app.options('*', cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  skip: (req) => {
    return req.ip === '::1' || req.ip === '127.0.0.1' || req.ip === '::ffff:127.0.0.1';
  }
});
app.use('/api/', limiter);
app.use(passport.initialize());

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    socketio: 'enabled'
  });
});

// ALL API ROUTES
app.use('/api/auth', authRoutes);
app.use('/auth', authRoutes);
app.use('/api/confessions', confessionRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/replies', repliesRouter);
app.use('/api/access-requests', accessRequestRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/visibility', visibilityRouter);
app.use('/api/admin-messages', adminMessagesRouter);
app.use('/api/gifts', giftsRouter);
app.use('/api/polls', pollsRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/notifications', notificationsRouter);


// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'LoveConfess API',
    version: '1.0.0',
    socketio: 'enabled',
    endpoints: {
      auth: '/api/auth',
      confessions: '/api/confessions',
      payments: '/api/payments',
      gifts: '/api/gifts',  // ADD THIS
      adminMessages: '/api/admin-messages',  // ADD THIS
      polls: '/api/polls',
      messages: '/api/messages'
    }
  });
});

// Setup admin (intentionally locked down)
app.get('/setup-first-admin', async (req, res) => {
  try {
    const setupSecret = process.env.ADMIN_SETUP_SECRET;
    const providedSecret = req.query.secret;
    const isDevelopment = process.env.NODE_ENV === 'development';

    if (!isDevelopment && (!setupSecret || providedSecret !== setupSecret)) {
      return res.status(403).json({
        success: false,
        message: 'Admin setup route is disabled'
      });
    }

    const { query } = await import('./config/database.js');
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false`);
    const userCheck = await query(`SELECT * FROM users WHERE email = 'itmconfessionddn@gmail.com'`);
    
    if (userCheck.rows.length === 0) {
      return res.json({
        success: false,
        message: 'You need to create an account first! Login with Google, then come back here.'
      });
    }
    
    await query(`UPDATE users SET is_admin = true WHERE email = 'itmconfessionddn@gmail.com'`);
    const result = await query(`SELECT username, email, is_admin FROM users WHERE email = 'itmconfessionddn@gmail.com'`);
    
    res.json({
      success: true,
      message: '🎉 YOU ARE NOW ADMIN!',
      user: result.rows[0]
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.message
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.url}`
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      error: 'File too large',
      message: 'Audio file must be less than 5MB'
    });
  }
  
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Token expired' });
  }
  
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Cleanup task
setInterval(async () => {
  try {
    const { query } = await import('./config/database.js');
    await query('UPDATE confessions SET is_boosted = false WHERE is_boosted = true AND boost_expires_at < NOW()');
    console.log('✅ Cleaned up expired boosts');
  } catch (error) {
    console.error('❌ Boost cleanup error:', error);
  }
}, 60 * 60 * 1000);

// Start server
server.listen(PORT, () => {
  console.log('');
  console.log('🚀 ═══════════════════════════════════════════');
  console.log('🚀  LOVECONFESS BACKEND SERVER STARTED');
  console.log('🚀 ═══════════════════════════════════════════');
  console.log('');
  console.log(`   📡  Server: http://localhost:${PORT}`);
  console.log(`   🌍  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   🔗  Frontend: ${process.env.FRONTEND_URL}`);
  console.log(`   ⚡  Socket.io: ENABLED`);
  console.log('');
  console.log('   API Endpoints:');
  console.log(`   ├─ Health: http://localhost:${PORT}/health`);
  console.log(`   ├─ Auth: http://localhost:${PORT}/api/auth`);
  console.log(`   ├─ Confessions: http://localhost:${PORT}/api/confessions`);
  console.log(`   ├─ Gifts: http://localhost:${PORT}/api/gifts`);
  console.log(`   ├─ Admin Messages: http://localhost:${PORT}/api/admin-messages`);
  console.log(`   ├─ Polls: http://localhost:${PORT}/api/polls`);
  console.log(`   └─ Messages: http://localhost:${PORT}/api/messages`);
  console.log('');
  console.log('🚀 ═══════════════════════════════════════════');
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    io.close(() => {
      console.log('Socket.io closed');
      process.exit(0);
    });
  });
});

// ============================================
// NOTIFICATION CRON JOBS
// ============================================
import cron from 'node-cron';
import { processNotificationQueue } from './services/oneSignalService.js';

// Process notification queue every 2 minutes
cron.schedule('*/2 * * * *', async () => {
  console.log('⏰ Processing notification queue...');
  try {
    await processNotificationQueue();
  } catch (error) {
    console.error('❌ Cron job error:', error);
  }
});

console.log('✅ Notification cron job started (runs every 2 minutes)');

export default app;
