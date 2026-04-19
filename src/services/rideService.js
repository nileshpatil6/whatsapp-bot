'use strict';

const { getDb } = require('../db/database');

function createRide({ driverId, vehicleName = null, vehicleNumber = null, pickupLocation, pickupLat, pickupLng,
                       destination, destLat, destLng, departureTime,
                       totalSeats, pricePerSeat, vehicleType,
                       distanceKm = 0, ridePreference = 'all', isRecurring = 0 }) {
  const result = getDb().prepare(`
    INSERT INTO Rides
      (DriverID, VehicleName, VehicleNumber, PickupLocation, PickupLat, PickupLng,
       Destination, DestLat, DestLng, DepartureTime, TotalSeats,
       PricePerSeat, VehicleType, DistanceKm, RidePreference, IsRecurring)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(driverId, vehicleName, vehicleNumber, pickupLocation, pickupLat, pickupLng,
         destination, destLat, destLng, departureTime,
         totalSeats, pricePerSeat, vehicleType, distanceKm, ridePreference, isRecurring);

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

// Returns the most recent ride offered by this driver (any status) for route re-use
function getLastRideByDriver(driverId) {
  return getDb().prepare(`
    SELECT * FROM Rides WHERE DriverID = ? ORDER BY CreatedAt DESC LIMIT 1
  `).get(driverId) || null;
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

function cancelRide(rideId) {
  return getDb().prepare("UPDATE Rides SET Status = 'cancelled' WHERE RideID = ?").run(rideId);
}

function completeRide(rideId) {
  return getDb().prepare("UPDATE Rides SET Status = 'completed' WHERE RideID = ?").run(rideId);
}

function rescheduleRide(rideId, newDepartureTime) {
  return getDb().prepare('UPDATE Rides SET DepartureTime = ? WHERE RideID = ?').run(newDepartureTime, rideId);
}

// Returns passengers with booking info for a ride (for notifications)
function getPassengersByRide(rideId) {
  return getDb().prepare(`
    SELECT u.Phone, u.Name, b.SeatsBooked, b.BookingID
    FROM Bookings b
    JOIN Users u ON b.UserID = u.UserID
    WHERE b.RideID = ? AND b.Status = 'confirmed'
  `).all(rideId);
}

module.exports = {
  createRide, getRideById, getActiveRides,
  getRidesByDriver, getLastRideByDriver, incrementBookedSeats, updateRideStatus,
  cancelRide, completeRide, rescheduleRide, getPassengersByRide,
};
