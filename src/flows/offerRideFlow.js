'use strict';

const waClient = require('../whatsapp/client');
const sessionManager = require('../state/sessionManager');
const rideService = require('../services/rideService');
const mapsService = require('../services/mapsService');
const userService = require('../services/userService');
const { FLOWS, STEPS } = require('../utils/constants');
const { isValidAreaText, isValidSeats, isValidPrice, parseTimeInput, formatDateForDb } = require('../utils/validators');
const { formatDepartureTime } = require('../utils/formatters');

async function start(phone, user) {
  if (!user) user = userService.getUserByPhone(phone);

  sessionManager.setSession(phone, {
    flow: FLOWS.OFFER_RIDE,
    step: STEPS.OFFER_ASK_PICKUP,
    data: {},
  });

  // Smart pre-fill: suggest saved home area
  const suggestion = user && user.HomeArea
    ? `\n\n💡 Your saved home area: *${user.HomeArea}*\n_Type it or enter a different one_`
    : '';

  await waClient.sendText(phone,
    '🚗 *Offer a Ride*\n\n' +
    'Share the following details step by step.\n\n' +
    `📍 *Pickup Location:*${suggestion}\n\n` +
    '_(e.g. Kondapur Bus Stop, Miyapur Metro)_\n\n' +
    '_Reply *cancel* anytime to go back._'
  );
}

async function handle(phone, text, session) {
  switch (session.step) {
    case STEPS.OFFER_ASK_PICKUP:     return handlePickup(phone, text, session);
    case STEPS.OFFER_ASK_DEST:       return handleDest(phone, text, session);
    case STEPS.OFFER_ASK_TIME:       return handleTime(phone, text, session);
    case STEPS.OFFER_ASK_SEATS:      return handleSeats(phone, text, session);
    case STEPS.OFFER_ASK_PRICE:      return handlePrice(phone, text, session);
    case STEPS.OFFER_ASK_VEHICLE:    return handleVehicle(phone, text, session);
    case STEPS.OFFER_ASK_PREFERENCE: return handlePreference(phone, text, session);
    case STEPS.OFFER_CONFIRM:        return handleConfirm(phone, text, session);
    default: return start(phone);
  }
}

async function handlePickup(phone, text, session) {
  // Allow user to confirm their saved area by typing it or writing "same"/"yes"
  const user = userService.getUserByPhone(phone);
  let pickup = text.trim();

  if (!isValidAreaText(pickup)) {
    return waClient.sendText(phone,
      '❌ Please enter a valid pickup area with letters.\n_(e.g. *Kondapur*, *Miyapur Metro*)_\n\n📍 *Pickup Location:*'
    );
  }

  sessionManager.setSession(phone, { step: STEPS.OFFER_ASK_DEST, data: { pickupText: pickup } });

  const suggestion = user && user.OfficeLocation
    ? `\n\n💡 Your office: *${user.OfficeLocation}*\n_Type it or enter a different one_`
    : '';

  await waClient.sendText(phone,
    `✅ Pickup: *${pickup}*\n\n🏁 *Destination:*${suggestion}\n\n_(e.g. Gachibowli, HITEC City)_`
  );
}

async function handleDest(phone, text, session) {
  if (!isValidAreaText(text)) {
    return waClient.sendText(phone,
      '❌ Please enter a valid destination with letters.\n_(e.g. *Gachibowli*, *HITEC City*)_\n\n🏁 *Destination:*'
    );
  }
  sessionManager.setSession(phone, { step: STEPS.OFFER_ASK_TIME, data: { destText: text.trim() } });
  await waClient.sendText(phone,
    `✅ Destination: *${text.trim()}*\n\n🕐 *Departure Time:*\n_(e.g. 9 AM, 8:30 AM, tomorrow 9 AM)_`
  );
}

async function handleTime(phone, text, session) {
  const parsed = parseTimeInput(text);
  if (!parsed) {
    return waClient.sendText(phone,
      '❌ Couldn\'t understand that time.\n_(e.g. *9 AM*, *8:30 AM*, *tomorrow 9 AM*)_\n\n🕐 *Departure Time:*'
    );
  }
  const departureTime = formatDateForDb(parsed);
  const display = formatDepartureTime(departureTime);
  sessionManager.setSession(phone, { step: STEPS.OFFER_ASK_SEATS, data: { departureTime, departureDisplay: display } });
  await waClient.sendText(phone,
    `✅ Departure: *${display}*\n\n💺 *Total Seats Available:*\n_(Enter a number: 1–6)_`
  );
}

async function handleSeats(phone, text, session) {
  if (!isValidSeats(text)) {
    return waClient.sendText(phone,
      '❌ Please enter a number between 1 and 6.\n\n💺 *Total Seats Available:*'
    );
  }
  sessionManager.setSession(phone, { step: STEPS.OFFER_ASK_PRICE, data: { totalSeats: parseInt(text.trim(), 10) } });
  await waClient.sendText(phone,
    `✅ Seats: *${text.trim()}*\n\n💰 *Price per Seat (₹):*\n_(Enter 0 for free)_`
  );
}

