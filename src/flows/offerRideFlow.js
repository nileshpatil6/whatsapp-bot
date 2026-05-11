'use strict';

const waClient = require('../whatsapp/client');
const sessionManager = require('../state/sessionManager');
const rideService = require('../services/rideService');
const mapsService = require('../services/mapsService');
const userService = require('../services/userService');
const { FLOWS, STEPS } = require('../utils/constants');
const { isValidAreaText, isValidSeats, parseTimeInput, formatDateForDb } = require('../utils/validators');
const PLACE_NONE = 'place_none';
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
  const _t = text.trim().toLowerCase();
  if (['cancel', 'offer_cancel', '❌ cancel'].includes(_t) && session.step !== STEPS.OFFER_CONFIRM) {
    sessionManager.clearSession(phone);
    const _u = userService.getUserByPhone(phone);
    await waClient.sendText(phone, 'Cancelled.');
    return require('./mainMenuFlow').show(phone, _u);
  }
  switch (session.step) {
    case STEPS.OFFER_ASK_REPEAT:       return handleRepeat(phone, text, session);
    case STEPS.OFFER_ASK_PICKUP_LOC:   return handlePickupText(phone, text, session);
    case STEPS.OFFER_SELECT_PICKUP:    return handlePickupSelect(phone, text, session);
    case STEPS.OFFER_ASK_DEST_LOC:     return handleDestText(phone, text, session);
    case STEPS.OFFER_SELECT_DEST:      return handleDestSelect(phone, text, session);
    case STEPS.OFFER_ASK_TIME:         return handleTime(phone, text, session);
    case STEPS.OFFER_ASK_SEATS:        return handleSeats(phone, text, session);
    case STEPS.OFFER_ASK_VEHICLE:      return handleVehicle(phone, text, session);
    case STEPS.OFFER_ASK_VEHICLE_NUM:  return handleVehicleNum(phone, text, session);
    case STEPS.OFFER_ASK_ROUTE_CMD:    return handleRouteCmd(phone, text, session);
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
    const user = userService.getUserByPhone(phone);
    const dep = tomorrowSameTime(lastRide.DepartureTime);
    const departureTime = formatDateForDb(dep);
    const departureDisplay = formatDepartureTime(departureTime);
    const vNum = (user && user.VehicleNumber) || lastRide.VehicleNumber || null;
    const vType = (user && user.VehicleType) || lastRide.VehicleType || 'car';
    const pricePerSeat = mapsService.calculatePrice(lastRide.DistanceKm || 0, vType);
    const data = {
      pickupText: lastRide.PickupLocation, pickupLat: lastRide.PickupLat, pickupLng: lastRide.PickupLng,
      destText: lastRide.Destination, destLat: lastRide.DestLat, destLng: lastRide.DestLng,
      vehicleType: vType, totalSeats: lastRide.TotalSeats, ridePreference: lastRide.RidePreference,
      distanceKm: lastRide.DistanceKm || 0, vehicleNumber: vNum, pricePerSeat, departureTime, departureDisplay,
    };
    return loadedRouteContinue(phone, data, `✅ *Same Route Loaded*`, vNum, vType);
  }

  if (['repeat_return', '🔄 return ride'].includes(t)) {
    const user = userService.getUserByPhone(phone);
    const dep = tomorrowSameTime(lastRide.DepartureTime);
    const departureTime = formatDateForDb(dep);
    const departureDisplay = formatDepartureTime(departureTime);
    const vNum = (user && user.VehicleNumber) || lastRide.VehicleNumber || null;
    const vType = (user && user.VehicleType) || lastRide.VehicleType || 'car';
    const pricePerSeat = mapsService.calculatePrice(lastRide.DistanceKm || 0, vType);
    const data = {
      pickupText: lastRide.Destination, pickupLat: lastRide.DestLat, pickupLng: lastRide.DestLng,
      destText: lastRide.PickupLocation, destLat: lastRide.PickupLat, destLng: lastRide.PickupLng,
      vehicleType: vType, totalSeats: lastRide.TotalSeats, ridePreference: lastRide.RidePreference,
      distanceKm: lastRide.DistanceKm || 0, vehicleNumber: vNum, pricePerSeat, departureTime, departureDisplay,
    };
    return loadedRouteContinue(phone, data, `🔄 *Return Ride Loaded*`, vNum, vType);
  }

  // "New Ride"
  sessionManager.setSession(phone, { step: STEPS.OFFER_ASK_PICKUP_LOC, data: {} });
  await askPickupLocation(phone);
}

