'use strict';

const { getDb } = require('../db/database');

function getUserByPhone(phone) {
  return getDb().prepare('SELECT * FROM Users WHERE Phone = ?').get(phone) || null;
}

function getUserById(userId) {
  return getDb().prepare('SELECT * FROM Users WHERE UserID = ?').get(userId) || null;
}

function createUser({ phone, name, contactPhone = null, gender = 'Not specified', homeArea = null, officeLocation = null, vehicleOwner = 'No' }) {
  const result = getDb().prepare(`
    INSERT INTO Users (Phone, Name, ContactPhone, Gender, HomeArea, OfficeLocation, VehicleOwner, IsVerified)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `).run(phone, name, contactPhone, gender, homeArea, officeLocation, vehicleOwner);

  return getUserById(result.lastInsertRowid);
}

function markDisclaimerSeen(phone) {
  getDb().prepare('UPDATE Users SET HasSeenDisclaimer = 1 WHERE Phone = ?').run(phone);
}

function updateRating(userId, rating) {
  getDb().prepare(`
    UPDATE Users SET Rating = ROUND((Rating + ?) / 2.0, 1) WHERE UserID = ?
  `).run(rating, userId);
}

function updateContactPhone(phone, contactPhone) {
  getDb().prepare('UPDATE Users SET ContactPhone = ? WHERE Phone = ?').run(contactPhone, phone);
}

function addEarnings(userId, amount) {
  getDb().prepare('UPDATE Users SET TotalEarnings = TotalEarnings + ? WHERE UserID = ?').run(amount, userId);
}

function saveVehicleInfo(phone, vehicleType, vehicleNumber) {
  getDb().prepare('UPDATE Users SET VehicleType = ?, VehicleNumber = ? WHERE Phone = ?').run(vehicleType, vehicleNumber, phone);
}

module.exports = { getUserByPhone, getUserById, createUser, updateContactPhone, markDisclaimerSeen, updateRating, addEarnings, saveVehicleInfo };
