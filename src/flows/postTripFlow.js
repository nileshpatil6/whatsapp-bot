'use strict';

/**
 * Post-Trip Flow
 * Triggered when driver marks a ride as complete.
 *
 * For the DRIVER:
 *   "Do you want to post the same route again?"
 *   1️⃣ Same route → pre-fill OfferRide (skip location steps, jump to time)
 *   2️⃣ Different route → start fresh OfferRide
 *
 * For each PASSENGER:
 *   "Do you want to find a ride on the same route again?"
 *   1️⃣ Same route → search rides near same pickup automatically
 *   2️⃣ Different route → start fresh FindRide
 */

const waClient = require('../whatsapp/client');
const sessionManager = require('../state/sessionManager');
const userService = require('../services/userService');
const { FLOWS, STEPS } = require('../utils/constants');
const { formatDepartureTime } = require('../utils/formatters');

// ─── Called by myBookingsFlow when driver taps "Mark Complete" ────────────────

async function triggerForDriver(driverPhone, ride, passengers) {
  const driver = userService.getUserByPhone(driverPhone);

  sessionManager.replaceSession(driverPhone, {
    phone: driverPhone,
    flow: FLOWS.POST_TRIP,
    step: STEPS.POST_TRIP_ASK,
    data: {
      role: 'driver',
      savedRoute: {
        pickupText:    ride.PickupLocation,
        pickupLat:     ride.PickupLat,
        pickupLng:     ride.PickupLng,
        destText:      ride.Destination,
        destLat:       ride.DestLat,
        destLng:       ride.DestLng,
        vehicleType:   ride.VehicleType,
        vehicleName:   ride.VehicleName || null,
        vehicleNumber: ride.VehicleNumber || null,
        totalSeats:    ride.TotalSeats,
        ridePreference: ride.RidePreference,
        distanceKm:    ride.DistanceKm || 0,
        departureTime: ride.DepartureTime,
      },
    },
  });

  await waClient.sendButtons(driverPhone,
    `🏁 *Trip Complete!*\n\n` +
    `🗺️ ${ride.PickupLocation} → ${ride.Destination}\n\n` +
    `Great ride, *${driver ? driver.Name : 'Rider'}*! 🎉\n\n` +
    `Do you want to post *the same route* again for tomorrow?`,
    [
      { id: 'pt_same',      title: '1️⃣ Same Route' },
      { id: 'pt_different', title: '2️⃣ Different Route' },
    ]
  );

  // Notify each passenger and ask them the same question
  for (const p of passengers) {
    triggerForPassenger(p.Phone, ride).catch(
      err => console.error(`[PostTrip] Passenger notify failed (${p.Phone}):`, err.message)
    );
  }
}

async function triggerForPassenger(passengerPhone, ride) {
  const passenger = userService.getUserByPhone(passengerPhone);

  sessionManager.replaceSession(passengerPhone, {
    phone: passengerPhone,
    flow: FLOWS.POST_TRIP,
    step: STEPS.POST_TRIP_ASK,
    data: {
      role: 'passenger',
      savedRoute: {
        pickupText: ride.PickupLocation,
        pickupLat:  ride.PickupLat,
        pickupLng:  ride.PickupLng,
        destText:   ride.Destination,
        destLat:    ride.DestLat,
        destLng:    ride.DestLng,
      },
    },
  });

  await waClient.sendButtons(passengerPhone,
    `🏁 *Trip Complete!*\n\n` +
    `🗺️ ${ride.PickupLocation} → ${ride.Destination}\n\n` +
    `Hope you had a safe ride, *${passenger ? passenger.Name : 'Commuter'}*! 😊\n\n` +
    `Do you want to find a ride on *the same route* again?`,
    [
      { id: 'pt_same',      title: '1️⃣ Same Route' },
      { id: 'pt_different', title: '2️⃣ Different Route' },
    ]
  );
}

// ─── Handle the user's reply ──────────────────────────────────────────────────

async function handle(phone, text, session) {
  const t = text.trim().toLowerCase();
  const { role, savedRoute } = session.data;

  if (!['pt_same', '1', '1️⃣ same route', 'pt_different', '2', '2️⃣ different route'].includes(t)) {
    return waClient.sendButtons(phone,
      `Do you want to use the same route?\n\n🗺️ *${savedRoute.pickupText} → ${savedRoute.destText}*`,
      [
        { id: 'pt_same',      title: '1️⃣ Same Route' },
        { id: 'pt_different', title: '2️⃣ Different Route' },
      ]
    );
  }

  const sameroute = ['pt_same', '1', '1️⃣ same route'].includes(t);
  sessionManager.clearSession(phone);

  const user = userService.getUserByPhone(phone);

  if (role === 'driver') {
    if (sameroute) {
      // Pre-fill offer ride — locations are already known, jump straight to time
      return require('./offerRideFlow').startWithRoute(phone, user, savedRoute);
    } else {
      return require('./offerRideFlow').start(phone, user);
    }
  } else {
    // Passenger
    if (sameroute) {
      // Search rides near the same pickup automatically
      return require('./findRideFlow').startWithLocation(phone, user, {
        lat:     savedRoute.pickupLat,
        lng:     savedRoute.pickupLng,
        name:    savedRoute.pickupText,
        address: null,
      });
    } else {
      return require('./findRideFlow').start(phone, user);
    }
  }
}

module.exports = { triggerForDriver, triggerForPassenger, handle };
