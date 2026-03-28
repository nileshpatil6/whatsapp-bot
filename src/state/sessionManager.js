'use strict';

const { FLOWS, SESSION_TTL_MS } = require('../utils/constants');

// In-memory session store: Map<phone, session>
const sessions = new Map();

function getSession(phone) {
  const session = sessions.get(phone);
  if (!session) return null;

  // Check TTL
  if (Date.now() - session.lastActivity > SESSION_TTL_MS) {
    sessions.delete(phone);
    return null;
  }
  return session;
}

function setSession(phone, updates) {
  const existing = sessions.get(phone) || {
    phone,
    flow: FLOWS.IDLE,
    step: null,
    data: {},
    lastActivity: Date.now(),
  };

  const updated = {
    ...existing,
    ...updates,
    data: { ...existing.data, ...(updates.data || {}) },
    lastActivity: Date.now(),
  };

  sessions.set(phone, updated);
  return updated;
}

function clearSession(phone) {
  sessions.delete(phone);
}

// Replace session data entirely (don't merge data)
function replaceSession(phone, session) {
  sessions.set(phone, { ...session, lastActivity: Date.now() });
}

// Cleanup stale sessions every 10 minutes
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [phone, session] of sessions.entries()) {
    if (now - session.lastActivity > SESSION_TTL_MS) {
      sessions.delete(phone);
      cleaned++;
    }
  }
  if (cleaned > 0) console.log(`[Sessions] Cleaned up ${cleaned} stale session(s).`);
}, 10 * 60 * 1000);

module.exports = { getSession, setSession, clearSession, replaceSession };