async function askPickupLocation(phone) {
  await waClient.sendLocationRequestWithSearch(phone,
    '📍 *Pickup Location*\n\n' +
    'Tap *Search Location* to find your pickup spot in real-time.\n\n' +
    '_Or type your area name (e.g. Miyapur Metro, Kondapur Bus Stop)_'
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

  await waClient.sendLocationRequestWithSearch(phone,
    `✅ Pickup: *${displayName}*\n\n` +
    `🏁 *Destination*${officeSuggestion}\n\n` +
    'Tap *Search Location* to find your destination.\n\n' +
    '_Or type the destination name as text_'
  );
}

async function handlePickupText(phone, text, session) {
  if (!isValidAreaText(text)) {
    return waClient.sendText(phone,
      '❌ Please enter a valid area name.\n_(e.g. *Miyapur Metro*, *Kondapur Bus Stop*)_\n\n📍 *Pickup Location:*'
    );
  }
  const places = await mapsService.searchPlaces(text);
  if (places.length === 1) {
    return applyPickupLocation(phone, places[0].name, places[0].lat, places[0].lng);
  }
  if (places.length > 1) {
    const btns = places.map((p, i) => ({ id: `place_${i}`, title: trunc(p.name, 40) }));
    btns.push({ id: PLACE_NONE, title: '🔄 Not found, retype' });
    sessionManager.setSession(phone, { step: STEPS.OFFER_SELECT_PICKUP, data: { pendingPlaces: places, typedText: text.trim() } });
    return waClient.sendButtons(phone,
      `📍 Select your pickup from the results for "*${text.trim()}*":`,
      btns
    );
  }
  // No API / no results — proceed with typed text, coords unknown
  return applyPickupLocation(phone, text.trim(), 0, 0);
}

async function handlePickupSelect(phone, text, session) {
  const t = text.trim().toLowerCase();
  const { pendingPlaces, typedText } = session.data;

  if (t === PLACE_NONE) {
    sessionManager.setSession(phone, { step: STEPS.OFFER_ASK_PICKUP_LOC, data: {} });
    return waClient.sendText(phone, '📍 *Pickup Location:*\n\nType the area name again:');
  }
  if (t.startsWith('place_')) {
    const idx = parseInt(t.replace('place_', ''), 10);
    const p = pendingPlaces[idx];
    if (p) return applyPickupLocation(phone, p.name, p.lat, p.lng);
  }
  // Re-show buttons
  const btns = pendingPlaces.map((p, i) => ({ id: `place_${i}`, title: trunc(p.name, 40) }));
  btns.push({ id: PLACE_NONE, title: '🔄 Not found, retype' });
  return waClient.sendButtons(phone, `📍 Select your pickup:`, btns);
}

async function applyPickupLocation(phone, pickupText, lat, lng) {
  sessionManager.setSession(phone, {
    step: STEPS.OFFER_ASK_DEST_LOC,
    data: { pickupText, pickupLat: lat, pickupLng: lng },
  });
  const user = userService.getUserByPhone(phone);
  const officeSuggestion = user && user.OfficeLocation ? `\n💡 Your office: *${user.OfficeLocation}*` : '';
  await waClient.sendLocationRequestWithSearch(phone,
    `✅ Pickup: *${pickupText}*\n\n🏁 *Destination*${officeSuggestion}\n\nTap *Search Location* or type the area name.`
  );
}

async function processDestLocation(phone, loc, session) {
  if (!loc.lat || !loc.lng) {
    return waClient.sendText(phone, '❌ Could not read coordinates. Please try sharing the location again.');
  }

  const displayName = await mapsService.getDisplayName(loc.lat, loc.lng, loc.name, loc.address);
  const { pickupLat, pickupLng } = session.data;
  const distanceKm = (pickupLat && pickupLng)
    ? await mapsService.getRouteDistance(pickupLat, pickupLng, loc.lat, loc.lng)
    : 0;

  sessionManager.setSession(phone, {
    step: STEPS.OFFER_ASK_TIME,
    data: { destText: displayName, destLat: loc.lat, destLng: loc.lng, distanceKm },
  });

  const distNote = distanceKm > 0 ? `\n📏 Distance: ~${distanceKm.toFixed(1)} km` : '';
  await waClient.sendButtons(phone,
    `✅ Destination: *${displayName}*${distNote}\n\n🕐 *Departure Time:*\n_(e.g. 09:00, 17:30 or tomorrow 08:30)_`,
    [{ id: 'offer_cancel', title: '❌ Cancel' }]
  );
}

async function handleDestText(phone, text, session) {
  if (!isValidAreaText(text)) {
    return waClient.sendText(phone,
      '❌ Please enter a valid destination name.\n_(e.g. *Gachibowli*, *HITEC City*)_\n\n🏁 *Destination:*'
    );
  }
  const places = await mapsService.searchPlaces(text);
  if (places.length === 1) {
    return applyDestLocation(phone, places[0].name, places[0].lat, places[0].lng, session);
  }
  if (places.length > 1) {
    const btns = places.map((p, i) => ({ id: `place_${i}`, title: trunc(p.name, 40) }));
    btns.push({ id: PLACE_NONE, title: '🔄 Not found, retype' });
    sessionManager.setSession(phone, { step: STEPS.OFFER_SELECT_DEST, data: { pendingPlaces: places, typedText: text.trim() } });
    return waClient.sendButtons(phone,
      `🏁 Select your destination from the results for "*${text.trim()}*":`,
      btns
    );
  }
  return applyDestLocation(phone, text.trim(), 0, 0, session);
}

async function handleDestSelect(phone, text, session) {
  const t = text.trim().toLowerCase();
  const { pendingPlaces } = session.data;

  if (t === PLACE_NONE) {
    sessionManager.setSession(phone, { step: STEPS.OFFER_ASK_DEST_LOC, data: {} });
    return waClient.sendText(phone, '🏁 *Destination:*\n\nType the area name again:');
  }
  if (t.startsWith('place_')) {
    const idx = parseInt(t.replace('place_', ''), 10);
    const p = pendingPlaces[idx];
    if (p) return applyDestLocation(phone, p.name, p.lat, p.lng, session);
  }
  const btns = pendingPlaces.map((p, i) => ({ id: `place_${i}`, title: trunc(p.name, 40) }));
  btns.push({ id: PLACE_NONE, title: '🔄 Not found, retype' });
  return waClient.sendButtons(phone, `🏁 Select your destination:`, btns);
}

async function applyDestLocation(phone, destText, lat, lng, session) {
  const { pickupLat, pickupLng } = session.data;
  const distanceKm = (pickupLat && pickupLng && lat && lng)
    ? await mapsService.getRouteDistance(pickupLat, pickupLng, lat, lng)
    : 0;
  sessionManager.setSession(phone, {
    step: STEPS.OFFER_ASK_TIME,
    data: { destText, destLat: lat, destLng: lng, distanceKm },
  });
  const distNote = distanceKm > 0 ? `\n📏 Distance: ~${distanceKm.toFixed(1)} km` : '';
  await waClient.sendButtons(phone,
    `✅ Destination: *${destText}*${distNote}\n\n🕐 *Departure Time:*\n_(e.g. 09:00, 17:30 or tomorrow 08:30)_`,
    [{ id: 'offer_cancel', title: '❌ Cancel' }]
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
      // Vehicle number also available — ask for route command then confirm
      sessionManager.setSession(phone, { step: STEPS.OFFER_ASK_ROUTE_CMD, data: { departureTime, departureDisplay: display } });
      return waClient.sendButtons(phone,
        `📝 *Route Command* _(optional)_\n\n` +
        `Describe the route you'll take:\n_e.g. Wipro Circle → ICICI Towers via ORR → Kompally_\n\n` +
        `Helps commuters know which roads you'll use.\n\n` +
        `Type your route or tap Skip:`,
        [{ id: 'route_skip', title: '⏭️ Skip' }]
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
    const user = userService.getUserByPhone(phone);
    if (user && user.VehicleNumber) {
      const vType = user.VehicleType || 'car';
      const vehicleLabel = vType.charAt(0).toUpperCase() + vType.slice(1);
      const pricePerSeat = mapsService.calculatePrice(distanceKm, vType);
      sessionManager.setSession(phone, {
        step: STEPS.OFFER_ASK_ROUTE_CMD,
        data: { totalSeats: seats, vehicleType: vType, vehicleNumber: user.VehicleNumber, ridePreference: 'all', pricePerSeat },
      });
      return waClient.sendButtons(phone,
        `✅ ${seats} seats | 🚗 ${vehicleLabel} (${user.VehicleNumber})\n\n` +
        `📝 *Route Command* _(optional)_\nDescribe your route or tap Skip:`,
        [{ id: 'route_skip', title: '⏭️ Skip' }, { id: 'offer_cancel', title: '❌ Cancel' }]
      );
    }
    const pricePerSeat = mapsService.calculatePrice(distanceKm, 'car');
    sessionManager.setSession(phone, {
      step: STEPS.OFFER_ASK_VEHICLE_NUM,
      data: { totalSeats: seats, vehicleType: 'car', ridePreference: 'all', pricePerSeat },
    });
    return waClient.sendButtons(phone,
      `✅ ${seats} seats | 🚗 Car\n\n🔑 *Vehicle Number:*\n_(e.g. TS09AB1234)_`,
      [{ id: 'offer_cancel', title: '❌ Cancel' }]
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
  const vehicleLabel = vehicleType.charAt(0).toUpperCase() + vehicleType.slice(1);
  const user = userService.getUserByPhone(phone);
  if (user && user.VehicleNumber) {
    sessionManager.setSession(phone, { step: STEPS.OFFER_ASK_ROUTE_CMD, data: { vehicleType, vehicleNumber: user.VehicleNumber, ridePreference: 'all', pricePerSeat } });
    return waClient.sendButtons(phone,
      `✅ Vehicle: *${vehicleLabel}* (${user.VehicleNumber})\n\n` +
      `📝 *Route Command* _(optional)_\nDescribe your route or tap Skip:`,
      [{ id: 'route_skip', title: '⏭️ Skip' }, { id: 'offer_cancel', title: '❌ Cancel' }]
    );
  }
  sessionManager.setSession(phone, { step: STEPS.OFFER_ASK_VEHICLE_NUM, data: { vehicleType, ridePreference: 'all', pricePerSeat } });
  return waClient.sendButtons(phone,
    `✅ Vehicle: *${vehicleLabel}*\n\n🔑 *Vehicle Number:*\n_(e.g. TS09AB1234)_`,
    [{ id: 'offer_cancel', title: '❌ Cancel' }]
  );
}


async function handleVehicleNum(phone, text, session) {
  const vNum = text.trim().toUpperCase();
  if (vNum.length < 4 || vNum.length > 15) {
    return waClient.sendText(phone,
      '❌ Please enter a valid vehicle number.\n_(e.g. TS09AB1234)_\n\n🔑 *Vehicle Number:*'
    );
  }

  sessionManager.setSession(phone, { step: STEPS.OFFER_ASK_ROUTE_CMD, data: { vehicleNumber: vNum } });
  return waClient.sendButtons(phone,
    `📝 *Route Command* _(optional)_\n\n` +
    `Describe the route you'll take:\n_e.g. Wipro Circle → ICICI Towers via ORR → Kompally_\n\n` +
    `Helps commuters know which roads you'll use.\n\nType your route or tap Skip:`,
    [{ id: 'route_skip', title: '⏭️ Skip' }, { id: 'offer_cancel', title: '❌ Cancel' }]
  );
}

async function handleRouteCmd(phone, text, session) {
  const t = text.trim().toLowerCase();
  const routeCommand = (t === 'route_skip' || t === '⏭️ skip' || t === 'skip') ? '' : text.trim();

  sessionManager.setSession(phone, { step: STEPS.OFFER_CONFIRM, data: { routeCommand } });
  const s = sessionManager.getSession(phone).data;

  const vehicleLabel = s.vehicleType.charAt(0).toUpperCase() + s.vehicleType.slice(1);
  const routeStr = s.routeCommand ? `\n📝 Route: _${s.routeCommand}_` : '';

  return waClient.sendButtons(phone,
    `📋 *Ride Summary*\n\n` +
    `📍 From: ${s.pickupText}\n` +
    `🏁 To: ${s.destText}\n` +
    `📏 Distance: ~${(s.distanceKm || 0).toFixed(1)} km\n` +
    `🕐 Time: ${s.departureDisplay}\n` +
    `💺 Seats: ${s.totalSeats}\n` +
    `💰 Price: ₹${s.pricePerSeat}/seat\n` +
    `🚗 Vehicle: ${vehicleLabel}${s.vehicleNumber ? ` (${s.vehicleNumber})` : ''}` +
    `${routeStr}\n\n` +
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
    routeCommand:   s.routeCommand || null,
  });

  if (s.vehicleNumber) userService.saveVehicleInfo(phone, s.vehicleType, s.vehicleNumber);
  sessionManager.clearSession(phone);
  console.log(`[OfferRide] Ride #${ride.RideID} by ${user.Name}`);

  const vehicleLabel = s.vehicleType.charAt(0).toUpperCase() + s.vehicleType.slice(1);
  const vehicleStr = s.vehicleNumber ? ` (${s.vehicleNumber})` : '';

  const botName = process.env.TELEGRAM_BOT_USERNAME || 'loopzride_bot';
  await waClient.sendText(phone,
    `🎉 *Ride Posted Successfully!*\n\n` +
    `🆔 Ride ID: #${ride.RideID}\n` +
    `📍 ${s.pickupText} → ${s.destText}\n` +
    `📏 Distance: ~${(s.distanceKm || 0).toFixed(1)} km\n` +
    `🕐 ${s.departureDisplay}\n` +
    `💺 ${s.totalSeats} seat(s) | 💰 ₹${s.pricePerSeat}/seat\n` +
    `🚗 ${vehicleLabel}${vehicleStr}\n` +
    (s.routeCommand ? `📝 Route: _${s.routeCommand}_\n` : '') +
    '\n✅ Colleagues can now find and book your ride.\n' +
    "📲 You'll get a Telegram notification when someone books!\n\n" +
    `📍 *Tip:* When your ride starts, share your live location here — the bot will forward it to your commuters.\n` +
    `🔗 Share ride in your community to join: t.me/${botName}`,
  );

  return waClient.sendButtons(phone, '🏠 Main Menu',
    [{ id: 'pf_menu', title: '📋 Main Menu' }]
  );
}

// Called from postTripFlow when driver wants to re-use the same route
async function startWithRoute(phone, user, savedRoute) {
  if (!user) user = userService.getUserByPhone(phone);

  const vNum = (user && user.VehicleNumber) || savedRoute.vehicleNumber || null;
  const vType = (user && user.VehicleType) || savedRoute.vehicleType || 'car';
  const pricePerSeat = mapsService.calculatePrice(savedRoute.distanceKm || 0, vType);

  let departureTime = null;
  let departureDisplay = null;
  if (savedRoute.departureTime) {
    const dep = tomorrowSameTime(savedRoute.departureTime);
    departureTime = formatDateForDb(dep);
    departureDisplay = formatDepartureTime(departureTime);
  }

  const data = {
    pickupText: savedRoute.pickupText, pickupLat: savedRoute.pickupLat, pickupLng: savedRoute.pickupLng,
    destText: savedRoute.destText, destLat: savedRoute.destLat, destLng: savedRoute.destLng,
    vehicleType: vType, totalSeats: savedRoute.totalSeats, ridePreference: savedRoute.ridePreference,
    distanceKm: savedRoute.distanceKm || 0, vehicleNumber: vNum, pricePerSeat, departureTime, departureDisplay,
  };

  sessionManager.setSession(phone, { flow: FLOWS.OFFER_RIDE, step: STEPS.OFFER_ASK_TIME, data });
  if (!departureTime) {
    return waClient.sendButtons(phone,
      `✅ *Same Route Loaded*\n\n📍 ${savedRoute.pickupText} → ${savedRoute.destText}\n\n` +
      `🕐 *What time is the departure tomorrow?*\n_(e.g. 09:00, 08:30)_`,
      [{ id: 'offer_cancel', title: '❌ Cancel' }]
    );
  }
  return loadedRouteContinue(phone, data, `✅ *Same Route Loaded*`, vNum, vType);
}

function trunc(str, max) {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function tomorrowSameTime(departureDateStr) {
  const last = new Date(departureDateStr.replace(' ', 'T'));
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(last.getHours(), last.getMinutes(), 0, 0);
  return d;
}

// After auto-loading route+time, go to route cmd or vehicle num
async function loadedRouteContinue(phone, data, header, vNum, vType) {
  const vehicleLabel = vType.charAt(0).toUpperCase() + vType.slice(1);
  if (vNum) {
    sessionManager.setSession(phone, { step: STEPS.OFFER_ASK_ROUTE_CMD, data });
    return waClient.sendButtons(phone,
      `${header}\n\n` +
      `📍 ${data.pickupText} → ${data.destText}\n` +
      `🕐 ${data.departureDisplay}\n` +
      `🚗 ${vehicleLabel} (${vNum}) | 💺 ${data.totalSeats} seat(s)\n\n` +
      `📝 *Route Command* _(optional)_\nDescribe your route or tap Skip:`,
      [{ id: 'route_skip', title: '⏭️ Skip' }, { id: 'offer_cancel', title: '❌ Cancel' }]
    );
  }
  sessionManager.setSession(phone, { step: STEPS.OFFER_ASK_VEHICLE_NUM, data });
  return waClient.sendButtons(phone,
    `${header}\n\n` +
    `📍 ${data.pickupText} → ${data.destText}\n` +
    `🕐 ${data.departureDisplay}\n\n` +
    `🔑 *Vehicle Number:*\n_(e.g. TS09AB1234)_`,
    [{ id: 'offer_cancel', title: '❌ Cancel' }]
  );
}

module.exports = { start, startWithRoute, handle, handleLocation };
