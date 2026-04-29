'use strict';

require('dotenv').config();

const express = require('express');
const { initializeDb, closeDb } = require('./db/database');
const { initBot } = require('./telegram/bot');

const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON bodies
app.use(express.json());

// Health check endpoint (used by Render)
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// Admin dashboard
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'loopz@admin';
app.get('/admin', (req, res) => {
  const { pass } = req.query;
  if (pass !== ADMIN_PASSWORD) {
    return res.send(`<!DOCTYPE html><html><head><title>Loopz Admin</title>
<style>body{font-family:-apple-system,sans-serif;background:#f5f5f5;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{background:white;padding:40px;border-radius:16px;box-shadow:0 2px 8px rgba(0,0,0,.1);text-align:center}
h2{margin:0 0 24px;color:#1a1a2e}input{padding:10px 14px;border:1px solid #ddd;border-radius:8px;margin-right:8px;font-size:14px;outline:none}
button{padding:10px 20px;background:#4f46e5;color:white;border:none;border-radius:8px;font-size:14px;cursor:pointer}</style>
</head><body><div class="box"><h2>🚗 Loopz Admin</h2>
<form method="GET" action="/admin"><input type="password" name="pass" placeholder="Enter password" autofocus>
<button type="submit">Login</button></form></div></body></html>`);
  }

  const db = require('./db/database').getDb();
  const q = (sql, ...p) => { try { return db.prepare(sql).all(...p); } catch (_) { return []; } };
  const s = (sql, ...p) => { try { return db.prepare(sql).get(...p); } catch (_) { return {}; } };

  const stats = {
    users:            s('SELECT COUNT(*) as c FROM Users WHERE IsVerified = 1').c || 0,
    rides:            s('SELECT COUNT(*) as c FROM Rides').c || 0,
    activeRides:      s("SELECT COUNT(*) as c FROM Rides WHERE Status='active'").c || 0,
    bookings:         s('SELECT COUNT(*) as c FROM Bookings').c || 0,
    activeBookings:   s("SELECT COUNT(*) as c FROM Bookings WHERE Status='confirmed'").c || 0,
    feedback:         s('SELECT COUNT(*) as c FROM Feedback').c || 0,
  };
  const users    = q('SELECT UserID,Name,Phone,VehicleOwner,CreatedAt FROM Users WHERE IsVerified=1 ORDER BY CreatedAt DESC LIMIT 30');
  const feedbacks = q(`SELECT f.*,u.Name AS UserName FROM Feedback f LEFT JOIN Users u ON f.UserID=u.UserID ORDER BY f.CreatedAt DESC LIMIT 60`);

  const statCard = (num, label) =>
    `<div class="card"><div class="num">${num}</div><div class="lbl">${label}</div></div>`;

  const uRows = users.map(u =>
    `<tr><td>#${u.UserID}</td><td>${esc(u.Name||'—')}</td><td>${u.Phone}</td><td>${u.VehicleOwner==='Yes'?'🚗 Yes':'—'}</td><td>${(u.CreatedAt||'').slice(0,10)}</td></tr>`
  ).join('') || '<tr><td colspan="5" class="empty">No users yet</td></tr>';

  const fRows = feedbacks.map(f =>
    `<tr><td>#${f.FeedbackID}</td><td>${esc(f.UserName||'—')}</td><td><span class="badge">${f.Role||'—'}</span></td><td>${f.BookingID?'#'+f.BookingID:'—'}</td><td>${esc(f.Message||'—')}</td><td>${(f.CreatedAt||'').slice(0,10)}</td></tr>`
  ).join('') || '<tr><td colspan="6" class="empty">No feedback yet</td></tr>';

  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  res.send(`<!DOCTYPE html><html><head><title>Loopz Admin</title>
<style>
*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;background:#f0f2f5;color:#333}
.header{background:#4f46e5;color:white;padding:20px 32px;display:flex;align-items:center;gap:12px}
.header h1{margin:0;font-size:22px}.header .sub{font-size:13px;opacity:.8;margin-left:auto}
.container{max-width:1200px;margin:0 auto;padding:28px 24px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px;margin-bottom:32px}
.card{background:white;border-radius:12px;padding:20px 24px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
.num{font-size:38px;font-weight:700;color:#4f46e5}.lbl{font-size:12px;color:#888;margin-top:2px;text-transform:uppercase;letter-spacing:.5px}
h2{font-size:17px;font-weight:600;margin:0 0 12px;color:#1a1a2e}
table{width:100%;border-collapse:collapse;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);margin-bottom:32px}
th{background:#4f46e5;color:white;padding:11px 14px;text-align:left;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.4px}
td{padding:10px 14px;font-size:13px;border-bottom:1px solid #f3f4f6}tr:last-child td{border:none}tr:hover td{background:#fafafa}
.empty{text-align:center;color:#aaa;padding:24px!important}
.badge{background:#e0e7ff;color:#4f46e5;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600}
a{color:#4f46e5;text-decoration:none;font-size:13px}a:hover{text-decoration:underline}
</style></head><body>
<div class="header"><h1>🚗 Loopz Admin</h1><div class="sub"><a href="/admin?pass=${encodeURIComponent(ADMIN_PASSWORD)}" style="color:white">↻ Refresh</a> &nbsp; ${new Date().toLocaleString('en-IN')}</div></div>
<div class="container">
<div class="stats">
${statCard(stats.users,'Registered Users')}
${statCard(stats.rides,'Total Rides')}
${statCard(stats.activeRides,'Active Rides')}
${statCard(stats.bookings,'Total Bookings')}
${statCard(stats.activeBookings,'Active Bookings')}
${statCard(stats.feedback,'Feedback Entries')}
</div>
<h2>Recent Users</h2>
<table><thead><tr><th>ID</th><th>Name</th><th>Phone</th><th>Driver</th><th>Joined</th></tr></thead><tbody>${uRows}</tbody></table>
<h2>Feedback</h2>
<table><thead><tr><th>ID</th><th>User</th><th>Role</th><th>Booking</th><th>Message</th><th>Date</th></tr></thead><tbody>${fRows}</tbody></table>
</div></body></html>`);
});

// 404 handler
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  try {
    initializeDb();

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.error('[Server] TELEGRAM_BOT_TOKEN is not set in .env');
      process.exit(1);
    }

    const bot = await initBot(token);

    if (process.env.TELEGRAM_WEBHOOK_URL) {
      // Production: Telegram pushes updates to our URL
      const webhookPath = `/tg/${token.slice(-10)}`;
      app.use(await bot.createWebhook({ domain: process.env.TELEGRAM_WEBHOOK_URL, path: webhookPath }));
      console.log(`[Server] Telegram webhook: ${process.env.TELEGRAM_WEBHOOK_URL}${webhookPath}`);
      app.listen(PORT, () => console.log(`[Server] Loopz Bot running on port ${PORT} (webhook mode)`));
    } else {
      // Development: bot polls Telegram — no URL setup needed
      await bot.launch();
      console.log('[Server] Loopz Bot running in polling mode 🚀');
      app.listen(PORT, () => console.log(`[Server] Admin dashboard on port ${PORT}`));
    }

    const shutdown = async () => {
      console.log('[Server] Shutting down...');
      bot.stop('SIGTERM');
      closeDb();
      process.exit(0);
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
