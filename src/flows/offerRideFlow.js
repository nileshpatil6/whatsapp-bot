'use strict';

const waClient = require('../whatsapp/client');
const sessionManager = require('../state/sessionManager');
const rideService = require('../services/rideService');
const mapsService = require('../services/mapsService');
const userService = require('../services/userService');
const { FLOWS, STEPS } = require('../utils/constants');
const { isValidAreaText, isValidSeats, parseTimeInput, formatDateForDb } = require('../utils/validators');
const { formatDepartureTime } = require('../utils/formatters');

// ─── Entry point ──────────────────────────────────────────────────────────────

async function start(phone, user) {
  if (!user) user = userService.getUserByPhone(phone);

  sessionManager.setSession(phone, {
    flow: FLOWS.OFFER_RIDE,
    step: STEPS.OFFER_ASK_VEHICLE_NAME,
    data: {},
  });

  await waClient.sendText(phone,
    '🚗 *Offer a Ride*\n\n' +
    "Let's post your ride step by step.\n\n" +
    '🏷️ *Vehicle Name / Model (optional):*\n' +
    '_(e.g. Honda Activa, Maruti Swift)_\n\n' +
    '_Reply *skip* to leave it blank._\n\n' +
    '_Reply *cancel* anytime to go back._'
  );
}

// ─── Text input dispatcher ────────────────────────────────────────────────────

async function handle(phone, text, session) {
  switch (session.step) {
    case STEPS.OFFER_ASK_VEHICLE_NAME: return handleVehicleName(phone, text, session);
    case STEPS.OFFER_ASK_PICKUP_LOC:   return handlePickupText(phone, text, session);
    case STEPS.OFFER_ASK_DEST_LOC:     return handleDestText(phone, text, session);
    case STEPS.OFFER_ASK_TIME:         return handleTime(phone, text, session);
    case STEPS.OFFER_ASK_SEATS:        return handleSeats(phone, text, session);
    case STEPS.OFFER_ASK_VEHICLE:      return handleVehicle(phone, text, session);
    case STEPS.OFFER_ASK_PREFERENCE:   return handlePreference(phone, text, session);
    case STEPS.OFFER_CONFIRM:          return handleConfirm(phone, text, session);
    default: return start(phone);
  }
}

// ─── Location message dispatcher ─────────────────────────────────────────────

async function handleLocation(phone, locationData, session) {
  if (session.step === STEPS.OFFER_ASK_PICKUP_LOC) {
    return processPickupLocation(phone, locationData, session);
  }
  if (session.step === STEPS.OFFER_ASK_DEST_LOC) {
    return processDestLocation(phone, locationData, session);
  }
  // Location received at wrong step — give a nudge
  await waClient.sendText(phone, "📍 Got your location! Let's continue — please answer the current question. 😊");
}

// ─── Step handlers ────────────────────────────────────────────────────────────

async function handleVehicleName(phone, text, session) {
  const t = text.trim();
  const vehicleName = ['skip', 'no', '-', 'none', 'n/a'].includes(t.toLowerCase()) ? null : t;

  sessionManager.setSession(phone, {
    step: STEPS.OFFER_ASK_PICKUP_LOC,
    data: { vehicleName },
  });

  await askPickupLocation(phone);
}

async function askPickupLocation(phone) {
  await waClient.sendLocationRequest(phone,
    '📍 *Pickup Location*\n\n' +
    'Please share your pickup spot using the *Send Location* button below.\n\n' +
    'You can search for a specific place (e.g. "Miyapur Metro") or share your current location.\n\n' +
    '_Or type your area name as text (e.g. Miyapur Metro, Kondapur Bus Stop)_'
  );
}

