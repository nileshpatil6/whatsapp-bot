'use strict';

const waClient = require('../whatsapp/client');
const sessionManager = require('../state/sessionManager');
const rideService = require('../services/rideService');
const mapsService = require('../services/mapsService');
const userService = require('../services/userService');
const bookingService = require('../services/bookingService');
const { FLOWS, STEPS, MAX_PICKUP_RADIUS_KM, MAX_DEST_RADIUS_KM } = require('../utils/constants');
const { formatDepartureTime } = require('../utils/formatters');

const PAGE_SIZE = 8;

// ─── Entry point ──────────────────────────────────────────────────────────────

async function start(phone, user) {
  if (!user) user = userService.getUserByPhone(phone);

  const lastBooking = bookingService.getLastBookingByUser(user.UserID);
  if (lastBooking && lastBooking.PickupLat && lastBooking.PickupLng) {
    sessionManager.setSession(phone, {
      flow: FLOWS.FIND_RIDE,
      step: STEPS.FIND_ASK_REPEAT,
      data: { lastBooking },
    });
    return waClient.sendButtons(phone,
      `🔄 *Previous Route Found*\n\n` +
      `📍 ${lastBooking.PickupLocation} → ${lastBooking.Destination}\n\n` +
      'Search rides on the same route?',
      [
        { id: 'frep_yes',    title: '✅ Same Route' },
        { id: 'frep_return', title: '🔄 Return Route' },
        { id: 'frep_no',     title: '🔍 New Search' },
      ]
    );
  }

  return startFresh(phone, user);
}

async function startFresh(phone, user) {
  sessionManager.setSession(phone, {
    flow: FLOWS.FIND_RIDE,
    step: STEPS.FIND_ASK_LOCATION,
    data: { ridePreference: 'all' },
  });
  return askPickupLocation(phone);
}

// ─── Text input dispatcher ────────────────────────────────────────────────────

async function handle(phone, text, session) {
  switch (session.step) {
    case STEPS.FIND_ASK_REPEAT:     return handleRepeat(phone, text, session);
    case STEPS.FIND_ASK_LOCATION:   return handlePickupText(phone, text, session);
    case STEPS.FIND_SELECT_PICKUP:  return handlePickupSelect(phone, text, session);
    case STEPS.FIND_ASK_DEST_LOC:   return handleDestText(phone, text, session);
    case STEPS.FIND_SELECT_DEST:    return handleDestSelect(phone, text, session);
    case STEPS.FIND_BROWSE:         return handleBrowse(phone, text, session);
    case STEPS.FIND_RIDE_SELECTED:  return handleSeatSelect(phone, text, session);
    default: return start(phone);
  }
}

// ─── Location message dispatcher ─────────────────────────────────────────────

async function handleLocation(phone, locationData, session) {
  if (session.step === STEPS.FIND_ASK_LOCATION) {
    return processPickupLocation(phone, locationData, session);
  }
  if (session.step === STEPS.FIND_ASK_DEST_LOC) {
    return processDestLocation(phone, locationData, session);
  }
  await waClient.sendText(phone, '📍 Got your location! Please answer the current question first. 😊');
}

// ─── Step handlers ────────────────────────────────────────────────────────────

