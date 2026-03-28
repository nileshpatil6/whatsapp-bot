'use strict';

const waClient = require('../whatsapp/client');
const sessionManager = require('../state/sessionManager');
const rideService = require('../services/rideService');
const mapsService = require('../services/mapsService');
const userService = require('../services/userService');
const { FLOWS, STEPS } = require('../utils/constants');
const {
  isValidAreaText,
  isValidSeats,
  isValidPrice,
  isValidVehicleType,
  parseTimeInput,
  formatDateForDb,
} = require('../utils/validators');
const { formatDepartureTime } = require('../utils/formatters');

async function start(phone) {
  sessionManager.setSession(phone, {
    flow: FLOWS.OFFER_RIDE,
    step: STEPS.OFFER_ASK_PICKUP,
    data: {},
  });

  await waClient.sendText(phone,
    '🚗 *Offer a Ride*\n\n' +
    'Let\'s create your ride listing.\n\n' +
    'What is your *pickup area*?\n' +
    '_(e.g. Kondapur Bus Stop, Miyapur Metro, Kukatpally)_\n\n' +
    '_Reply *Cancel* at any time to go back._'
  );
}

async function handle(phone, text, session) {
  switch (session.step) {
    case STEPS.OFFER_ASK_PICKUP:   return handlePickup(phone, text, session);
    case STEPS.OFFER_ASK_DEST:     return handleDest(phone, text, session);
    case STEPS.OFFER_ASK_TIME:     return handleTime(phone, text, session);
    case STEPS.OFFER_ASK_SEATS:    return handleSeats(phone, text, session);
    case STEPS.OFFER_ASK_PRICE:    return handlePrice(phone, text, session);
    case STEPS.OFFER_ASK_VEHICLE:  return handleVehicle(phone, text, session);
    case STEPS.OFFER_CONFIRM:      return handleConfirm(phone, text, session);
    default: return start(phone);
  }
}

async function handlePickup(phone, text, session) {
  if (!isValidAreaText(text)) {
    return waClient.sendText(phone, '❌ Please enter a valid pickup area (at least 2 characters).\n\nYour *pickup area*:');
  }
  sessionManager.setSession(phone, { step: STEPS.OFFER_ASK_DEST, data: { pickupText: text.trim() } });
  await waClient.sendText(phone,
    'Where are you *going to* (destination)?\n' +
    '_(e.g. ICICI HITEC City, Nanakramguda Branch, Financial District)_'
  );
}

async function handleDest(phone, text, session) {
  if (!isValidAreaText(text)) {
    return waClient.sendText(phone, '❌ Please enter a valid destination.\n\nYour *destination*:');
  }
  sessionManager.setSession(phone, { step: STEPS.OFFER_ASK_TIME, data: { destText: text.trim() } });
  await waClient.sendText(phone,
    'What time will you *depart*?\n' +
    '_(e.g. 9 AM, 8:30 AM, tomorrow 9 AM)_'
  );
}

async function handleTime(phone, text, session) {
  const parsed = parseTimeInput(text);
  if (!parsed) {
    return waClient.sendText(phone,
      '❌ Could not understand that time. Please try again.\n' +
      '_(e.g. *9 AM*, *8:30 AM*, *tomorrow 9 AM*)_\n\nDeparture time:'
    );
  }
  const departureTime = formatDateForDb(parsed);
  sessionManager.setSession(phone, { step: STEPS.OFFER_ASK_SEATS, data: { departureTime, departureDisplay: formatDepartureTime(departureTime) } });
  await waClient.sendText(phone,
    `✅ Departure: *${formatDepartureTime(departureTime)}*\n\n` +
    'How many *seats* are available? _(1–6)_'
  );
}

async function handleSeats(phone, text, session) {
  if (!isValidSeats(text)) {
    return waClient.sendText(phone, '❌ Please enter a number between 1 and 6.\n\nAvailable *seats*:');
  }
  sessionManager.setSession(phone, { step: STEPS.OFFER_ASK_PRICE, data: { totalSeats: parseInt(text.trim(), 10) } });
  await waClient.sendText(phone,
    'What is the *price per seat* in rupees?\n_(Enter 0 for free)_'
  );
}

async function handlePrice(phone, text, session) {
  if (!isValidPrice(text)) {
    return waClient.sendText(phone, '❌ Please enter a valid price (0 to 9999).\n\n*Price per seat* (₹):');
  }
  sessionManager.setSession(phone, { step: STEPS.OFFER_ASK_VEHICLE, data: { pricePerSeat: parseInt(text.trim(), 10) } });
  await waClient.sendButtons(phone,
    'What type of vehicle will you be using?',
    [
      { id: 'vehicle_car', title: '🚗 Car' },
      { id: 'vehicle_bike', title: '🏍️ Bike' },
      { id: 'vehicle_auto', title: '🛺 Auto' },
    ]
  );
}

