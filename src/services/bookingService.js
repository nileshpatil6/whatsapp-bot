'use strict';

const { getDb } = require('../db/database');

function createBooking({ rideId, userId, seatsBooked, totalAmount, isRecurring = 0, verificationCode = null }) {
  const result = getDb().prepare(`
    INSERT INTO Bookings (RideID, UserID, SeatsBooked, TotalAmount, IsRecurring, VerificationCode)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(rideId, userId, seatsBooked, totalAmount, isRecurring, verificationCode);
  return getBookingById(result.lastInsertRowid);
}

function getBookingById(bookingId) {
  return getDb().prepare('SELECT * FROM Bookings WHERE BookingID = ?').get(bookingId) || null;
}

function getBookingsByUser(userId) {
  return getDb().prepare(`
    SELECT b.*, r.PickupLocation, r.Destination, r.DepartureTime, r.PricePerSeat
    FROM Bookings b
    JOIN Rides r ON b.RideID = r.RideID
    WHERE b.UserID = ? AND b.Status != 'cancelled'
    ORDER BY r.DepartureTime DESC
    LIMIT 10
  `).all(userId);
}

function getActiveBookingsByUser(userId) {
  return getDb().prepare(`
    SELECT b.*, r.PickupLocation, r.Destination, r.DepartureTime, r.DriverID
    FROM Bookings b
    JOIN Rides r ON b.RideID = r.RideID
    WHERE b.UserID = ? AND b.Status = 'confirmed'
      AND r.DepartureTime > datetime('now')
    ORDER BY r.DepartureTime ASC
  `).all(userId);
}

// Returns the most recent booking for a user (any status) for route re-use
function getLastBookingByUser(userId) {
  return getDb().prepare(`
    SELECT b.*, r.PickupLocation, r.Destination, r.PickupLat, r.PickupLng, r.DestLat, r.DestLng
    FROM Bookings b
    JOIN Rides r ON b.RideID = r.RideID
    WHERE b.UserID = ?
    ORDER BY b.CreatedAt DESC LIMIT 1
  `).get(userId) || null;
}

function cancelBooking(bookingId) {
  const result = getDb().prepare(`
    UPDATE Bookings SET Status = 'cancelled' WHERE BookingID = ?
  `).run(bookingId);

  if (result.changes > 0) {
    // Give back the seats
    const booking = getBookingById(bookingId);
    if (booking) {
      getDb().prepare(`
        UPDATE Rides SET BookedSeats = MAX(0, BookedSeats - ?), Status = 'active'
        WHERE RideID = ?
      `).run(booking.SeatsBooked, booking.RideID);
    }
  }
  return result.changes;
}

// Verify a boarding code entered by a driver.
// rideId must be supplied — we only verify against that exact ride.
// This prevents cross-ride code collisions and NULL-code false positives.
function verifyBoardingCode(code, driverUserId, rideId) {
  if (!code || !driverUserId || !rideId) return null;

  const result = getDb().prepare(`
    SELECT b.BookingID, b.SeatsBooked,
           r.PickupLocation, r.Destination, r.DepartureTime, r.RideID,
           u.Phone AS PassengerPhone, u.Name AS PassengerName
    FROM Bookings b
    JOIN Rides   r ON b.RideID  = r.RideID
    JOIN Users   u ON b.UserID  = u.UserID
    WHERE b.VerificationCode    IS NOT NULL
      AND b.VerificationCode    != ''
      AND b.VerificationCode    = ?
      AND r.RideID              = ?
      AND r.DriverID            = ?
      AND b.Status              = 'confirmed'
      AND r.Status              IN ('active', 'full')
  `).get(code, rideId, driverUserId);

  return result || null;
}

function rateBooking(bookingId, rating) {
  return getDb().prepare('UPDATE Bookings SET Rating = ? WHERE BookingID = ?').run(rating, bookingId);
}

// Cancel all confirmed bookings for a ride (when driver cancels the ride)
function cancelBookingsByRide(rideId) {
  return getDb().prepare(
    "UPDATE Bookings SET Status = 'cancelled' WHERE RideID = ? AND Status = 'confirmed'"
  ).run(rideId);
}

module.exports = {
  createBooking, getBookingById, getBookingsByUser, getLastBookingByUser,
  getActiveBookingsByUser, cancelBooking, rateBooking, cancelBookingsByRide,
  verifyBoardingCode,
};