async function handleRepeat(phone, text, session) {
  const t = text.trim().toLowerCase();
  const { lastBooking } = session.data;
  const user = userService.getUserByPhone(phone);

  if (['frep_yes', 'yes', '✅ same route'].includes(t)) {
    const pref = 'all';
    sessionManager.setSession(phone, {
      step: STEPS.FIND_BROWSE,
      data: {
        ridePreference: pref,
        userLat:  lastBooking.PickupLat,
        userLng:  lastBooking.PickupLng,
        userArea: lastBooking.PickupLocation,
        destLat:  lastBooking.DestLat  || null,
        destLng:  lastBooking.DestLng  || null,
        destArea: lastBooking.Destination || null,
        offset: 0,
      },
    });
    return showRideList(phone, pref,
      lastBooking.PickupLat, lastBooking.PickupLng, lastBooking.PickupLocation,
      lastBooking.DestLat, lastBooking.DestLng, lastBooking.Destination, 0
    );
  }

  if (['frep_return', '🔄 return route'].includes(t)) {
    // Swap pickup and destination
    const pref = 'all';
    sessionManager.setSession(phone, {
      step: STEPS.FIND_BROWSE,
      data: {
        ridePreference: pref,
        userLat:  lastBooking.DestLat  || null,
        userLng:  lastBooking.DestLng  || null,
        userArea: lastBooking.Destination || null,
        destLat:  lastBooking.PickupLat,
        destLng:  lastBooking.PickupLng,
        destArea: lastBooking.PickupLocation,
        offset: 0,
      },
    });
    return showRideList(phone, pref,
      lastBooking.DestLat, lastBooking.DestLng, lastBooking.Destination,
      lastBooking.PickupLat, lastBooking.PickupLng, lastBooking.PickupLocation, 0
    );
  }

  return startFresh(phone, user);
}

async function askPickupLocation(phone) {
  await waClient.sendLocationRequestWithSearch(phone,
    '🔍 *Find a Ride — Step 1 of 2*\n\n' +
    '📍 *Where are you getting picked up?*\n\n' +
    'Tap *Search Location* to find your area.\n' +
    '_(e.g. Miyapur Metro, Kondapur Bus Stop)_'
  );
}

async function askDestLocation(phone, pickupName) {
  await waClient.sendLocationRequestWithSearch(phone,
    `✅ Pickup: *${pickupName}*\n\n` +
    '🔍 *Step 2 of 2 — Where are you going?*\n\n' +
    'Tap *Search Location* to find your destination.\n' +
    '_(e.g. HITEC City, Gachibowli, Nanakramguda)_'
  );
}


async function processPickupLocation(phone, loc, session) {
  if (!loc.lat || !loc.lng) {
    return waClient.sendText(phone, '❌ Could not read location coordinates. Please try again.');
  }
  const displayName = await mapsService.getDisplayName(loc.lat, loc.lng, loc.name, loc.address);
  sessionManager.setSession(phone, {
    step: STEPS.FIND_ASK_DEST_LOC,
    data: { userLat: loc.lat, userLng: loc.lng, userArea: displayName },
  });
  return askDestLocation(phone, displayName);
}

async function handlePickupText(phone, text, session) {
  if (text.trim().length < 3) {
    return waClient.sendText(phone,
      '❌ Please enter a valid area name or share your location.\n_(e.g. *Miyapur Metro*, *Kondapur*)_'
    );
  }
  const places = await mapsService.searchPlaces(text);
  if (places.length === 1) {
    return applyPickupLocation(phone, places[0].name, places[0].lat, places[0].lng, session);
  }
  if (places.length > 1) {
    const btns = places.map((p, i) => ({ id: `place_${i}`, title: trunc(p.name, 40) }));
    btns.push({ id: 'place_none', title: '🔄 Not found, retype' });
    sessionManager.setSession(phone, { step: STEPS.FIND_SELECT_PICKUP, data: { pendingPlaces: places } });
    return waClient.sendButtons(phone,
      `📍 Select your pickup from results for "*${text.trim()}*":`,
      btns
    );
  }
  return applyPickupLocation(phone, text.trim(), 0, 0, session);
}

async function handlePickupSelect(phone, text, session) {
  const t = text.trim().toLowerCase();
  const { pendingPlaces } = session.data;
  if (t === 'place_none') {
    sessionManager.setSession(phone, { step: STEPS.FIND_ASK_LOCATION, data: {} });
    return waClient.sendText(phone, '📍 *Pickup Location:*\n\nType the area name again:');
  }
  if (t.startsWith('place_')) {
    const idx = parseInt(t.replace('place_', ''), 10);
    const p = pendingPlaces[idx];
    if (p) return applyPickupLocation(phone, p.name, p.lat, p.lng, session);
  }
  const btns = pendingPlaces.map((p, i) => ({ id: `place_${i}`, title: trunc(p.name, 40) }));
  btns.push({ id: 'place_none', title: '🔄 Not found, retype' });
  return waClient.sendButtons(phone, `📍 Select your pickup:`, btns);
}

