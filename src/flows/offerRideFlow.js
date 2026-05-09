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

  const lastRide = rideService.getLastRideByDriver(user.UserID);
  if (lastRide) {
    const vehicleLabel = lastRide.VehicleType.charAt(0).toUpperCase() + lastRide.VehicleType.slice(1);
    sessionManager.setSession(phone, {
      flow: FLOWS.OFFER_RIDE,
      step: STEPS.OFFER_ASK_REPEAT,
      data: { lastRide },
    });
    return waClient.sendButtons(phone,
      `🔄 *Previous Route Found*\n\n` +
      `📍 ${lastRide.PickupLocation} → ${lastRide.Destination}\n` +
      `🚗 ${vehicleLabel} | 💺 ${lastRide.TotalSeats} seat(s)\n\n` +
      'Post the same route again?',
      [
        { id: 'repeat_yes',    title: '✅ Same Route' },
        { id: 'repeat_return', title: '🔄 Return Ride' },
        { id: 'repeat_no',     title: '🆕 New Ride' },
      ]
    );
  }

  sessionManager.setSession(phone, { flow: FLOWS.OFFER_RIDE, step: STEPS.OFFER_ASK_PICKUP_LOC, data: {} });
  await askPickupLocation(phone);
}

// ─── Text input dispatcher ────────────────────────────────────────────────────

