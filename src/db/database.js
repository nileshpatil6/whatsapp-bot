'use strict';

// Uses Node.js built-in SQLite (v22.5+) — no native compilation needed
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

let db = null;

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initializeDb() first.');
  return db;
}

function initializeDb() {
  const dbPath = process.env.DB_PATH || './data/rideshare.db';
  const resolvedPath = path.resolve(dbPath);

  // Ensure the data directory exists
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new DatabaseSync(resolvedPath);

  // Performance and safety pragmas
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA synchronous = NORMAL");

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS Users (
      UserID         INTEGER PRIMARY KEY AUTOINCREMENT,
      Phone          TEXT    NOT NULL UNIQUE,
      Name           TEXT,
      Email          TEXT    UNIQUE,
      HomeArea       TEXT,
      OfficeLocation TEXT,
      OfficeTiming   TEXT,
      VehicleOwner   TEXT    NOT NULL DEFAULT 'No',
      Rating         REAL    NOT NULL DEFAULT 5.0,
      IsVerified     INTEGER NOT NULL DEFAULT 0,
      CreatedAt      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS Rides (
      RideID         INTEGER PRIMARY KEY AUTOINCREMENT,
      DriverID       INTEGER NOT NULL REFERENCES Users(UserID),
      PickupLocation TEXT    NOT NULL,
      PickupLat      REAL    NOT NULL,
      PickupLng      REAL    NOT NULL,
      Destination    TEXT    NOT NULL,
      DestLat        REAL    NOT NULL,
      DestLng        REAL    NOT NULL,
      DepartureTime  TEXT    NOT NULL,
      TotalSeats     INTEGER NOT NULL,
      BookedSeats    INTEGER NOT NULL DEFAULT 0,
      PricePerSeat   INTEGER NOT NULL,
      VehicleType    TEXT    NOT NULL,
      Status         TEXT    NOT NULL DEFAULT 'active',
      CreatedAt      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS Bookings (
      BookingID   INTEGER PRIMARY KEY AUTOINCREMENT,
      RideID      INTEGER NOT NULL REFERENCES Rides(RideID),
      UserID      INTEGER NOT NULL REFERENCES Users(UserID),
      SeatsBooked INTEGER NOT NULL,
      TotalAmount INTEGER NOT NULL,
      Status      TEXT    NOT NULL DEFAULT 'confirmed',
      CreatedAt   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_rides_status     ON Rides(Status);
    CREATE INDEX IF NOT EXISTS idx_rides_departure  ON Rides(DepartureTime);
    CREATE INDEX IF NOT EXISTS idx_rides_driver     ON Rides(DriverID);
    CREATE INDEX IF NOT EXISTS idx_bookings_user    ON Bookings(UserID);
    CREATE INDEX IF NOT EXISTS idx_bookings_ride    ON Bookings(RideID);
    CREATE INDEX IF NOT EXISTS idx_users_phone      ON Users(Phone);
  `);

  console.log(`[DB] Database initialized at ${resolvedPath}`);
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
    console.log('[DB] Database connection closed.');
  }
}

module.exports = { getDb, initializeDb, closeDb };
