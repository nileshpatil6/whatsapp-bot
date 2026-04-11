'use strict';

const waClient = require('../whatsapp/client');
const sessionManager = require('../state/sessionManager');
const rideService = require('../services/rideService');
const mapsService = require('../services/mapsService');
const userService = require('../services/userService');
const { FLOWS, STEPS, MAX_PICKUP_RADIUS_KM } = require('../utils/constants');
const { formatDepartureTime } = require('../utils/formatters');

const PAGE_SIZE = 9; // leave room for optional "Show More" row (max 10 per list)

// ─── Entry point ──────────────────────────────────────────────────────────────

async function start(phone, user) {
  if (!user) user = userService.getUserByPhone(phone);

  const isFemale = user && user.Gender === 'Female';

  if (isFemale) {
    sessionManager.setSession(phone, {
      flow: FLOWS.FIND_RIDE,
      step: STEPS.FIND_ASK_PREFERENCE,
      data: {},
    });
    return waClient.sendButtons(phone,
      '🔍 *Find a Ride*\n\n🎯 *Ride Preference:*\nWould you like to see all rides or women-only rides?',
      [
        { id: 'fp_all',   title: '🌐 All Rides' },
        { id: 'fp_women', title: '👩 Women Only' },
      ]
    );
  }

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
    case STEPS.FIND_ASK_PREFERENCE: return handlePreference(phone, text, session);
    case STEPS.FIND_ASK_LOCATION:   return handleLocationText(phone, text, session);
    case STEPS.FIND_BROWSE:         return handleBrowse(phone, text, session);
    case STEPS.FIND_RIDE_SELECTED:  return handleSeatSelect(phone, text, session);
    default: return start(phone);
  }
}

// ─── Location message dispatcher ─────────────────────────────────────────────

async function handleLocation(phone, locationData, session) {
  if (session.step === STEPS.FIND_ASK_LOCATION) {
    return processUserLocation(phone, locationData, session);
  }
  await waClient.sendText(phone, '📍 Got your location! Please answer the current question first. 😊');
}

// ─── Step handlers ────────────────────────────────────────────────────────────

async function askPickupLocation(phone) {
  await waClient.sendLocationRequest(phone,
    '🔍 *Find a Ride Near You*\n\n' +
    'Share your pickup location and we\'ll find rides within *3 km* of you!\n\n' +
    'Tap *Send Location* to share your current location or search for your area.\n\n' +
    '_Or type your pickup area name (e.g. Miyapur Metro, Kondapur)_'
  );
}

async function handlePreference(phone, text, session) {
  const map = {
    fp_all: 'all', all: 'all', 'all rides': 'all', '🌐 all rides': 'all',
    fp_women: 'women_only', 'women only': 'women_only', women: 'women_only', '👩 women only': 'women_only',
  };
  const pref = map[text.trim().toLowerCase()];
  if (!pref) {
    return waClient.sendButtons(phone, '🎯 Please select a preference to continue:',
      [
        { id: 'fp_all',   title: '🌐 All Rides' },
        { id: 'fp_women', title: '👩 Women Only' },
      ]
    );
  }
  sessionManager.setSession(phone, {
    step: STEPS.FIND_ASK_LOCATION,
    data: { ridePreference: pref },
  });
  return askPickupLocation(phone);
}

// WhatsApp location pin received
async function processUserLocation(phone, loc, session) {
  if (!loc.lat || !loc.lng) {
    return waClient.sendText(phone, '❌ Could not read location coordinates. Please try again.');
  }

  const displayName = await mapsService.getDisplayName(loc.lat, loc.lng, loc.name, loc.address);
  const pref = session.data.ridePreference || 'all';

  sessionManager.setSession(phone, {
    step: STEPS.FIND_BROWSE,
    data: {
      ridePreference: pref,
      userLat: loc.lat,
      userLng: loc.lng,
      userArea: displayName,
      offset: 0,
    },
  });

  await waClient.sendText(phone, `📍 Looking for rides near *${displayName}*...`);
  return showRideList(phone, pref, loc.lat, loc.lng, displayName, 0);
}

// Text fallback — geocode the area name the user typed
async function handleLocationText(phone, text, session) {
  if (text.trim().length < 3) {
    return waClient.sendText(phone,
      '❌ Please enter a valid area name or share your location.\n\n' +
      '_(e.g. *Miyapur Metro*, *Kondapur*)_'
    );
  }

  await waClient.sendText(phone, '⏳ Looking up your location...');

  const coords = await mapsService.geocodeAddress(text);
  if (!coords) {
    return waClient.sendText(phone,
      `❌ Couldn't find "*${text.trim()}*" on the map.\nTry a more specific area name, or share your location pin.`
    );
  }

  const pref = session.data.ridePreference || 'all';
  sessionManager.setSession(phone, {
    step: STEPS.FIND_BROWSE,
    data: {
      ridePreference: pref,
      userLat: coords.lat,
      userLng: coords.lng,
      userArea: text.trim(),
      offset: 0,
    },
  });

  await waClient.sendText(phone, `📍 Looking for rides near *${text.trim()}*...`);
  return showRideList(phone, pref, coords.lat, coords.lng, text.trim(), 0);
}

