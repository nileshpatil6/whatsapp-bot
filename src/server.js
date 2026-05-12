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

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function adminHeader(pass, title, backLink = '') {
  return `<!DOCTYPE html><html><head><title>Loopz Admin - ${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;background:#f0f2f5;color:#333}
.header{background:#4f46e5;color:white;padding:16px 24px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.header h1{margin:0;font-size:20px;flex:1}.header a{color:white;text-decoration:none;font-size:13px;opacity:.85}
.header a:hover{opacity:1}.container{max-width:1300px;margin:0 auto;padding:24px 20px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:28px}
.card{background:white;border-radius:12px;padding:18px 20px;box-shadow:0 1px 4px rgba(0,0,0,.08);cursor:pointer;transition:box-shadow .15s,transform .1s;text-decoration:none;display:block;color:inherit}
.card:hover{box-shadow:0 4px 16px rgba(79,70,229,.2);transform:translateY(-2px)}
.num{font-size:34px;font-weight:700;color:#4f46e5}.lbl{font-size:11px;color:#888;margin-top:4px;text-transform:uppercase;letter-spacing:.5px}
h2{font-size:16px;font-weight:600;margin:0 0 12px;color:#1a1a2e;display:flex;align-items:center;gap:8px}
table{width:100%;border-collapse:collapse;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);margin-bottom:28px;font-size:13px}
th{background:#4f46e5;color:white;padding:10px 14px;text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.4px}
td{padding:9px 14px;border-bottom:1px solid #f3f4f6;vertical-align:top}tr:last-child td{border:none}tr:hover td{background:#fafafa}
.empty{text-align:center;color:#aaa;padding:24px!important}
.badge{padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600}
.badge-blue{background:#e0e7ff;color:#4f46e5}.badge-green{background:#d1fae5;color:#065f46}
.badge-red{background:#fee2e2;color:#991b1b}.badge-yellow{background:#fef3c7;color:#92400e}
a.lnk{color:#4f46e5;text-decoration:none}a.lnk:hover{text-decoration:underline}
.back{display:inline-flex;align-items:center;gap:6px;color:#4f46e5;text-decoration:none;font-size:13px;margin-bottom:16px;font-weight:500}
.back:hover{text-decoration:underline}
</style></head><body>
<div class="header">
  <h1>🚗 Loopz Admin${title !== 'Dashboard' ? ' — ' + title : ''}</h1>
  <a href="/admin?pass=${encodeURIComponent(pass)}">Dashboard</a>
  <span style="opacity:.4">|</span>
  <a href="/admin?pass=${encodeURIComponent(pass)}">${new Date().toLocaleString('en-IN')}</a>
</div>
<div class="container">
${backLink ? `<a class="back" href="${backLink}">← Back to Dashboard</a>` : ''}`;
}

function adminCheck(req, res) {
  const pass = req.query.pass || '';
  if (pass !== ADMIN_PASSWORD) {
    res.send(`<!DOCTYPE html><html><head><title>Loopz Admin</title>
<style>body{font-family:-apple-system,sans-serif;background:#f5f5f5;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{background:white;padding:40px;border-radius:16px;box-shadow:0 2px 8px rgba(0,0,0,.1);text-align:center}
h2{margin:0 0 24px;color:#1a1a2e}input{padding:10px 14px;border:1px solid #ddd;border-radius:8px;margin-right:8px;font-size:14px;outline:none}
button{padding:10px 20px;background:#4f46e5;color:white;border:none;border-radius:8px;font-size:14px;cursor:pointer}</style>
</head><body><div class="box"><h2>🚗 Loopz Admin</h2>
<form method="GET" action="/admin"><input type="password" name="pass" placeholder="Enter password" autofocus>
<button type="submit">Login</button></form></div></body></html>`);
    return null;
  }
  return pass;
}

app.get('/admin', (req, res) => {
  const pass = adminCheck(req, res);
  if (!pass) return;

  const db = require('./db/database').getDb();
  const s = (sql, ...p) => { try { return db.prepare(sql).get(...p); } catch (_) { return {}; } };

  const stats = {
    riders:         s("SELECT COUNT(*) as c FROM Users WHERE IsVerified=1 AND VehicleOwner='Yes'").c || 0,
    commuters:      s("SELECT COUNT(*) as c FROM Users WHERE IsVerified=1 AND VehicleOwner='No'").c || 0,
    rides:          s('SELECT COUNT(*) as c FROM Rides').c || 0,
    activeRides:    s("SELECT COUNT(*) as c FROM Rides WHERE Status='active'").c || 0,
    bookings:       s('SELECT COUNT(*) as c FROM Bookings').c || 0,
    activeBookings: s("SELECT COUNT(*) as c FROM Bookings WHERE Status='confirmed'").c || 0,
    feedback:       s('SELECT COUNT(*) as c FROM Feedback').c || 0,
  };

  const p = encodeURIComponent(pass);
  const card = (num, label, href) =>
    `<a class="card" href="${href}"><div class="num">${num}</div><div class="lbl">${label}</div></a>`;

  res.send(adminHeader(pass, 'Dashboard') + `
<div class="stats">
  ${card(stats.riders,      '🚗 Riders',          `/admin/users?pass=${p}&role=rider`)}
  ${card(stats.commuters,   '👤 Commuters',        `/admin/users?pass=${p}&role=commuter`)}
  ${card(stats.rides,       'Total Rides',         `/admin/rides?pass=${p}`)}
  ${card(stats.activeRides, 'Active Rides',        `/admin/rides?pass=${p}&status=active`)}
  ${card(stats.bookings,    'Total Bookings',      `/admin/bookings?pass=${p}`)}
  ${card(stats.activeBookings,'Active Bookings',   `/admin/bookings?pass=${p}&status=confirmed`)}
  ${card(stats.feedback,    'Feedback',            `/admin/feedback?pass=${p}`)}
</div>
</div></body></html>`);
});

