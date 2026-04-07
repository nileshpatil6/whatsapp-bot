'use strict';

const waClient = require('../whatsapp/client');
const sessionManager = require('../state/sessionManager');
const rideService = require('../services/rideService');
const userService = require('../services/userService');
const { FLOWS, STEPS } = require('../utils/constants');
const { formatDepartureTime } = require('../utils/formatters');

const PAGE_SIZE = 9; // leave room for optional "Show More" row (max 10 per list)

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
        { id: 'fp_all', title: '🌐 All Rides' },
        { id: 'fp_women', title: '👩 Women Only' },
      ]
    );
  }

  sessionManager.setSession(phone, {
    flow: FLOWS.FIND_RIDE,
    step: STEPS.FIND_BROWSE,
    data: { ridePreference: 'all', offset: 0 },
  });
  return showRideList(phone, 'all', 0);
}

async function handle(phone, text, session) {
  switch (session.step) {
    case STEPS.FIND_ASK_PREFERENCE: return handlePreference(phone, text, session);
    case STEPS.FIND_BROWSE:         return handleBrowse(phone, text, session);
    case STEPS.FIND_RIDE_SELECTED:  return handleSeatSelect(phone, text, session);
    default: return start(phone);
  }
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
        { id: 'fp_all', title: '🌐 All Rides' },
        { id: 'fp_women', title: '👩 Women Only' },
      ]
    );
  }
  sessionManager.setSession(phone, {
    step: STEPS.FIND_BROWSE,
    data: { ridePreference: pref, offset: 0 },
  });
  return showRideList(phone, pref, 0);
}

async function showRideList(phone, preference, offset) {
  const allRides = rideService.getActiveRides(preference === 'women_only' ? 'women_only' : null);

  if (allRides.length === 0) {
    sessionManager.clearSession(phone);
    return waClient.sendText(phone,
      preference === 'women_only'
        ? '🚗 No women-only rides available right now.\n\nReply *find* to browse all rides or *Menu* to go back.'
        : '🚗 No rides available right now.\n\nAsk a colleague to post a ride on Loopz!\n\nReply *offer* to post one, or *Menu* to go back.'
    );
  }

  const page = allRides.slice(offset, offset + PAGE_SIZE);
  const hasMore = offset + PAGE_SIZE < allRides.length;

  const rows = page.map((ride) => {
    const available = ride.TotalSeats - ride.BookedSeats;
    const price = ride.PricePerSeat === 0 ? 'Free' : `₹${ride.PricePerSeat}/seat`;
    const womenTag = ride.RidePreference === 'women_only' ? ' 👩' : '';
    return {
      id: `ride_${ride.RideID}`,
      title: trunc(`${ride.PickupLocation} → ${ride.Destination}`, 24),
      description: trunc(
        `${formatDepartureTime(ride.DepartureTime)} | ${available} seat(s) | ${price}${womenTag}`, 72
      ),
    };
  });

  if (hasMore) {
    rows.push({
      id: `more_${offset + PAGE_SIZE}`,
      title: '🔄 Show More Rides',
      description: `Showing ${offset + 1}–${offset + page.length} of ${allRides.length} total`,
    });
  }

  const label = preference === 'women_only' ? '👩 Women-Only Rides' : '🚗 Available Rides';
  const bodyText =
    `${label}\n\n` +
    `${allRides.length} ride(s) available.\n` +
    `Tap a ride to view details and book.\n\n` +
    `_Reply *Menu* anytime to go back._`;

  return waClient.sendList(phone, bodyText, 'Browse Rides 🚗', [{ title: label, rows }]);
}

async function handleBrowse(phone, text, session) {
  const t = text.trim().toLowerCase();
  const { ridePreference, offset } = session.data;

  // "Show More" row selected
  if (t.startsWith('more_')) {
    const newOffset = parseInt(t.replace('more_', ''), 10);
    sessionManager.setSession(phone, { data: { offset: newOffset } });
    return showRideList(phone, ridePreference, newOffset);
  }

  // A ride row was tapped
  if (t.startsWith('ride_')) {
    const rideId = parseInt(t.replace('ride_', ''), 10);
    return showRideDetail(phone, rideId, ridePreference, offset || 0);
  }

  // Typed something unexpected — nudge them back
  await waClient.sendText(phone, '👆 Tap a ride from the list to select it, or reply *Menu* to go back.');
}

async function showRideDetail(phone, rideId, ridePreference, offset) {
  const ride = rideService.getRideById(rideId);

  if (!ride || ride.Status !== 'active' || ride.BookedSeats >= ride.TotalSeats) {
    await waClient.sendText(phone, '❌ That ride is no longer available. Refreshing list...');
    return showRideList(phone, ridePreference, 0);
  }

  const driver = userService.getUserById(ride.DriverID);
  const available = ride.TotalSeats - ride.BookedSeats;
  const price = ride.PricePerSeat === 0 ? 'Free' : `₹${ride.PricePerSeat}/seat`;
  const prefLabel = ride.RidePreference === 'women_only' ? '\n👩 *Women Only Ride*' : '';

  sessionManager.setSession(phone, {
    step: STEPS.FIND_RIDE_SELECTED,
    data: { selectedRideId: rideId, maxSeats: available, ridePreference, offset },
  });

  // Build up to 3 seat buttons; if ≤2 seats, use last slot for "← All Rides"
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
    `🚗 Vehicle: ${ride.VehicleType.charAt(0).toUpperCase() + ride.VehicleType.slice(1)}\n\n` +
    `*How many seats do you need?*${moreNote}${backNote}`,
    seatButtons
  );
}

async function handleSeatSelect(phone, text, session) {
  const t = text.trim().toLowerCase();
  const { selectedRideId, maxSeats, ridePreference, offset } = session.data;

  // Back to list
  if (t === 'back_list' || t === 'back' || t === '← all rides') {
    sessionManager.setSession(phone, {
      step: STEPS.FIND_BROWSE,
      data: { ridePreference, offset },
    });
    return showRideList(phone, ridePreference, offset || 0);
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

module.exports = { start, handle };
