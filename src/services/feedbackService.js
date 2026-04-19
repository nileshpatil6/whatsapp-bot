'use strict';

const { getDb } = require('../db/database');

function createFeedback({ userId, bookingId, message, role = 'passenger' }) {
  const result = getDb().prepare(`
    INSERT INTO Feedback (UserID, BookingID, Message, Role)
    VALUES (?, ?, ?, ?)
  `).run(userId || null, bookingId || null, message, role);
  return result.lastInsertRowid;
}

function getAllFeedback(limit = 50) {
  return getDb().prepare(`
    SELECT f.*, u.Name AS UserName
    FROM Feedback f
    LEFT JOIN Users u ON f.UserID = u.UserID
    ORDER BY f.CreatedAt DESC
    LIMIT ?
  `).all(limit);
}

module.exports = { createFeedback, getAllFeedback };