app.get('/admin/users', (req, res) => {
  const pass = adminCheck(req, res);
  if (!pass) return;
  const db = require('./db/database').getDb();
  const role = req.query.role;
  const where = role === 'rider' ? "WHERE IsVerified=1 AND VehicleOwner='Yes'" :
                role === 'commuter' ? "WHERE IsVerified=1 AND VehicleOwner='No'" :
                'WHERE IsVerified=1';
  const users = db.prepare(`SELECT * FROM Users ${where} ORDER BY CreatedAt DESC`).all();
  const rows = users.map(u => `<tr>
    <td>#${u.UserID}</td>
    <td>${esc(u.Name)}</td>
    <td>${esc(u.ContactPhone||'—')}</td>
    <td>${esc(u.Gender||'—')}</td>
    <td>${u.VehicleOwner==='Yes'?`<span class="badge badge-blue">Driver</span>`:'—'}</td>
    <td>${esc(u.VehicleType||'—')} ${esc(u.VehicleNumber||'')}</td>
    <td>${u.Rating||5.0}</td>
    <td>₹${u.TotalEarnings||0}</td>
    <td>${(u.CreatedAt||'').slice(0,10)}</td>
  </tr>`).join('') || '<tr><td colspan="9" class="empty">No users</td></tr>';
  const uTitle = role === 'rider' ? '🚗 Riders' : role === 'commuter' ? '👤 Commuters' : '👥 All Users';
  res.send(adminHeader(pass, uTitle, `/admin?pass=${encodeURIComponent(pass)}`) + `
<h2>${uTitle} (${users.length})</h2>
<table><thead><tr><th>ID</th><th>Name</th><th>Phone</th><th>Gender</th><th>Role</th><th>Vehicle</th><th>Rating</th><th>Earnings</th><th>Joined</th></tr></thead>
<tbody>${rows}</tbody></table></div></body></html>`);
});

app.get('/admin/rides', (req, res) => {
  const pass = adminCheck(req, res);
  if (!pass) return;
  const db = require('./db/database').getDb();
  const where = req.query.status ? `WHERE r.Status='${req.query.status}'` : '';
  const rides = db.prepare(`SELECT r.*,u.Name as DriverName FROM Rides r LEFT JOIN Users u ON r.DriverID=u.UserID ${where} ORDER BY r.CreatedAt DESC`).all();
  const statusBadge = s => s==='active'?'badge-green':s==='completed'?'badge-blue':'badge-red';
  const rows = rides.map(r => `<tr>
    <td>#${r.RideID}</td>
    <td>${esc(r.DriverName||'—')}</td>
    <td>${esc(r.PickupLocation)} → ${esc(r.Destination)}</td>
    <td>${(r.DepartureTime||'').slice(0,16)}</td>
    <td>${r.BookedSeats}/${r.TotalSeats}</td>
    <td>₹${r.PricePerSeat}</td>
    <td>${r.DistanceKm?r.DistanceKm.toFixed(1)+'km':'—'}</td>
    <td>${esc(r.VehicleType||'—')} ${esc(r.VehicleNumber||'')}</td>
    <td><span class="badge ${statusBadge(r.Status)}">${r.Status}</span></td>
    <td>${(r.CreatedAt||'').slice(0,10)}</td>
  </tr>`).join('') || '<tr><td colspan="10" class="empty">No rides</td></tr>';
  const title = req.query.status ? `${req.query.status} Rides` : 'All Rides';
  res.send(adminHeader(pass, title, `/admin?pass=${encodeURIComponent(pass)}`) + `
<h2>🚗 ${title} (${rides.length})</h2>

<table><thead><tr><th>ID</th><th>Driver</th><th>Route</th><th>Departure</th><th>Seats</th><th>Price</th><th>Distance</th><th>Vehicle</th><th>Status</th><th>Date</th></tr></thead>
<tbody>${rows}</tbody></table></div></body></html>`);
});