async function handle(phone, text, session) {
  switch (session.step) {
    case STEPS.OFFER_ASK_REPEAT:       return handleRepeat(phone, text, session);
    case STEPS.OFFER_ASK_PICKUP_LOC:   return handlePickupText(phone, text, session);
    case STEPS.OFFER_ASK_DEST_LOC:     return handleDestText(phone, text, session);
    case STEPS.OFFER_ASK_TIME:         return handleTime(phone, text, session);
    case STEPS.OFFER_ASK_SEATS:        return handleSeats(phone, text, session);
    case STEPS.OFFER_ASK_VEHICLE:      return handleVehicle(phone, text, session);
    case STEPS.OFFER_ASK_VEHICLE_NUM:  return handleVehicleNum(phone, text, session);
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
  await waClient.sendText(phone, "📍 Got your location! Let's continue — please answer the current question. 😊");
}

// ─── Step handlers ────────────────────────────────────────────────────────────

async function handleRepeat(phone, text, session) {
  const t = text.trim().toLowerCase();
  const { lastRide } = session.data;

  if (['repeat_yes', 'yes', '✅ same route'].includes(t)) {
    const pricePerSeat = mapsService.calculatePrice(lastRide.DistanceKm || 0, lastRide.VehicleType || 'car');
    sessionManager.setSession(phone, {
      step: STEPS.OFFER_ASK_TIME,
      data: {
        pickupText:     lastRide.PickupLocation,
        pickupLat:      lastRide.PickupLat,
        pickupLng:      lastRide.PickupLng,
        destText:       lastRide.Destination,
        destLat:        lastRide.DestLat,
        destLng:        lastRide.DestLng,
        vehicleType:    lastRide.VehicleType,
        totalSeats:     lastRide.TotalSeats,
        ridePreference: lastRide.RidePreference,
        distanceKm:     lastRide.DistanceKm || 0,
        vehicleNumber:  lastRide.VehicleNumber || null,
        pricePerSeat,
      },
    });
    return waClient.sendText(phone,
      `✅ *Same Route Loaded*\n\n` +
      `📍 ${lastRide.PickupLocation} → ${lastRide.Destination}\n\n` +
      `🕐 *What time is the departure?*\n_(e.g. 09:00, 17:30 or tomorrow 08:30)_\n\n` +
      '_Reply *cancel* to go back._'
    );
  }

  if (['repeat_return', '🔄 return ride'].includes(t)) {
    // Swap pickup and destination
    const pricePerSeat = mapsService.calculatePrice(lastRide.DistanceKm || 0, lastRide.VehicleType || 'car');
    sessionManager.setSession(phone, {
      step: STEPS.OFFER_ASK_TIME,
      data: {
        pickupText:     lastRide.Destination,
        pickupLat:      lastRide.DestLat,
        pickupLng:      lastRide.DestLng,
        destText:       lastRide.PickupLocation,
        destLat:        lastRide.PickupLat,
        destLng:        lastRide.PickupLng,
        vehicleType:    lastRide.VehicleType,
        totalSeats:     lastRide.TotalSeats,
        ridePreference: lastRide.RidePreference,
        distanceKm:     lastRide.DistanceKm || 0,
        vehicleNumber:  lastRide.VehicleNumber || null,
        pricePerSeat,
      },
    });
    return waClient.sendText(phone,
      `🔄 *Return Ride Loaded*\n\n` +
      `📍 ${lastRide.Destination} → ${lastRide.PickupLocation}\n\n` +
      `🕐 *What time is the departure?*\n_(e.g. 09:00, 17:30 or tomorrow 08:30)_\n\n` +
      '_Reply *cancel* to go back._'
    );
  }

  // "New Ride"
  sessionManager.setSession(phone, { step: STEPS.OFFER_ASK_PICKUP_LOC, data: {} });
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

async function handlePickupText(phone, text, session) {
  if (!isValidAreaText(text)) {
    return waClient.sendText(phone,
      '❌ Please enter a valid area name.\n_(e.g. *Miyapur Metro*, *Kondapur Bus Stop*)_\n\n📍 *Pickup Location:*'
    );
  }
  const coords = await mapsService.geocodeAddress(text);
  const pickupText = text.trim();
  sessionManager.setSession(phone, {
    step: STEPS.OFFER_ASK_DEST_LOC,
    data: { pickupText, pickupLat: coords ? coords.lat : 0, pickupLng: coords ? coords.lng : 0 },
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

async function processDestLocation(phone, loc, session) {
  if (!loc.lat || !loc.lng) {
    return waClient.sendText(phone, '❌ Could not read coordinates. Please try sharing the location again.');
  }

  const displayName = await mapsService.getDisplayName(loc.lat, loc.lng, loc.name, loc.address);
  const { pickupLat, pickupLng } = session.data;
  const distanceKm = (pickupLat && pickupLng)
    ? mapsService.haversineDistance(pickupLat, pickupLng, loc.lat, loc.lng)
    : 0;

  sessionManager.setSession(phone, {
    step: STEPS.OFFER_ASK_TIME,
    data: { destText: displayName, destLat: loc.lat, destLng: loc.lng, distanceKm },
  });

  const distNote = distanceKm > 0 ? `\n📏 Distance: ~${distanceKm.toFixed(1)} km` : '';
  await waClient.sendText(phone,
    `✅ Destination: *${displayName}*${distNote}\n\n🕐 *Departure Time:*\n_(e.g. 09:00, 17:30 or tomorrow 08:30)_`
  );
}

async function handleDestText(phone, text, session) {
  if (!isValidAreaText(text)) {
    return waClient.sendText(phone,
      '❌ Please enter a valid destination name.\n_(e.g. *Gachibowli*, *HITEC City*)_\n\n🏁 *Destination:*'
    );
  }
  const coords = await mapsService.geocodeAddress(text);
  const destLat = coords ? coords.lat : 0;
  const destLng = coords ? coords.lng : 0;
  const { pickupLat, pickupLng } = session.data;
  const distanceKm = (pickupLat && pickupLng && destLat && destLng)
    ? mapsService.haversineDistance(pickupLat, pickupLng, destLat, destLng)
    : 0;

  sessionManager.setSession(phone, {
    step: STEPS.OFFER_ASK_TIME,
    data: { destText: text.trim(), destLat, destLng, distanceKm },
  });

  const distNote = distanceKm > 0 ? `\n📏 Distance: ~${distanceKm.toFixed(1)} km` : '';
  await waClient.sendText(phone,
    `✅ Destination: *${text.trim()}*${distNote}\n\n🕐 *Departure Time:*\n_(e.g. 09:00, 17:30 or tomorrow 08:30)_`
  );
}

async function handleTime(phone, text, session) {
  const parsed = parseTimeInput(text);
  if (!parsed) {
    return waClient.sendText(phone,
      '❌ Couldn\'t understand that time.\n_(e.g. *09:00*, *17:30*, *tomorrow 08:30*)_\n\n🕐 *Departure Time:*'
    );
  }
  const departureTime = formatDateForDb(parsed);
  const display = formatDepartureTime(departureTime);

  const s = session.data;
  if (s.vehicleType && s.totalSeats && s.ridePreference) {
    // Repeat path — all route data loaded
    if (s.vehicleNumber) {
      // Vehicle number also available — go straight to confirm
      sessionManager.setSession(phone, { step: STEPS.OFFER_CONFIRM, data: { departureTime, departureDisplay: display } });
      const updated = sessionManager.getSession(phone).data;
      const vehicleLabel = updated.vehicleType.charAt(0).toUpperCase() + updated.vehicleType.slice(1);
      return waClient.sendButtons(phone,
        `📋 *Ride Summary*\n\n` +
        `📍 From: ${updated.pickupText}\n` +
        `🏁 To: ${updated.destText}\n` +
        `📏 Distance: ~${(updated.distanceKm || 0).toFixed(1)} km\n` +
        `🕐 Time: ${display}\n` +
        `💺 Seats: ${updated.totalSeats}\n` +
        `💰 Price: ₹${updated.pricePerSeat}/seat\n` +
        `🚗 Vehicle: ${vehicleLabel} (${updated.vehicleNumber})\n\n` +
        'Confirm this ride?',
        [
          { id: 'offer_yes', title: '✅ Yes, Post Ride' },
          { id: 'offer_no',  title: '❌ Cancel' },
        ]
      );
    }
    // No vehicle number — ask for it
    sessionManager.setSession(phone, { step: STEPS.OFFER_ASK_VEHICLE_NUM, data: { departureTime, departureDisplay: display } });
    return waClient.sendText(phone,
      `✅ Departure: *${display}*\n\n🔑 *Vehicle Number:*\n_(e.g. TS09AB1234)_`
    );
  }

  // Normal path — continue step by step
  sessionManager.setSession(phone, { step: STEPS.OFFER_ASK_SEATS, data: { departureTime, departureDisplay: display } });
  await waClient.sendButtons(phone,
    `✅ Departure: *${display}*\n\n💺 *How many seats are available?*`,
    [
      { id: 'seats_1', title: '1' },
      { id: 'seats_2', title: '2' },
      { id: 'seats_3', title: '3' },
      { id: 'seats_4', title: '4' },
      { id: 'seats_5', title: '5' },
      { id: 'seats_6', title: '6' },
    ]
  );
}

async function handleSeats(phone, text, session) {
  let inputText = text.trim().toLowerCase().startsWith('seats_')
    ? text.trim().toLowerCase().replace('seats_', '')
    : text.trim();

  if (!isValidSeats(inputText)) {
    return waClient.sendButtons(phone, '❌ Please choose the number of seats:',
      [
        { id: 'seats_1', title: '1' },
        { id: 'seats_2', title: '2' },
        { id: 'seats_3', title: '3' },
        { id: 'seats_4', title: '4' },
        { id: 'seats_5', title: '5' },
        { id: 'seats_6', title: '6' },
      ]
    );
  }
  const seats = parseInt(inputText, 10);

  if (seats > 1) {
    const s = sessionManager.getSession(phone).data;
    const distanceKm = s.distanceKm || 0;
    const pricePerSeat = mapsService.calculatePrice(distanceKm, 'car');
    sessionManager.setSession(phone, {
      step: STEPS.OFFER_ASK_VEHICLE_NUM,
      data: { totalSeats: seats, vehicleType: 'car', ridePreference: 'all', pricePerSeat },
    });
    return waClient.sendText(phone,
      `✅ ${seats} seats | 🚗 Car\n\n🔑 *Vehicle Number:*\n_(e.g. TS09AB1234)_`
    );
  }

  sessionManager.setSession(phone, { step: STEPS.OFFER_ASK_VEHICLE, data: { totalSeats: seats } });
  await waClient.sendButtons(phone,
    `✅ Seats: *${seats}*\n\n🚗 *Vehicle Type:*`,
    [
      { id: 'v_car',  title: '🚗 Car' },
      { id: 'v_bike', title: '🏍️ Bike' },
    ]
  );
}

async function handleVehicle(phone, text, session) {
  const map = {
    v_car: 'car', car: 'car', '🚗 car': 'car',
    v_bike: 'bike', bike: 'bike', '🏍️ bike': 'bike',
  };
  const vehicleType = map[text.trim().toLowerCase()];
  if (!vehicleType) {
    return waClient.sendButtons(phone, '🚗 Please choose your vehicle type:',
      [
        { id: 'v_car',  title: '🚗 Car' },
        { id: 'v_bike', title: '🏍️ Bike' },
      ]
    );
  }
  const s = sessionManager.getSession(phone).data;
  const distanceKm = s.distanceKm || 0;
  const pricePerSeat = mapsService.calculatePrice(distanceKm, vehicleType);
  sessionManager.setSession(phone, { step: STEPS.OFFER_ASK_VEHICLE_NUM, data: { vehicleType, ridePreference: 'all', pricePerSeat } });
  await waClient.sendText(phone,
    `✅ Vehicle: *${vehicleType.charAt(0).toUpperCase() + vehicleType.slice(1)}*\n\n🔑 *Vehicle Number:*\n_(e.g. TS09AB1234)_`
  );
}


async function handleVehicleNum(phone, text, session) {
  const vNum = text.trim().toUpperCase();
  if (vNum.length < 4 || vNum.length > 15) {
    return waClient.sendText(phone,
      '❌ Please enter a valid vehicle number.\n_(e.g. TS09AB1234)_\n\n🔑 *Vehicle Number:*'
    );
  }

  sessionManager.setSession(phone, { step: STEPS.OFFER_CONFIRM, data: { vehicleNumber: vNum } });
  const s = sessionManager.getSession(phone).data;

  const vehicleLabel = s.vehicleType.charAt(0).toUpperCase() + s.vehicleType.slice(1);

  await waClient.sendButtons(phone,
    `📋 *Ride Summary*\n\n` +
    `📍 From: ${s.pickupText}\n` +
    `🏁 To: ${s.destText}\n` +
    `📏 Distance: ~${(s.distanceKm || 0).toFixed(1)} km\n` +
    `🕐 Time: ${s.departureDisplay}\n` +
    `💺 Seats: ${s.totalSeats}\n` +
    `💰 Price: ₹${s.pricePerSeat}/seat\n` +
    `🚗 Vehicle: ${vehicleLabel} (${vNum})\n\n` +
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
    vehicleName:    null,
    vehicleNumber:  s.vehicleNumber || null,
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
    ridePreference: 'all',
    distanceKm:     s.distanceKm,
  });

  sessionManager.clearSession(phone);
  console.log(`[OfferRide] Ride #${ride.RideID} by ${user.Name}`);

  const vehicleLabel = s.vehicleType.charAt(0).toUpperCase() + s.vehicleType.slice(1);
  const vehicleStr = s.vehicleNumber ? ` (${s.vehicleNumber})` : '';

  await waClient.sendText(phone,
    `🎉 *Ride Posted Successfully!*\n\n` +
    `🆔 Ride ID: #${ride.RideID}\n` +
    `📍 ${s.pickupText} → ${s.destText}\n` +
    `📏 Distance: ~${(s.distanceKm || 0).toFixed(1)} km\n` +
    `🕐 ${s.departureDisplay}\n` +
    `💺 ${s.totalSeats} seat(s) | 💰 ₹${s.pricePerSeat}/seat\n` +
    `🚗 ${vehicleLabel}${vehicleStr}\n\n` +
    '✅ Colleagues can now find and book your ride.\n' +
    "📲 You'll get a Telegram notification when someone books!\n\n" +
    '📍 *Tip:* When your ride starts, share your live location here — the bot will forward it to your passengers.'
  );

  return waClient.sendButtons(phone,
    '_What would you like to do next?_',
    [
      { id: 'pf_menu', title: '📋 Main Menu' },
    ]
  );
}

// Called from postTripFlow when driver wants to re-use the same route
async function startWithRoute(phone, user, savedRoute) {
  if (!user) user = userService.getUserByPhone(phone);

  const pricePerSeat = mapsService.calculatePrice(savedRoute.distanceKm || 0, savedRoute.vehicleType || 'car');

  sessionManager.setSession(phone, {
    flow: FLOWS.OFFER_RIDE,
    step: STEPS.OFFER_ASK_TIME,
    data: {
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
      vehicleNumber:  savedRoute.vehicleNumber || null,
      pricePerSeat,
    },
  });

  await waClient.sendText(phone,
    `✅ *Same Route Loaded*\n\n` +
    `📍 ${savedRoute.pickupText} → ${savedRoute.destText}\n\n` +
    `🕐 *What time is the departure tomorrow?*\n_(e.g. 09:00, 08:30)_\n\n` +
    '_Reply *cancel* to go back._'
  );
}

module.exports = { start, startWithRoute, handle, handleLocation };