async function handlePrice(phone, text, session) {
  if (!isValidPrice(text)) {
    return waClient.sendText(phone,
      '❌ Please enter a valid price (0–9999).\n\n💰 *Price per Seat (₹):*'
    );
  }
  sessionManager.setSession(phone, { step: STEPS.OFFER_ASK_VEHICLE, data: { pricePerSeat: parseInt(text.trim(), 10) } });
  await waClient.sendButtons(phone,
    `✅ Price: *₹${text.trim()}/seat*\n\n🚗 *Vehicle Type:*`,
    [
      { id: 'v_car', title: '🚗 Car' },
      { id: 'v_bike', title: '🏍️ Bike' },
      { id: 'v_auto', title: '🛺 Auto' },
    ]
  );
}

async function handleVehicle(phone, text, session) {
  const map = {
    v_car: 'car', car: 'car',
    v_bike: 'bike', bike: 'bike',
    v_auto: 'auto', auto: 'auto',
  };
  const vehicleType = map[text.trim().toLowerCase()];
  if (!vehicleType) {
    return waClient.sendButtons(phone, '🚗 Please choose your vehicle type:',
      [
        { id: 'v_car', title: '🚗 Car' },
        { id: 'v_bike', title: '🏍️ Bike' },
        { id: 'v_auto', title: '🛺 Auto' },
      ]
    );
  }
  sessionManager.setSession(phone, { step: STEPS.OFFER_ASK_PREFERENCE, data: { vehicleType } });
  await waClient.sendButtons(phone,
    `✅ Vehicle: *${vehicleType.charAt(0).toUpperCase() + vehicleType.slice(1)}*\n\n🎯 *Ride Preference:*`,
    [
      { id: 'pref_all', title: '🌐 Open to All' },
      { id: 'pref_women', title: '👩 Women Only' },
    ]
  );
}

async function handlePreference(phone, text, session) {
  const map = {
    pref_all: 'all', 'open to all': 'all', 'all': 'all', '🌐 open to all': 'all',
    pref_women: 'women_only', 'women only': 'women_only', 'women': 'women_only', '👩 women only': 'women_only',
  };
  const ridePreference = map[text.trim().toLowerCase()];
  if (!ridePreference) {
    return waClient.sendButtons(phone, '🎯 Please select ride preference:',
      [
        { id: 'pref_all', title: '🌐 Open to All' },
        { id: 'pref_women', title: '👩 Women Only' },
      ]
    );
  }

  sessionManager.setSession(phone, { step: STEPS.OFFER_CONFIRM, data: { ridePreference } });
  const s = sessionManager.getSession(phone).data;
  const priceStr = s.pricePerSeat === 0 ? 'Free 🎁' : `₹${s.pricePerSeat}/seat`;
  const prefStr = ridePreference === 'women_only' ? '👩 Women Only' : '🌐 Open to All';

  await waClient.sendButtons(phone,
    `📋 *Ride Summary*\n\n` +
    `📍 From: ${s.pickupText}\n` +
    `🏁 To: ${s.destText}\n` +
    `🕐 Time: ${s.departureDisplay}\n` +
    `💺 Seats: ${s.totalSeats}\n` +
    `💰 Price: ${priceStr}\n` +
    `🚗 Vehicle: ${s.vehicleType.charAt(0).toUpperCase() + s.vehicleType.slice(1)}\n` +
    `🎯 Preference: ${prefStr}\n\n` +
    'Confirm this ride?',
    [
      { id: 'offer_yes', title: '✅ Yes, Post Ride' },
      { id: 'offer_no', title: '❌ Cancel' },
    ]
  );
}

async function handleConfirm(phone, text, session) {
  const t = text.trim().toLowerCase();
  if (['offer_no', 'no', 'cancel', '❌ cancel'].includes(t)) {
    sessionManager.clearSession(phone);
    const user = userService.getUserByPhone(phone);
    await waClient.sendText(phone, 'Ride posting cancelled.');
    return require('./mainMenuFlow').show(phone, user);
  }

  if (!['offer_yes', 'yes', '✅ yes, post ride'].includes(t)) {
    return waClient.sendButtons(phone, 'Please confirm:',
      [
        { id: 'offer_yes', title: '✅ Yes, Post Ride' },
        { id: 'offer_no', title: '❌ Cancel' },
      ]
    );
  }

  const s = session.data;
  await waClient.sendText(phone, '⏳ Verifying locations on map...');

  const [pickupCoords, destCoords] = await Promise.all([
    mapsService.geocodeAddress(s.pickupText),
    mapsService.geocodeAddress(s.destText),
  ]);

  if (!pickupCoords) {
    return waClient.sendText(phone,
      `❌ Couldn't find "*${s.pickupText}*" on the map.\nTry a more specific area name.\n\nReply *offer* to try again.`
    );
  }
  if (!destCoords) {
    return waClient.sendText(phone,
      `❌ Couldn't find "*${s.destText}*" on the map.\nTry a more specific area name.\n\nReply *offer* to try again.`
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
    ridePreference: s.ridePreference,
  });

  sessionManager.clearSession(phone);
  console.log(`[OfferRide] Ride #${ride.RideID} by ${user.Name}`);

  await waClient.sendText(phone,
    `🎉 *Ride Posted Successfully!*\n\n` +
    `🆔 Ride ID: #${ride.RideID}\n` +
    `📍 ${s.pickupText} → ${s.destText}\n` +
    `🕐 ${s.departureDisplay}\n` +
    `💺 ${s.totalSeats} seat(s) | ₹${s.pricePerSeat}/seat\n\n` +
    '✅ Colleagues can now find and book your ride.\n' +
    "📲 You'll get a WhatsApp notification when someone books!\n\n" +
    'Reply *Menu* to go back.'
  );
}

module.exports = { start, handle };