app.get('/admin/bookings', (req, res) => {
  const pass = adminCheck(req, res);
  if (!pass) return;
  const db = require('./db/database').getDb();
  const where = req.query.status ? `WHERE b.Status='${req.query.status}'` : '';
  const bookings = db.prepare(`SELECT b.*,u.Name as PassengerName,u.ContactPhone as PassengerContact,r.PickupLocation,r.Destination FROM Bookings b LEFT JOIN Users u ON b.UserID=u.UserID LEFT JOIN Rides r ON b.RideID=r.RideID ${where} ORDER BY b.CreatedAt DESC`).all();
  const statusBadge = s => s==='confirmed'?'badge-green':s==='cancelled'?'badge-red':'badge-yellow';
  const rows = bookings.map(b => `<tr>
    <td>#${b.BookingID}</td>
    <td>${esc(b.PassengerName||'—')}</td>
    <td>${esc(b.PassengerContact||'—')}</td>
    <td>#${b.RideID} ${esc(b.PickupLocation||'')} → ${esc(b.Destination||'')}</td>
    <td>${b.SeatsBooked}</td>
    <td>₹${b.TotalAmount}</td>
    <td><span class="badge ${statusBadge(b.Status)}">${b.Status}</span></td>
    <td>${(b.CreatedAt||'').slice(0,10)}</td>
  </tr>`).join('') || '<tr><td colspan="8" class="empty">No bookings</td></tr>';
  const title = req.query.status ? `${req.query.status} Bookings` : 'All Bookings';
  res.send(adminHeader(pass, title, `/admin?pass=${encodeURIComponent(pass)}`) + `
<h2>🎫 ${title} (${bookings.length})</h2>
<table><thead><tr><th>ID</th><th>Passenger</th><th>Phone</th><th>Ride</th><th>Seats</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
<tbody>${rows}</tbody></table></div></body></html>`);
});

app.get('/admin/feedback', (req, res) => {
  const pass = adminCheck(req, res);
  if (!pass) return;
  const db = require('./db/database').getDb();
  const feedbacks = db.prepare(`SELECT f.*,u.Name AS UserName FROM Feedback f LEFT JOIN Users u ON f.UserID=u.UserID ORDER BY f.CreatedAt DESC`).all();
  const rows = feedbacks.map(f => `<tr>
    <td>#${f.FeedbackID}</td>
    <td>${esc(f.UserName||'—')}</td>
    <td><span class="badge badge-blue">${f.Role||'—'}</span></td>
    <td>${f.BookingID?'#'+f.BookingID:'—'}</td>
    <td>${esc(f.Message||'—')}</td>
    <td>${(f.CreatedAt||'').slice(0,10)}</td>
  </tr>`).join('') || '<tr><td colspan="6" class="empty">No feedback</td></tr>';
  res.send(adminHeader(pass, 'Feedback', `/admin?pass=${encodeURIComponent(pass)}`) + `
<h2>💬 All Feedback (${feedbacks.length})</h2>
<table><thead><tr><th>ID</th><th>User</th><th>Role</th><th>Booking</th><th>Message</th><th>Date</th></tr></thead>
<tbody>${rows}</tbody></table></div></body></html>`);
});

async function start() {
  try {
    initializeDb();

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.error('[Server] TELEGRAM_BOT_TOKEN is not set in .env');
      process.exit(1);
    }

    const webhookPath = `/tg/${token.slice(-10)}`;

    // Register webhook POST route — getBot() is called lazily so bot can init after listen
    app.post(webhookPath, (req, res) => {
      try {
        require('./telegram/bot').getBot()
          .handleUpdate(req.body, res)
          .catch(e => console.error('[Bot] handleUpdate error:', e.message));
      } catch (_) {
        res.status(503).json({ error: 'Bot initializing, retry shortly' });
      }
    });

    // 404 and error handlers MUST come after all specific routes
    app.use((req, res) => res.status(404).json({ error: 'Not found' }));
    app.use((err, req, res, next) => {
      console.error('[Server] Unhandled error:', err);
      res.status(500).json({ error: 'Internal server error' });
    });

    // Bind port FIRST — Render's scanner needs to see it before any async API calls
    await new Promise(resolve => app.listen(PORT, () => {
      console.log(`[Server] Listening on port ${PORT}`);
      resolve();
    }));

    // Now do the Telegram API calls (setMyCommands + setWebhook/launch)
    let pollingMode = false;
    const bot = await initBot(token);

    if (process.env.TELEGRAM_WEBHOOK_URL) {
      const fullUrl = `${process.env.TELEGRAM_WEBHOOK_URL}${webhookPath}`;
      await bot.telegram.setWebhook(fullUrl);
      console.log(`[Server] Telegram webhook registered: ${fullUrl}`);
    } else {
      pollingMode = true;
      await bot.telegram.deleteWebhook();
      await bot.launch();
      console.log('[Server] Loopz Bot running in polling mode 🚀');
    }

    console.log(`[Server] Loopz Bot ready (${pollingMode ? 'polling' : 'webhook'} mode)`);

    const shutdown = async () => {
      console.log('[Server] Shutting down...');
      try { if (pollingMode) bot.stop('SIGTERM'); } catch (_) {}
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
