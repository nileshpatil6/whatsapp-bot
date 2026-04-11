'use strict';

const { getDb } = require('../db/database');

function getUserByPhone(phone) {
  return getDb().prepare('SELECT * FROM Users WHERE Phone = ?').get(phone) || null;
}

function getUserById(userId) {
  return getDb().prepare('SELECT * FROM Users WHERE UserID = ?').get(userId) || null;
}

function createUser({ phone, name, gender = 'Not specified', homeArea = null, officeLocation = null, vehicleOwner = 'No' }) {
  const result = getDb().prepare(`
    INSERT INTO Users (Phone, Name, Gender, HomeArea, OfficeLocation, VehicleOwner, IsVerified)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `).run(phone, name, gender, homeArea, officeLocation, vehicleOwner);

  return getUserById(result.lastInsertRowid);
}

function markDisclaimerSeen(phone) {
  getDb().prepare('UPDATE Users SET HasSeenDisclaimer = 1 WHERE Phone = ?').run(phone);
}

function updateRating(userId, rating) {
  // Average existing rating with new one
  getDb().prepare(`
    UPDATE Users SET Rating = ROUND((Rating + ?) / 2.0, 1) WHERE UserID = ?
  `).run(rating, userId);
}

module.exports = { getUserByPhone, getUserById, createUser, markDisclaimerSeen, updateRating };