async function applyPickupLocation(phone, name, lat, lng, session) {
  const ridePreference = session.data.ridePreference || 'all';
  sessionManager.setSession(phone, {
    step: STEPS.FIND_ASK_DEST_LOC,
    data: { userLat: lat, userLng: lng, userArea: name, ridePreference },
  });
  return askDestLocation(phone, name);
}

async function processDestLocation(phone, loc, session) {
  if (!loc.lat || !loc.lng) {
    return waClient.sendText(phone, '❌ Could not read location. Please try again.');
  }
  const { userLat, userLng, userArea, ridePreference } = session.data;
  const pref = ridePreference || 'all';

  // Reject same pickup & destination
  if (userLat && userLng && mapsService.haversineDistance(userLat, userLng, loc.lat, loc.lng) < 0.3) {
    await waClient.sendText(phone,
      `❌ Destination must be different from your pickup.\n\n📍 Pickup: *${userArea}*\n\nWhere are you going?`
    );
    return askDestLocation(phone, userArea);
  }
  const displayName = await mapsService.getDisplayName(loc.lat, loc.lng, loc.name, loc.address);

  sessionManager.setSession(phone, {
    step: STEPS.FIND_BROWSE,
    data: {
      ridePreference: pref,
      userLat, userLng, userArea,
      destLat: loc.lat, destLng: loc.lng, destArea: displayName,
      offset: 0,
    },
  });
  return showRideList(phone, pref, userLat, userLng, userArea, loc.lat, loc.lng, displayName, 0);
}

async function handleDestText(phone, text, session) {
  if (text.trim().length < 3) {
    return waClient.sendText(phone,
      '❌ Please enter a valid destination name.\n_(e.g. *HITEC City*, *Gachibowli*)_'
    );
  }
  const { userLat, userLng, userArea, ridePreference } = session.data;

  if (text.trim().toLowerCase() === (userArea || '').toLowerCase()) {
    return waClient.sendText(phone,
      `❌ Destination must be different from pickup.\n\n📍 Pickup: *${userArea}*\n\nWhere are you going?`
    );
  }
  const places = await mapsService.searchPlaces(text);
  if (places.length === 1) {
    return applyDestLocation(phone, places[0].name, places[0].lat, places[0].lng, session);
  }
  if (places.length > 1) {
    const btns = places.map((p, i) => ({ id: `place_${i}`, title: trunc(p.name, 40) }));
    btns.push({ id: 'place_none', title: '🔄 Not found, retype' });
    sessionManager.setSession(phone, { step: STEPS.FIND_SELECT_DEST, data: { pendingPlaces: places } });
    return waClient.sendButtons(phone,
      `🏁 Select your destination from results for "*${text.trim()}*":`,
      btns
    );
  }
  return applyDestLocation(phone, text.trim(), 0, 0, session);
}

async function handleDestSelect(phone, text, session) {
  const t = text.trim().toLowerCase();
  const { pendingPlaces } = session.data;
  if (t === 'place_none') {
    sessionManager.setSession(phone, { step: STEPS.FIND_ASK_DEST_LOC, data: {} });
    return waClient.sendText(phone, '🏁 *Destination:*\n\nType the area name again:');
  }
  if (t.startsWith('place_')) {
    const idx = parseInt(t.replace('place_', ''), 10);
    const p = pendingPlaces[idx];
    if (p) return applyDestLocation(phone, p.name, p.lat, p.lng, session);
  }
  const btns = pendingPlaces.map((p, i) => ({ id: `place_${i}`, title: trunc(p.name, 40) }));
  btns.push({ id: 'place_none', title: '🔄 Not found, retype' });
  return waClient.sendButtons(phone, `🏁 Select your destination:`, btns);
}