// ─── Ride list display ─────────────────────────────────────────────────────────

async function showRideList(phone, preference, userLat, userLng, userArea, offset) {
  const allRides = rideService.getActiveRides(preference === 'women_only' ? 'women_only' : null);

  // Filter rides within MAX_PICKUP_RADIUS_KM of user's location (if we have coordinates)
  let nearbyRides = allRides;
  if (userLat && userLng) {
    nearbyRides = allRides.filter((ride) => {
      const dist = mapsService.haversineDistance(userLat, userLng, ride.PickupLat, ride.PickupLng);
      return dist <= MAX_PICKUP_RADIUS_KM;
    });
  }

  if (nearbyRides.length === 0 && allRides.length > 0) {
    // No rides near the user — offer to show all
    sessionManager.setSession(phone, {
      step: STEPS.FIND_BROWSE,
      data: { ridePreference: preference, userLat, userLng, userArea, showAll: true, offset: 0 },
    });
    return waClient.sendButtons(phone,
      `🚗 No rides found within *${MAX_PICKUP_RADIUS_KM} km* of *${userArea}*.\n\n` +
      `But there are *${allRides.length}* ride(s) available elsewhere.\n\n` +
      'Would you like to see all available rides?',
      [
        { id: 'show_all_rides', title: '🔍 Show All Rides' },
        { id: 'back_menu',      title: '🏠 Main Menu' },
      ]
    );
  }

  if (nearbyRides.length === 0) {
    sessionManager.clearSession(phone);
    return waClient.sendText(phone,
      preference === 'women_only'
        ? '🚗 No women-only rides near you right now.\n\nReply *find* to browse all rides or *menu* to go back.'
        : '🚗 No rides available near you right now.\n\nAsk a colleague to post a ride on Loopz!\n\nReply *offer* to post one, or *menu* to go back.'
    );
  }

  const page   = nearbyRides.slice(offset, offset + PAGE_SIZE);
  const hasMore = offset + PAGE_SIZE < nearbyRides.length;

  const rows = page.map((ride) => {
    const available = ride.TotalSeats - ride.BookedSeats;
    const price     = ride.PricePerSeat === 0 ? 'Free' : `₹${ride.PricePerSeat}/seat`;
    const womenTag  = ride.RidePreference === 'women_only' ? ' 👩' : '';
    const dist      = userLat ? ` | ${mapsService.haversineDistance(userLat, userLng, ride.PickupLat, ride.PickupLng).toFixed(1)}km` : '';
    return {
      id:          `ride_${ride.RideID}`,
      title:       trunc(`${ride.PickupLocation} → ${ride.Destination}`, 24),
      description: trunc(
        `${formatDepartureTime(ride.DepartureTime)} | ${available} seat(s) | ${price}${womenTag}${dist}`, 72
      ),
    };
  });

  if (hasMore) {
    rows.push({
      id:          `more_${offset + PAGE_SIZE}`,
      title:       '🔄 Show More Rides',
      description: `Showing ${offset + 1}–${offset + page.length} of ${nearbyRides.length} total`,
    });
  }

  const label    = preference === 'women_only' ? '👩 Women-Only Rides' : '🚗 Rides Near You';
  const areaNote = userArea ? ` near *${userArea}*` : '';
  const bodyText =
    `${label}\n\n` +
    `*${nearbyRides.length}* ride(s) available${areaNote}.\n` +
    `Tap a ride to view details and book.\n\n` +
    `_Reply *menu* anytime to go back._`;

  return waClient.sendList(phone, bodyText, 'Browse Rides 🚗', [{ title: label, rows }]);
}

async function handleBrowse(phone, text, session) {
  const t = text.trim().toLowerCase();
  const { ridePreference, userLat, userLng, userArea, showAll, offset } = session.data;

  // "Show all rides" button
  if (t === 'show_all_rides') {
    sessionManager.setSession(phone, { data: { showAll: true, offset: 0 } });
    return showRideList(phone, ridePreference, null, null, null, 0); // null coords = show all
  }

  if (t === 'back_menu') {
    sessionManager.clearSession(phone);
    const user = userService.getUserByPhone(phone);
    return require('./mainMenuFlow').show(phone, user);
  }

  // "Show More" row selected
  if (t.startsWith('more_')) {
    const newOffset = parseInt(t.replace('more_', ''), 10);
    sessionManager.setSession(phone, { data: { offset: newOffset } });
    const lat = showAll ? null : userLat;
    const lng = showAll ? null : userLng;
    return showRideList(phone, ridePreference, lat, lng, userArea, newOffset);
  }

  // A ride row was tapped
  if (t.startsWith('ride_')) {
    const rideId = parseInt(t.replace('ride_', ''), 10);
    return showRideDetail(phone, rideId, ridePreference, userLat, userLng, userArea, offset || 0, showAll);
  }

  await waClient.sendText(phone, '👆 Tap a ride from the list to select it, or reply *menu* to go back.');
}

