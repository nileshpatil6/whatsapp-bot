'use strict';

const waClient = require('../whatsapp/client');
const sessionManager = require('../state/sessionManager');
const rideService = require('../services/rideService');
const userService = require('../services/userService');
const mapsService = require('../services/mapsService');
const { FLOWS, STEPS, RESULTS_PAGE_SIZE, MAX_PICKUP_RADIUS_KM, MAX_TIME_DIFF_MINUTES } = require('../utils/constants');
const { isValidAreaText, parseTimeInput, formatDateForDb } = require('../utils/validators');
const { formatRideCard } = require('../utils/formatters');

async function start(phone) {
  sessionManager.setSession(phone, {
    flow: FLOWS.FIND_RIDE,
    step: STEPS.FIND_ASK_PICKUP,
    data: {},
  });

  await waClient.sendText(phone,
    '🔍 *Find a Ride*\n\n' +
    'Where will you be *picked up from*?\n' +
    '_(e.g. Kondapur, Miyapur Metro, Kukatpally)_\n\n' +
    '_Reply *Cancel* at any time to go back._'
  );
}

async function handle(phone, text, session) {
  switch (session.step) {
    case STEPS.FIND_ASK_PICKUP: return handlePickup(phone, text, session);
    case STEPS.FIND_ASK_DEST:   return handleDest(phone, text, session);
    case STEPS.FIND_ASK_TIME:   return handleTime(phone, text, session);
    default: return start(phone);
  }
}

async function handlePickup(phone, text, session) {
  if (!isValidAreaText(text)) {
    return waClient.sendText(phone, '❌ Please enter a valid area name.\n\nYour *pickup area*:');
  }
  sessionManager.setSession(phone, { step: STEPS.FIND_ASK_DEST, data: { pickupText: text.trim() } });
  await waClient.sendText(phone,
    'Where are you *going*?\n_(e.g. ICICI HITEC City, Nanakramguda, Financial District)_'
  );
}

async function handleDest(phone, text, session) {
  if (!isValidAreaText(text)) {
    return waClient.sendText(phone, '❌ Please enter a valid destination.\n\nYour *destination*:');
  }
  sessionManager.setSession(phone, { step: STEPS.FIND_ASK_TIME, data: { destText: text.trim() } });
  await waClient.sendText(phone,
    'What\'s your *preferred departure time*?\n_(e.g. 9 AM, 8:30 AM)_'
  );
}

async function handleTime(phone, text, session) {
  const parsed = parseTimeInput(text);
  if (!parsed) {
    return waClient.sendText(phone,
      '❌ Could not understand that time.\n_(e.g. *9 AM*, *8:30 AM*)_\n\nPreferred time:'
    );
  }

  await waClient.sendText(phone, '⏳ Searching for matching rides...');

  const s = sessionManager.getSession(phone).data;
  const preferredTime = parsed;

  // Geocode user's pickup and destination
  const [pickupCoords, destCoords] = await Promise.all([
    mapsService.geocodeAddress(s.pickupText),
    mapsService.geocodeAddress(s.destText),
  ]);

  if (!pickupCoords) {
    return waClient.sendText(phone,
      `❌ Couldn't locate "*${s.pickupText}*". Please be more specific.\n\nReply *2* to try again.`
    );
  }
  if (!destCoords) {
    return waClient.sendText(phone,
      `❌ Couldn't locate "*${s.destText}*". Please be more specific.\n\nReply *2* to try again.`
    );
  }

  // Fetch all active rides and apply matching logic
  const allRides = rideService.getActiveRides();
  const matched = [];

  for (const ride of allRides) {
    const pickupDist = mapsService.haversineDistance(
      pickupCoords.lat, pickupCoords.lng,
      ride.PickupLat, ride.PickupLng
    );
    const destDist = mapsService.haversineDistance(
      destCoords.lat, destCoords.lng,
      ride.DestLat, ride.DestLng
    );

    const rideTime = new Date(ride.DepartureTime.replace(' ', 'T'));
    const timeDiffMinutes = Math.abs((rideTime - preferredTime) / (1000 * 60));

    if (
      pickupDist <= MAX_PICKUP_RADIUS_KM &&
      destDist <= MAX_PICKUP_RADIUS_KM &&
      timeDiffMinutes <= MAX_TIME_DIFF_MINUTES
    ) {
      matched.push(ride);
    }
  }

  if (matched.length === 0) {
    sessionManager.clearSession(phone);
    return waClient.sendText(phone,
      '😔 No rides found matching your criteria.\n\n' +
      '💡 *Tips:*\n' +
      '• Try a broader area name (e.g. "Kondapur" instead of "Kondapur Bus Stop")\n' +
      '• Try a different time (±30 min window)\n\n' +
      'Reply *2* to search again or *Menu* to go back.'
    );
  }

  // Store results in session for pagination
  sessionManager.replaceSession(phone, {
    phone,
    flow: FLOWS.VIEW_RESULTS,
    step: STEPS.RESULTS_SHOW,
    data: {
      results: matched,
      page: 0,
      searchParams: { pickupText: s.pickupText, destText: s.destText },
    },
  });

  await displayPage(phone, sessionManager.getSession(phone));
}

async function handleResults(phone, text, session) {
  const t = text.trim().toLowerCase();
  const { results, page } = session.data;
  const totalPages = Math.ceil(results.length / RESULTS_PAGE_SIZE);

  if (t === 'next' || t === 'more') {
    if (page + 1 >= totalPages) {
      return waClient.sendText(phone, 'No more rides. Reply a number to join, or *Menu* to go back.');
    }
    sessionManager.setSession(phone, { data: { page: page + 1 } });
    return displayPage(phone, sessionManager.getSession(phone));
  }

  if (t === 'menu' || t === 'back') {
    sessionManager.clearSession(phone);
    const user = userService.getUserByPhone(phone);
    return require('./mainMenuFlow').show(phone, user);
  }

  // Numbered selection
  const idx = parseInt(t, 10);
  const absoluteIdx = page * RESULTS_PAGE_SIZE + (idx - 1);

  if (isNaN(idx) || idx < 1 || absoluteIdx >= results.length) {
    return waClient.sendText(phone, `Please reply with a number (1–${Math.min(RESULTS_PAGE_SIZE, results.length - page * RESULTS_PAGE_SIZE)}), *Next* for more, or *Menu* to go back.`);
  }

  const selectedRide = results[absoluteIdx];
  return require('./bookingFlow').start(phone, selectedRide);
}

async function displayPage(phone, session) {
  const { results, page } = session.data;
  const start = page * RESULTS_PAGE_SIZE;
  const pageRides = results.slice(start, start + RESULTS_PAGE_SIZE);
  const totalPages = Math.ceil(results.length / RESULTS_PAGE_SIZE);

  let msg = `🚗 *Rides Found* (${results.length} total, page ${page + 1}/${totalPages})\n\n`;

  for (let i = 0; i < pageRides.length; i++) {
    const ride = pageRides[i];
    const driver = userService.getUserById(ride.DriverID);
    msg += formatRideCard(ride, i + 1, driver ? driver.Name : 'Unknown') + '\n\n';
  }

  msg += '_Reply *1';
  if (pageRides.length > 1) msg += `–${pageRides.length}`;
  msg += '* to join a ride';
  if (page + 1 < totalPages) msg += ' | *Next* for more';
  msg += ' | *Menu* to go back_';

  await waClient.sendText(phone, msg);
}

module.exports = { start, handle, handleResults };
