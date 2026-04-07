'use strict';

const waClient = require('../whatsapp/client');
const sessionManager = require('../state/sessionManager');
const rideService = require('../services/rideService');
const userService = require('../services/userService');
const mapsService = require('../services/mapsService');
const { FLOWS, STEPS, RESULTS_PAGE_SIZE, MAX_PICKUP_RADIUS_KM, MAX_TIME_DIFF_MINUTES } = require('../utils/constants');
const { isValidAreaText, isValidBookingSeats, parseTimeInput, formatDateForDb } = require('../utils/validators');
const { formatRideFound, formatNoRideAvailable } = require('../utils/formatters');

async function start(phone, user) {
  if (!user) user = userService.getUserByPhone(phone);

  sessionManager.setSession(phone, {
    flow: FLOWS.FIND_RIDE,
    step: STEPS.FIND_ASK_PICKUP,
    data: {},
  });

  const suggestion = user && user.HomeArea
    ? `\n\n💡 Your home area: *${user.HomeArea}*\n_Type it or enter a different one_`
    : '';

  await waClient.sendText(phone,
    '🔍 *Find a Ride*\n\n' +
    `📍 *Pickup Location:*${suggestion}\n\n` +
    '_(e.g. Kondapur, Miyapur, Kukatpally)_\n\n' +
    '_Reply *cancel* anytime to go back._'
  );
}

async function handle(phone, text, session) {
  switch (session.step) {
    case STEPS.FIND_ASK_PICKUP:     return handlePickup(phone, text, session);
    case STEPS.FIND_ASK_DEST:       return handleDest(phone, text, session);
    case STEPS.FIND_ASK_TIME:       return handleTime(phone, text, session);
    case STEPS.FIND_ASK_SEATS:      return handleSeats(phone, text, session);
    case STEPS.FIND_ASK_PREFERENCE: return handlePreference(phone, text, session);
    default: return start(phone);
  }
}

async function handlePickup(phone, text, session) {
  if (!isValidAreaText(text)) {
    return waClient.sendText(phone,
      '❌ Please enter a valid area name with letters.\n_(e.g. *Kondapur*, *Miyapur*)_\n\n📍 *Pickup Location:*'
    );
  }
  sessionManager.setSession(phone, { step: STEPS.FIND_ASK_DEST, data: { pickupText: text.trim() } });

  const user = userService.getUserByPhone(phone);
  const suggestion = user && user.OfficeLocation
    ? `\n\n💡 Your office: *${user.OfficeLocation}*\n_Type it or enter a different one_`
    : '';

  await waClient.sendText(phone,
    `✅ Pickup: *${text.trim()}*\n\n🏁 *Destination:*${suggestion}\n\n_(e.g. Gachibowli, HITEC City)_`
  );
}

async function handleDest(phone, text, session) {
  if (!isValidAreaText(text)) {
    return waClient.sendText(phone,
      '❌ Please enter a valid destination with letters.\n\n🏁 *Destination:*'
    );
  }
  sessionManager.setSession(phone, { step: STEPS.FIND_ASK_TIME, data: { destText: text.trim() } });
  await waClient.sendText(phone,
    `✅ Destination: *${text.trim()}*\n\n🕐 *Preferred Time:*\n_(e.g. 9 AM, 8:30 AM)_`
  );
}

async function handleTime(phone, text, session) {
  const parsed = parseTimeInput(text);
  if (!parsed) {
    return waClient.sendText(phone,
      '❌ Couldn\'t understand that time.\n_(e.g. *9 AM*, *8:30 AM*)_\n\n🕐 *Preferred Time:*'
    );
  }
  sessionManager.setSession(phone, { step: STEPS.FIND_ASK_SEATS, data: { preferredTime: parsed.toISOString() } });
  await waClient.sendText(phone,
    `✅ Time: *${formatTimeDisplay(parsed)}*\n\n💺 *Seats Required:*\n_(How many seats do you need? 1–6)_`
  );
}

async function handleSeats(phone, text, session) {
  if (!isValidBookingSeats(text, 6)) {
    return waClient.sendText(phone,
      '❌ Please enter a number between 1 and 6.\n\n💺 *Seats Required:*'
    );
  }
  sessionManager.setSession(phone, { step: STEPS.FIND_ASK_PREFERENCE, data: { seatsNeeded: parseInt(text.trim(), 10) } });

  const user = userService.getUserByPhone(phone);
  const isFemale = user && user.Gender === 'Female';

  if (isFemale) {
    await waClient.sendButtons(phone,
      `✅ Seats: *${text.trim()}*\n\n🎯 *Ride Preference:*`,
      [
        { id: 'fp_all', title: '🌐 Open to All' },
        { id: 'fp_women', title: '👩 Women Only' },
      ]
    );
  } else {
    // Non-female users only see "Open to All"
    sessionManager.setSession(phone, { step: STEPS.FIND_ASK_PREFERENCE, data: { ridePreference: 'all' } });
    return performSearch(phone);
  }
}