// WhatsApp location pin received for pickup
async function processPickupLocation(phone, loc, session) {
  if (!loc.lat || !loc.lng) {
    return waClient.sendText(phone, '❌ Could not read coordinates. Please try sharing the location again.');
  }

  const displayName = await mapsService.getDisplayName(loc.lat, loc.lng, loc.name, loc.address);
  sessionManager.setSession(phone, {
    step: STEPS.OFFER_ASK_DEST_LOC,
    data: { pickupText: displayName, pickupLat: loc.lat, pickupLng: loc.lng },
  });

  const user = userService.getUserByPhone(phone);
  const officeSuggestion = user && user.OfficeLocation
    ? `\n💡 Your office: *${user.OfficeLocation}*`
    : '';

  await waClient.sendLocationRequest(phone,
    `✅ Pickup: *${displayName}*\n\n` +
    `🏁 *Destination*${officeSuggestion}\n\n` +
    'Share your destination location — search for the office/area or drop a pin.\n\n' +
    '_Or type the destination name as text_'
  );
}

// Text fallback for pickup
async function handlePickupText(phone, text, session) {
  if (!isValidAreaText(text)) {
    return waClient.sendText(phone,
      '❌ Please enter a valid area name.\n_(e.g. *Miyapur Metro*, *Kondapur Bus Stop*)_\n\n📍 *Pickup Location:*'
    );
  }
  await waClient.sendText(phone, '⏳ Looking up location...');

  const coords = await mapsService.geocodeAddress(text);
  if (!coords) {
    return waClient.sendText(phone,
      `❌ Couldn't find "*${text.trim()}*" on the map.\nTry a more specific name.\n\n📍 *Pickup Location:*`
    );
  }

  const pickupText = text.trim();
  sessionManager.setSession(phone, {
    step: STEPS.OFFER_ASK_DEST_LOC,
    data: { pickupText, pickupLat: coords.lat, pickupLng: coords.lng },
  });

  const user = userService.getUserByPhone(phone);
  const officeSuggestion = user && user.OfficeLocation
    ? `\n💡 Your office: *${user.OfficeLocation}*`
    : '';

  await waClient.sendLocationRequest(phone,
    `✅ Pickup: *${pickupText}*\n\n` +
    `🏁 *Destination*${officeSuggestion}\n\n` +
    'Share your destination location or type the area name.'
  );
}

// WhatsApp location pin received for destination
async function processDestLocation(phone, loc, session) {
  if (!loc.lat || !loc.lng) {
    return waClient.sendText(phone, '❌ Could not read coordinates. Please try sharing the location again.');
  }

  const displayName = await mapsService.getDisplayName(loc.lat, loc.lng, loc.name, loc.address);
  sessionManager.setSession(phone, {
    step: STEPS.OFFER_ASK_TIME,
    data: { destText: displayName, destLat: loc.lat, destLng: loc.lng },
  });

  await waClient.sendText(phone,
    `✅ Destination: *${displayName}*\n\n🕐 *Departure Time:*\n_(e.g. 9 AM, 8:30 AM, tomorrow 9 AM)_`
  );
}

