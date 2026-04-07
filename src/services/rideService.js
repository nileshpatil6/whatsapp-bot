'use strict';

const { getDb } = require('../db/database');

function createRide({ driverId, pickupLocation, pickupLat, pickupLng,
                       destination, destLat, destLng, departureTime,
                       totalSeats, pricePerSeat, vehicleType,
                       ridePreference = 'all', isRecurring = 0 }) {
  const result = getDb().prepare(`
    INSERT INTO Rides
      (DriverID, PickupLocation, PickupLat, PickupLng, Destination, DestLat, DestLng,
       DepartureTime, TotalSeats, PricePerSeat, VehicleType, RidePreference, IsRecurring)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(driverId, pickupLocation, pickupLat, pickupLng,
         destination, destLat, destLng, departureTime,
         totalSeats, pricePerSeat, vehicleType, ridePreference, isRecurring);

  return getRideById(result.lastInsertRowid);
}

function getRideById(rideId) {
  return getDb().prepare('SELECT * FROM Rides WHERE RideID = ?').get(rideId) || null;
}

// Get active rides with optional women-only filter
function getActiveRides(preferenceFilter = null) {
  let sql = `
    SELECT * FROM Rides
    WHERE Status = 'active'
      AND BookedSeats < TotalSeats
      AND DepartureTime > datetime('now')
  `;
  if (preferenceFilter === 'women_only') {
    sql += ` AND RidePreference = 'women_only'`;
  }
  sql += ' ORDER BY DepartureTime ASC';
  return getDb().prepare(sql).all();
}

function getRidesByDriver(driverId) {
  return getDb().prepare(`
    SELECT * FROM Rides WHERE DriverID = ? ORDER BY CreatedAt DESC LIMIT 10
  `).all(driverId);
}

function incrementBookedSeats(rideId, count) {
  const result = getDb().prepare(`
    UPDATE Rides
    SET BookedSeats = BookedSeats + ?,
        Status = CASE WHEN BookedSeats + ? >= TotalSeats THEN 'full' ELSE Status END
    WHERE RideID = ? AND (TotalSeats - BookedSeats) >= ?
  `).run(count, count, rideId, count);
  return result.changes;
}

function updateRideStatus(rideId, status) {
  return getDb().prepare('UPDATE Rides SET Status = ? WHERE RideID = ?').run(status, rideId);
}

module.exports = {
  createRide, getRideById, getActiveRides,
  getRidesByDriver, incrementBookedSeats, updateRideStatus,
};