async function applyDestLocation(phone, destName, lat, lng, session) {
  const { userLat, userLng, userArea, ridePreference } = session.data;

  if (userLat && userLng && lat && lng && mapsService.haversineDistance(userLat, userLng, lat, lng) < 0.3) {
    await waClient.sendText(phone, `❌ Destination must be different from pickup.\n\n📍 Pickup: *${userArea}*\n\nWhere are you going?`);
    return askDestLocation(phone, userArea);
  }
  const pref = ridePreference || 'all';
  sessionManager.setSession(phone, {
    step: STEPS.FIND_BROWSE,
    data: { ridePreference: pref, userLat, userLng, userArea, destLat: lat, destLng: lng, destArea: destName, offset: 0 },
  });
  return showRideList(phone, pref, userLat, userLng, userArea, lat, lng, destName, 0);
}

// ─── Ride list display ────────────────────────────────────────────────────────

async function showRideList(phone, preference, userLat, userLng, userArea, destLat, destLng, destArea, offset, showAll = false) {
  const allRides = rideService.getActiveRides(preference === 'women_only' ? 'women_only' : null);

  let filtered = allRides;
  if (!showAll && userLat && userLng) {
    filtered = allRides.filter((ride) => {
      const pickupDist = mapsService.haversineDistance(userLat, userLng, ride.PickupLat, ride.PickupLng);
      if (pickupDist > MAX_PICKUP_RADIUS_KM) return false;
      if (destLat && destLng && ride.DestLat && ride.DestLng) {
        const destDist = mapsService.haversineDistance(destLat, destLng, ride.DestLat, ride.DestLng);
        if (destDist > MAX_DEST_RADIUS_KM) return false;
      }
      return true;
    });
  }

  // When browsing all, sort by combined proximity to user's search coords
  if (showAll && userLat && userLng) {
    filtered = [...filtered].sort((a, b) => {
      const scoreA = mapsService.haversineDistance(userLat, userLng, a.PickupLat, a.PickupLng)
        + (destLat && destLng ? mapsService.haversineDistance(destLat, destLng, a.DestLat, a.DestLng) : 0);
      const scoreB = mapsService.haversineDistance(userLat, userLng, b.PickupLat, b.PickupLng)
        + (destLat && destLng ? mapsService.haversineDistance(destLat, destLng, b.DestLat, b.DestLng) : 0);
      return scoreA - scoreB;
    });
  }

  if (filtered.length === 0 && allRides.length > 0 && !showAll) {
    const routeDesc = destArea ? `*${userArea} → ${destArea}*` : `*${userArea}*`;
    sessionManager.setSession(phone, {
      step: STEPS.FIND_BROWSE,
      data: {
        ridePreference: preference,
        userLat, userLng, userArea,
        destLat, destLng, destArea,
        showAll: false, offset: 0,
      },
    });
    return waClient.sendButtons(phone,
      `🚗 No rides found for ${routeDesc}.\n\n` +
      `But there are *${allRides.length}* ride(s) available on other routes.\n\n` +
      'Would you like to browse all available rides?',
      [
        { id: 'show_all_rides', title: '🔍 Browse All Rides' },
        { id: 'back_menu',      title: '🏠 Main Menu' },
      ]
    );
  }

  if (filtered.length === 0) {
    sessionManager.clearSession(phone);
    return waClient.sendButtons(phone,
      '🚗 No rides available right now.\n\nAsk a colleague to post a ride on Loopz!',
      [
        { id: 'menu_1', title: '🚗 Offer a Ride' },
        { id: 'pf_menu', title: '📋 Main Menu' },
      ]
    );
  }

  const page    = filtered.slice(offset, offset + PAGE_SIZE);
  const hasMore = offset + PAGE_SIZE < filtered.length;

  const rows = page.map((ride) => {
    const available = ride.TotalSeats - ride.BookedSeats;
    const price     = ride.PricePerSeat === 0 ? 'Free' : `₹${ride.PricePerSeat}/seat`;
    const womenTag  = ride.RidePreference === 'women_only' ? ' 👩' : '';
    const distStr   = ride.DistanceKm ? ` | ${ride.DistanceKm.toFixed(1)}km` : '';
    return {
      id:          `ride_${ride.RideID}`,
      title:       trunc(`${ride.PickupLocation} → ${ride.Destination}`, 24),
      description: trunc(
        `#${ride.RideID} | ${formatDepartureTime(ride.DepartureTime)} | ${available} seat(s) | ${price}${distStr}`, 72
      ),
    };
  });

  if (hasMore) {
    rows.push({
      id:          `more_${offset + PAGE_SIZE}`,
      title:       '🔄 Show More Rides',
      description: `Showing ${offset + 1}–${offset + page.length} of ${filtered.length} total`,
    });
  }

  if (!showAll && filtered.length < allRides.length) {
    rows.push({
      id:          'show_all_rides',
      title:       '🔍 Browse All Rides',
      description: `See all ${allRides.length} ride(s) on the platform`,
    });
  }

  const routeLabel = destArea ? `${userArea} → ${destArea}` : (userArea || 'All Routes');
  const label      = preference === 'women_only' ? '👩 Women-Only Rides' : '🚗 Available Rides';
  const bodyText   =
    `${label}\n\n` +
    `*${filtered.length}* ride(s) for *${routeLabel}*` +
    (showAll ? ' *(all routes)*' : '') + `.\n` +
    `Tap a ride to view details and book.`;

  return waClient.sendList(phone, bodyText, 'Browse Rides 🚗', [{ title: label, rows }]);
}