// Text fallback for destination
async function handleDestText(phone, text, session) {
  if (!isValidAreaText(text)) {
    return waClient.sendText(phone,
      '❌ Please enter a valid destination name.\n_(e.g. *Gachibowli*, *HITEC City*)_\n\n🏁 *Destination:*'
    );
  }
  await waClient.sendText(phone, '⏳ Looking up location...');

  const coords = await mapsService.geocodeAddress(text);
  if (!coords) {
    return waClient.sendText(phone,
      `❌ Couldn't find "*${text.trim()}*" on the map.\nTry a more specific name.\n\n🏁 *Destination:*`
    );
  }

  sessionManager.setSession(phone, {
    step: STEPS.OFFER_ASK_TIME,
    data: { destText: text.trim(), destLat: coords.lat, destLng: coords.lng },
  });

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

  // If this is a same-route re-offer (seats, vehicle, preference already stored), jump to confirm
  const s = session.data;
  if (s.vehicleType && s.totalSeats && s.ridePreference) {
    sessionManager.setSession(phone, { step: STEPS.OFFER_CONFIRM, data: { departureTime, departureDisplay: display } });
    const prefStr = s.ridePreference === 'women_only' ? '👩 Women Only' : '🌐 Open to All';
    const vehicleLabel = s.vehicleType.charAt(0).toUpperCase() + s.vehicleType.slice(1);
    const vehicleDisplay = s.vehicleName ? `${vehicleLabel} (${s.vehicleName})` : vehicleLabel;
    const updated = sessionManager.getSession(phone).data;
    return waClient.sendButtons(phone,
      `📋 *Ride Summary*\n\n` +
      `📍 From: ${updated.pickupText}\n` +
      `🏁 To: ${updated.destText}\n` +
      `📏 Distance: ~${(updated.distanceKm || 0).toFixed(1)} km\n` +
      `🕐 Time: ${display}\n` +
      `💺 Seats: ${updated.totalSeats}\n` +
      `💰 Price: ₹${updated.pricePerSeat}/seat\n` +
      `🚗 Vehicle: ${vehicleDisplay}\n` +
      `🎯 Preference: ${prefStr}\n\n` +
      'Confirm this ride?',
      [
        { id: 'offer_yes', title: '✅ Yes, Post Ride' },
        { id: 'offer_no',  title: '❌ Cancel' },
      ]
    );
  }

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
  sessionManager.setSession(phone, { step: STEPS.OFFER_ASK_VEHICLE, data: { totalSeats: parseInt(text.trim(), 10) } });
  await waClient.sendButtons(phone,
    `✅ Seats: *${text.trim()}*\n\n🚗 *Vehicle Type:*`,
    [
      { id: 'v_car',  title: '🚗 Car' },
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
        { id: 'v_car',  title: '🚗 Car' },
        { id: 'v_bike', title: '🏍️ Bike' },
        { id: 'v_auto', title: '🛺 Auto' },
      ]
    );
  }
  sessionManager.setSession(phone, { step: STEPS.OFFER_ASK_PREFERENCE, data: { vehicleType } });
  await waClient.sendButtons(phone,
    `✅ Vehicle: *${vehicleType.charAt(0).toUpperCase() + vehicleType.slice(1)}*\n\n🎯 *Ride Preference:*`,
    [
      { id: 'pref_all',   title: '🌐 Open to All' },
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
        { id: 'pref_all',   title: '🌐 Open to All' },
        { id: 'pref_women', title: '👩 Women Only' },
      ]
    );
  }

  sessionManager.setSession(phone, { step: STEPS.OFFER_CONFIRM, data: { ridePreference } });
  const s = sessionManager.getSession(phone).data;

  // Auto-calculate price from pickup → destination distance
  const distanceKm = mapsService.haversineDistance(s.pickupLat, s.pickupLng, s.destLat, s.destLng);
  const pricePerSeat = mapsService.calculatePrice(distanceKm, s.vehicleType);
  sessionManager.setSession(phone, { data: { distanceKm, pricePerSeat } });

  const prefStr = ridePreference === 'women_only' ? '👩 Women Only' : '🌐 Open to All';
  const vehicleLabel = s.vehicleType.charAt(0).toUpperCase() + s.vehicleType.slice(1);
  const vehicleDisplay = s.vehicleName ? `${vehicleLabel} (${s.vehicleName})` : vehicleLabel;

  await waClient.sendButtons(phone,
    `📋 *Ride Summary*\n\n` +
    `📍 From: ${s.pickupText}\n` +
    `🏁 To: ${s.destText}\n` +
    `📏 Distance: ~${distanceKm.toFixed(1)} km\n` +
    `🕐 Time: ${s.departureDisplay}\n` +
    `💺 Seats: ${s.totalSeats}\n` +
    `💰 Price: ₹${pricePerSeat}/seat _(auto-calculated)_\n` +
    `🚗 Vehicle: ${vehicleDisplay}\n` +
    `🎯 Preference: ${prefStr}\n\n` +
    'Confirm this ride?',
    [
      { id: 'offer_yes', title: '✅ Yes, Post Ride' },
      { id: 'offer_no',  title: '❌ Cancel' },
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
        { id: 'offer_no',  title: '❌ Cancel' },
      ]
    );
  }

  const s = session.data;
  const user = userService.getUserByPhone(phone);

  const ride = rideService.createRide({
    driverId:       user.UserID,
    vehicleName:    s.vehicleName || null,
    pickupLocation: s.pickupText,
    pickupLat:      s.pickupLat,
    pickupLng:      s.pickupLng,
    destination:    s.destText,
    destLat:        s.destLat,
    destLng:        s.destLng,
    departureTime:  s.departureTime,
    totalSeats:     s.totalSeats,
    pricePerSeat:   s.pricePerSeat,
    vehicleType:    s.vehicleType,
    ridePreference: s.ridePreference,
    distanceKm:     s.distanceKm,
  });

  sessionManager.clearSession(phone);
  console.log(`[OfferRide] Ride #${ride.RideID} by ${user.Name}`);

  const vehicleLabel = s.vehicleType.charAt(0).toUpperCase() + s.vehicleType.slice(1);
  const vehicleDisplay = s.vehicleName ? `${vehicleLabel} (${s.vehicleName})` : vehicleLabel;

  await waClient.sendText(phone,
    `🎉 *Ride Posted Successfully!*\n\n` +
    `🆔 Ride ID: #${ride.RideID}\n` +
    `📍 ${s.pickupText} → ${s.destText}\n` +
    `📏 Distance: ~${s.distanceKm.toFixed(1)} km\n` +
    `🕐 ${s.departureDisplay}\n` +
    `💺 ${s.totalSeats} seat(s) | 💰 ₹${s.pricePerSeat}/seat\n` +
    `🚗 ${vehicleDisplay}\n\n` +
    '✅ Colleagues can now find and book your ride.\n' +
    "📲 You'll get a WhatsApp notification when someone books!\n\n" +
    '📍 *Tip:* When your ride starts, share your live location here — the bot will forward it to your passengers.\n\n' +
    'Reply *menu* to go back.'
  );
}