async function handleVehicle(phone, text, session) {
  const aliases = {
    vehicle_car: 'car', 'car': 'car', '🚗 car': 'car',
    vehicle_bike: 'bike', 'bike': 'bike', '🏍️ bike': 'bike',
    vehicle_auto: 'auto', 'auto': 'auto', '🛺 auto': 'auto',
  };
  const vehicleType = aliases[text.trim().toLowerCase()];

  if (!vehicleType) {
    return waClient.sendButtons(phone,
      'Please choose your vehicle type:',
      [
        { id: 'vehicle_car', title: '🚗 Car' },
        { id: 'vehicle_bike', title: '🏍️ Bike' },
        { id: 'vehicle_auto', title: '🛺 Auto' },
      ]
    );
  }

  sessionManager.setSession(phone, { step: STEPS.OFFER_CONFIRM, data: { vehicleType } });

  // Show summary for confirmation
  const s = sessionManager.getSession(phone).data;
  const priceStr = s.pricePerSeat === 0 ? 'Free' : `₹${s.pricePerSeat}/seat`;
  const vehicleDisplay = vehicleType.charAt(0).toUpperCase() + vehicleType.slice(1);

  await waClient.sendButtons(phone,
    `📋 *Ride Summary*\n\n` +
    `📍 From: ${s.pickupText}\n` +
    `🏁 To: ${s.destText}\n` +
    `🕐 Departure: ${s.departureDisplay}\n` +
    `💺 Seats: ${s.totalSeats}\n` +
    `💰 Price: ${priceStr}\n` +
    `🚗 Vehicle: ${vehicleDisplay}\n\n` +
    'Confirm this ride?',
    [
      { id: 'confirm_yes', title: '✅ Yes, Post Ride' },
      { id: 'confirm_no', title: '❌ No, Cancel' },
    ]
  );
}

async function handleConfirm(phone, text, session) {
  const t = text.trim().toLowerCase();

  if (['confirm_no', 'no', 'cancel', '❌ no, cancel'].includes(t)) {
    sessionManager.clearSession(phone);
    return waClient.sendText(phone, 'Ride cancelled. Reply *Menu* to go back.');
  }

  if (!['confirm_yes', 'yes', '✅ yes, post ride'].includes(t)) {
    return waClient.sendButtons(phone, 'Please confirm your ride:',
      [
        { id: 'confirm_yes', title: '✅ Yes, Post Ride' },
        { id: 'confirm_no', title: '❌ No, Cancel' },
      ]
    );
  }

  const s = session.data;
  await waClient.sendText(phone, '⏳ Geocoding your locations, please wait...');

  // Geocode both locations
  const [pickupCoords, destCoords] = await Promise.all([
    mapsService.geocodeAddress(s.pickupText),
    mapsService.geocodeAddress(s.destText),
  ]);

  if (!pickupCoords) {
    return waClient.sendText(phone,
      `❌ Could not find "*${s.pickupText}*" on the map. Please be more specific.\n\n` +
      'Reply *Restart* to try again.'
    );
  }
  if (!destCoords) {
    return waClient.sendText(phone,
      `❌ Could not find "*${s.destText}*" on the map. Please be more specific.\n\n` +
      'Reply *Restart* to try again.'
    );
  }

  const user = userService.getUserByPhone(phone);
  const ride = rideService.createRide({
    driverId: user.UserID,
    pickupLocation: s.pickupText,
    pickupLat: pickupCoords.lat,
    pickupLng: pickupCoords.lng,
    destination: s.destText,
    destLat: destCoords.lat,
    destLng: destCoords.lng,
    departureTime: s.departureTime,
    totalSeats: s.totalSeats,
    pricePerSeat: s.pricePerSeat,
    vehicleType: s.vehicleType,
  });

  sessionManager.clearSession(phone);
  console.log(`[OfferRide] New ride #${ride.RideID} by ${user.Name} (${phone})`);

  await waClient.sendText(phone,
    `🎉 *Ride Posted!* Ride ID: #${ride.RideID}\n\n` +
    `📍 ${s.pickupText} → ${s.destText}\n` +
    `🕐 ${s.departureDisplay}\n` +
    `💺 ${s.totalSeats} seat(s) | ₹${s.pricePerSeat}/seat\n\n` +
    'Employees will be able to find and book your ride. You\'ll get a notification when someone books!\n\n' +
    'Reply *Menu* to go back.'
  );
}

module.exports = { start, handle };
