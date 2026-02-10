// ============================================
// LOVECONFESS - SOCKET.IO SETUP
// File: backend/config/socket.js
// ============================================

const socketIO = require('socket.io');

const setupSocket = (server) => {
  const io = socketIO(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
  });

  // Connection event
  io.on('connection', (socket) => {
    console.log(`✅ User connected: ${socket.id}`);

    // Join user-specific room (optional, for targeted messages)
    socket.on('join_user_room', (userId) => {
      socket.join(`user_${userId}`);
      console.log(`User ${userId} joined their room`);
    });

    // Disconnect event
    socket.on('disconnect', () => {
      console.log(`❌ User disconnected: ${socket.id}`);
    });

    // Error handling
    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
  });

  // Global event emitters (used by routes)
  // Example: req.app.get('io').emit('poll_created', pollData)

  return io;
};

module.exports = setupSocket;   