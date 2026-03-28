'use strict';

const { getDb } = require('../db/database');

function createBooking({ rideId, userId, seatsBooked, totalAmount }) {
  const result = getDb().prepare(`
    INSERT INTO Bookings (RideID, UserID, SeatsBooked, TotalAmount)
    VALUES (?, ?, ?, ?)
  `).run(rideId, userId, seatsBooked, totalAmount);

  return getBookingById(result.lastInsertRowid);
}

function getBookingById(bookingId) {
  return getDb().prepare('SELECT * FROM Bookings WHERE BookingID = ?').get(bookingId) || null;
}

function getBookingsByUser(userId) {
  return getDb().prepare(`
    SELECT b.*, r.PickupLocation, r.Destination, r.DepartureTime
    FROM Bookings b
    JOIN Rides r ON b.RideID = r.RideID
    WHERE b.UserID = ?
    ORDER BY b.CreatedAt DESC
    LIMIT 10
  `).all(userId);
}

function getBookingsByRide(rideId) {
  return getDb().prepare(`
    SELECT b.*, u.Name, u.Phone
    FROM Bookings b
    JOIN Users u ON b.UserID = u.UserID
    WHERE b.RideID = ?
  `).all(rideId);
}

module.exports = { createBooking, getBookingById, getBookingsByUser, getBookingsByRide };