async function showRideDetail(phone, rideId, ridePreference, userLat, userLng, userArea, offset, showAll) {
  const ride = rideService.getRideById(rideId);

  if (!ride || ride.Status !== 'active' || ride.BookedSeats >= ride.TotalSeats) {
    await waClient.sendText(phone, '❌ That ride is no longer available. Refreshing list...');
    const lat = showAll ? null : userLat;
    const lng = showAll ? null : userLng;
    return showRideList(phone, ridePreference, lat, lng, userArea, 0);
  }

  const driver    = userService.getUserById(ride.DriverID);
  const available = ride.TotalSeats - ride.BookedSeats;
  const price     = ride.PricePerSeat === 0 ? 'Free' : `₹${ride.PricePerSeat}/seat`;
  const prefLabel = ride.RidePreference === 'women_only' ? '\n👩 *Women Only Ride*' : '';
  const distNote  = userLat
    ? `\n📏 Distance from you: ~${mapsService.haversineDistance(userLat, userLng, ride.PickupLat, ride.PickupLng).toFixed(1)} km`
    : '';
  const vehicleLabel = ride.VehicleType.charAt(0).toUpperCase() + ride.VehicleType.slice(1);
  const vehicleDisplay = ride.VehicleName ? `${vehicleLabel} (${ride.VehicleName})` : vehicleLabel;

  sessionManager.setSession(phone, {
    step: STEPS.FIND_RIDE_SELECTED,
    data: { selectedRideId: rideId, maxSeats: available, ridePreference, userLat, userLng, userArea, offset, showAll },
  });

  // Build up to 3 seat buttons
  const seatButtons = [];
  const showSeats = Math.min(available, available <= 2 ? 2 : 3);
  for (let s = 1; s <= showSeats; s++) {
    seatButtons.push({ id: `seats_${s}`, title: `💺 ${s} Seat${s > 1 ? 's' : ''}` });
  }
  if (available <= 2) {
    seatButtons.push({ id: 'back_list', title: '← All Rides' });
  }

  const moreNote = available > 3
    ? `\n\n_(Reply a number up to ${available} if you need more than 3 seats)_` : '';
  const backNote = available > 2 ? '\n_Reply *back* to return to ride list_' : '';

  return waClient.sendButtons(phone,
    `🚗 *Ride Details*${prefLabel}\n\n` +
    `👤 Driver: ${driver ? driver.Name : 'Unknown'}\n` +
    `🗺️ Route: ${ride.PickupLocation} → ${ride.Destination}\n` +
    `🕐 Departure: ${formatDepartureTime(ride.DepartureTime)}\n` +
    `💺 Available: ${available} seat(s)\n` +
    `💰 Price: ${price}\n` +
    `🚗 Vehicle: ${vehicleDisplay}${distNote}\n\n` +
    `*How many seats do you need?*${moreNote}${backNote}`,
    seatButtons
  );
}

async function handleSeatSelect(phone, text, session) {
  const t = text.trim().toLowerCase();
  const { selectedRideId, maxSeats, ridePreference, userLat, userLng, userArea, offset, showAll } = session.data;

  // Back to list
  if (t === 'back_list' || t === 'back' || t === '← all rides') {
    sessionManager.setSession(phone, {
      step: STEPS.FIND_BROWSE,
      data: { ridePreference, userLat, userLng, userArea, offset, showAll },
    });
    const lat = showAll ? null : userLat;
    const lng = showAll ? null : userLng;
    return showRideList(phone, ridePreference, lat, lng, userArea, offset || 0);
  }

  let seats;
  if (t.startsWith('seats_')) {
    seats = parseInt(t.replace('seats_', ''), 10);
  } else {
    seats = parseInt(text.trim(), 10);
  }

  if (isNaN(seats) || seats < 1 || seats > maxSeats) {
    return waClient.sendText(phone,
      `❌ Please choose between 1 and ${maxSeats} seat(s).\nOr reply *back* to return to the ride list.`
    );
  }

  const ride = rideService.getRideById(selectedRideId);
  if (!ride || ride.Status !== 'active' || ride.BookedSeats >= ride.TotalSeats) {
    sessionManager.clearSession(phone);
    return waClient.sendText(phone, '❌ This ride was just taken. Reply *find* to search again.');
  }

  return require('./bookingFlow').start(phone, ride, seats);
}

function trunc(str, max) {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

module.exports = { start, handle, handleLocation };
