'use strict';

require('dotenv').config();

const express = require('express');
const { initializeDb, closeDb } = require('./db/database');
const webhookRouter = require('./webhook');

const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON bodies
app.use(express.json());

// Health check endpoint (used by Render)
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// WhatsApp webhook
app.use('/webhook', webhookRouter);

// 404 handler
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  try {
    // Initialize database — must complete before accepting connections
    initializeDb();

    const server = app.listen(PORT, () => {
      console.log(`[Server] ICICI RideShare Bot running on port ${PORT}`);
      console.log(`[Server] Webhook URL: http://localhost:${PORT}/webhook`);
    });

    // Graceful shutdown
    const shutdown = () => {
      console.log('[Server] Shutting down...');
      server.close(() => {
        closeDb();
        process.exit(0);
      });
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (err) {
    console.error('[Server] Failed to start:', err);
    process.exit(1);
  }
}

process.on('uncaughtException', (err) => console.error('[Server] Uncaught exception:', err));
process.on('unhandledRejection', (reason) => console.error('[Server] Unhandled rejection:', reason));

start();
