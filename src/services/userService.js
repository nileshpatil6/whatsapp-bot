'use strict';

const { getDb } = require('../db/database');

function getUserByPhone(phone) {
  return getDb().prepare('SELECT * FROM Users WHERE Phone = ?').get(phone) || null;
}

function getUserById(userId) {
  return getDb().prepare('SELECT * FROM Users WHERE UserID = ?').get(userId) || null;
}

function userExistsByEmail(email) {
  const row = getDb().prepare('SELECT 1 FROM Users WHERE Email = ? LIMIT 1').get(email.toLowerCase());
  return !!row;
}

function createUser({ phone, name, email, homeArea, officeLocation, officeTiming, vehicleOwner }) {
  const result = getDb().prepare(`
    INSERT INTO Users (Phone, Name, Email, HomeArea, OfficeLocation, OfficeTiming, VehicleOwner, IsVerified)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `).run(phone, name, email.toLowerCase(), homeArea, officeLocation, officeTiming, vehicleOwner);

  return getUserById(result.lastInsertRowid);
}

module.exports = { getUserByPhone, getUserById, userExistsByEmail, createUser };
