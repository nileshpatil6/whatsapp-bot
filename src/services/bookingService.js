'use strict';

const { getDb } = require('../db/database');

function createBooking({ rideId, userId, seatsBooked, totalAmount, isRecurring = 0 }) {
  const result = getDb().prepare(`
    INSERT INTO Bookings (RideID, UserID, SeatsBooked, TotalAmount, IsRecurring)
    VALUES (?, ?, ?, ?, ?)
  `).run(rideId, userId, seatsBooked, totalAmount, isRecurring);
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
  createBooking, getBookingById, getBookingsByUser,
  getActiveBookingsByUser, cancelBooking, rateBooking, cancelBookingsByRide,
};