async function handleBrowse(phone, text, session) {
  const t = text.trim().toLowerCase();
  const { ridePreference, userLat, userLng, userArea, destLat, destLng, destArea, showAll, offset } = session.data;

  if (t === 'show_all_rides') {
    sessionManager.setSession(phone, { data: { showAll: true, offset: 0 } });
    return showRideList(phone, ridePreference, userLat, userLng, userArea, destLat, destLng, destArea, 0, true);
  }

  if (t === 'back_menu') {
    sessionManager.clearSession(phone);
    const user = userService.getUserByPhone(phone);
    return require('./mainMenuFlow').show(phone, user);
  }

  if (t.startsWith('more_')) {
    const newOffset = parseInt(t.replace('more_', ''), 10);
    sessionManager.setSession(phone, { data: { offset: newOffset } });
    if (showAll) {
      return showRideList(phone, ridePreference, null, null, null, null, null, null, newOffset, true);
    }
    return showRideList(phone, ridePreference, userLat, userLng, userArea, destLat, destLng, destArea, newOffset);
  }

  if (t.startsWith('ride_')) {
    const rideId = parseInt(t.replace('ride_', ''), 10);
    return showRideDetail(phone, rideId, ridePreference, userLat, userLng, userArea, destLat, destLng, destArea, offset || 0, showAll);
  }

  await waClient.sendText(phone, '👆 Tap a ride from the list to select it, or reply *menu* to go back.');
}