// Called from postTripFlow when driver wants to re-use the same route
// Skips vehicle name + location steps and jumps straight to time
async function startWithRoute(phone, user, savedRoute) {
  if (!user) user = userService.getUserByPhone(phone);

  const mapsService = require('../services/mapsService');
  const pricePerSeat = mapsService.calculatePrice(savedRoute.distanceKm || 0, savedRoute.vehicleType || 'car');

  sessionManager.setSession(phone, {
    flow: FLOWS.OFFER_RIDE,
    step: STEPS.OFFER_ASK_TIME,
    data: {
      vehicleName:    savedRoute.vehicleName || null,
      pickupText:     savedRoute.pickupText,
      pickupLat:      savedRoute.pickupLat,
      pickupLng:      savedRoute.pickupLng,
      destText:       savedRoute.destText,
      destLat:        savedRoute.destLat,
      destLng:        savedRoute.destLng,
      vehicleType:    savedRoute.vehicleType,
      totalSeats:     savedRoute.totalSeats,
      ridePreference: savedRoute.ridePreference,
      distanceKm:     savedRoute.distanceKm || 0,
      pricePerSeat,
    },
  });

  await waClient.sendText(phone,
    `✅ *Same Route Loaded*\n\n` +
    `📍 ${savedRoute.pickupText} → ${savedRoute.destText}\n\n` +
    `🕐 *What time is the departure tomorrow?*\n_(e.g. 9 AM, 8:30 AM)_\n\n` +
    '_Reply *cancel* to go back._'
  );
}

module.exports = { start, startWithRoute, handle, handleLocation };