async function handlePreference(phone, text, session) {
  const map = {
    fp_all: 'all', 'all': 'all', 'open to all': 'all', '🌐 open to all': 'all',
    fp_women: 'women_only', 'women only': 'women_only', 'women': 'women_only', '👩 women only': 'women_only',
  };
  const pref = map[text.trim().toLowerCase()];
  if (!pref) {
    return waClient.sendButtons(phone, '🎯 Please select ride preference:',
      [
        { id: 'fp_all', title: '🌐 Open to All' },
        { id: 'fp_women', title: '👩 Women Only' },
      ]
    );
  }
  sessionManager.setSession(phone, { data: { ridePreference: pref } });
  return performSearch(phone);
}

async function performSearch(phone) {
  await waClient.sendText(phone, '⏳ Searching for matching rides...');

  const session = sessionManager.getSession(phone);
  const { pickupText, destText, preferredTime, seatsNeeded, ridePreference } = session.data;

  const [pickupCoords, destCoords] = await Promise.all([
    mapsService.geocodeAddress(pickupText),
    mapsService.geocodeAddress(destText),
  ]);

  if (!pickupCoords) {
    sessionManager.clearSession(phone);
    return waClient.sendText(phone,
      `❌ Couldn't locate "*${pickupText}*". Please be more specific.\n\nReply *find* to try again.`
    );
  }
  if (!destCoords) {
    sessionManager.clearSession(phone);
    return waClient.sendText(phone,
      `❌ Couldn't locate "*${destText}*". Please be more specific.\n\nReply *find* to try again.`
    );
  }

  const preferredDate = new Date(preferredTime);
  const allRides = rideService.getActiveRides(ridePreference === 'women_only' ? 'women_only' : null);
  const matched = [];

  for (const ride of allRides) {
    if (ride.TotalSeats - ride.BookedSeats < seatsNeeded) continue;

    const pickupDist = mapsService.haversineDistance(
      pickupCoords.lat, pickupCoords.lng, ride.PickupLat, ride.PickupLng
    );
    const destDist = mapsService.haversineDistance(
      destCoords.lat, destCoords.lng, ride.DestLat, ride.DestLng
    );
    const rideTime = new Date(ride.DepartureTime.replace(' ', 'T'));
    const timeDiff = Math.abs((rideTime - preferredDate) / (1000 * 60));

    if (pickupDist <= MAX_PICKUP_RADIUS_KM && destDist <= MAX_PICKUP_RADIUS_KM && timeDiff <= MAX_TIME_DIFF_MINUTES) {
      matched.push(ride);
    }
  }

  if (matched.length === 0) {
    sessionManager.clearSession(phone);
    return waClient.sendText(phone, formatNoRideAvailable(pickupText, destText));
  }

  sessionManager.replaceSession(phone, {
    phone,
    flow: FLOWS.VIEW_RESULTS,
    step: STEPS.RESULTS_SHOW,
    data: {
      results: matched,
      currentIdx: 0,
      seatsNeeded,
      pickupText,
      destText,
    },
  });

  await showRide(phone, matched[0], 1, matched.length);
}

async function handleResults(phone, text, session) {
  const t = text.trim().toLowerCase();
  const { results, currentIdx, seatsNeeded } = session.data;

  if (t === '1' || t === 'yes' || t === 'confirm') {
    const selectedRide = results[currentIdx];
    return require('./bookingFlow').start(phone, selectedRide, seatsNeeded);
  }

  if (t === '2' || t === 'next' || t === 'no') {
    const nextIdx = currentIdx + 1;
    if (nextIdx >= results.length) {
      sessionManager.clearSession(phone);
      const user = userService.getUserByPhone(phone);
      await waClient.sendText(phone,
        '😔 No more rides available.\n\nReply *find* to search again or *Menu* to go back.'
      );
      return require('./mainMenuFlow').show(phone, user);
    }
    sessionManager.setSession(phone, { data: { currentIdx: nextIdx } });
    return showRide(phone, results[nextIdx], nextIdx + 1, results.length);
  }

  if (t === 'menu' || t === 'back' || t === 'cancel') {
    sessionManager.clearSession(phone);
    const user = userService.getUserByPhone(phone);
    return require('./mainMenuFlow').show(phone, user);
  }

  await waClient.sendText(phone,
    'Reply *1* to confirm booking or *2* to see next ride.\nReply *Menu* to go back.'
  );
}

async function showRide(phone, ride, index, total) {
  const driver = userService.getUserById(ride.DriverID);
  await waClient.sendText(phone, formatRideFound(ride, driver, index, total));
}

function formatTimeDisplay(date) {
  let h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

module.exports = { start, handle, handleResults };