async function showRideDetail(phone, rideId, ridePreference, userLat, userLng, userArea, destLat, destLng, destArea, offset, showAll) {
  const ride = rideService.getRideById(rideId);

  if (!ride || ride.Status !== 'active' || ride.BookedSeats >= ride.TotalSeats) {
    await waClient.sendText(phone, '❌ That ride is no longer available. Refreshing list...');
    if (showAll) return showRideList(phone, ridePreference, null, null, null, null, null, null, 0, true);
    return showRideList(phone, ridePreference, userLat, userLng, userArea, destLat, destLng, destArea, 0);
  }

  const driver    = userService.getUserById(ride.DriverID);
  const available = ride.TotalSeats - ride.BookedSeats;
  const price     = ride.PricePerSeat === 0 ? 'Free' : `₹${ride.PricePerSeat}/seat`;
  const prefLabel = ride.RidePreference === 'women_only' ? '\n👩 *Women Only Ride*' : '';
  const distNote  = ride.DistanceKm
    ? `\n📏 Distance: ~${ride.DistanceKm.toFixed(1)} km`
    : (userLat ? `\n📏 Pickup ~${mapsService.haversineDistance(userLat, userLng, ride.PickupLat, ride.PickupLng).toFixed(1)} km from you` : '');
  const vehicleLabel  = ride.VehicleType.charAt(0).toUpperCase() + ride.VehicleType.slice(1);
  const vehicleNumStr = ride.VehicleNumber ? ` (${ride.VehicleNumber})` : '';

  sessionManager.setSession(phone, {
    step: STEPS.FIND_RIDE_SELECTED,
    data: { selectedRideId: rideId, maxSeats: available, ridePreference, userLat, userLng, userArea, destLat, destLng, destArea, offset, showAll },
  });

  const seatBtns = [];
  for (let i = 1; i <= Math.min(available, 6); i++) {
    seatBtns.push({ id: `seats_${i}`, title: i === 1 ? '1 Seat' : `${i} Seats` });
  }
  seatBtns.push({ id: 'back_list', title: '← Back' });

  const routeCmdStr = ride.RouteCommand ? `\n📝 Route: _${ride.RouteCommand}_` : '';
  return waClient.sendButtons(phone,
    `🚗 *Ride Details* | #${ride.RideID}${prefLabel}\n\n` +
    `👤 Rider: ${driver ? driver.Name : 'Unknown'}\n` +
    `🗺️ Route: ${ride.PickupLocation} → ${ride.Destination}\n` +
    `🕐 Departure: ${formatDepartureTime(ride.DepartureTime)}\n` +
    `💺 Available: ${available} seat(s)\n` +
    `💰 Price: ${price}${distNote}\n` +
    `🚗 Vehicle: ${vehicleLabel}${vehicleNumStr}` +
    `${routeCmdStr}\n\n` +
    `How many seats do you need?`,
    seatBtns
  );
}

async function handleSeatSelect(phone, text, session) {
  const t = text.trim().toLowerCase();
  const { selectedRideId, maxSeats, ridePreference, userLat, userLng, userArea, destLat, destLng, destArea, offset, showAll } = session.data;

  if (t === 'back_list' || t === 'back' || t === '← back to list' || t === '← back') {
    sessionManager.setSession(phone, {
      step: STEPS.FIND_BROWSE,
      data: { ridePreference, userLat, userLng, userArea, destLat, destLng, destArea, offset, showAll },
    });
    if (showAll) return showRideList(phone, ridePreference, null, null, null, null, null, null, offset || 0, true);
    return showRideList(phone, ridePreference, userLat, userLng, userArea, destLat, destLng, destArea, offset || 0);
  }

  const rawInput = t.startsWith('seats_') ? t.replace('seats_', '') : text.trim();
  const seats = parseInt(rawInput, 10);

  if (isNaN(seats) || seats < 1 || seats > maxSeats) {
    const seatBtns = [];
    for (let i = 1; i <= Math.min(maxSeats, 6); i++) {
      seatBtns.push({ id: `seats_${i}`, title: i === 1 ? '1 Seat' : `${i} Seats` });
    }
    seatBtns.push({ id: 'back_list', title: '← Back' });
    return waClient.sendButtons(phone, `❌ Please choose a valid number of seats:`, seatBtns);
  }

  const ride = rideService.getRideById(selectedRideId);
  if (!ride || ride.Status !== 'active' || ride.BookedSeats >= ride.TotalSeats) {
    sessionManager.clearSession(phone);
    return waClient.sendButtons(phone, '❌ This ride was just taken.', [{ id: 'menu_2', title: '🔍 Find Another Ride' }]);
  }

  return require('./bookingFlow').start(phone, ride, seats);
}

function trunc(str, max) {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

async function startWithLocation(phone, user, locationData) {
  if (!user) user = userService.getUserByPhone(phone);

  const pref = 'all';
  sessionManager.setSession(phone, {
    flow: FLOWS.FIND_RIDE,
    step: STEPS.FIND_ASK_DEST_LOC,
    data: {
      ridePreference: pref,
      userLat: locationData.lat,
      userLng: locationData.lng,
      userArea: locationData.name || 'your area',
    },
  });

  return askDestLocation(phone, locationData.name || 'your area');
}

module.exports = { start, startWithLocation, handle, handleLocation };
