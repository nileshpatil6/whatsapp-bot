'use strict';

const waClient = require('../whatsapp/client');
const sessionManager = require('../state/sessionManager');
const { FLOWS } = require('../utils/constants');
const userService = require('../services/userService');
const { formatHelpText, formatPrivacyPolicy, formatTermsConditions, formatBookingConfirmation, formatSafetyInfo } = require('../utils/formatters');
const bookingService = require('../services/bookingService');
const rideService = require('../services/rideService');

function getFlow(name) {
  switch (name) {
    case 'registration': return require('./registrationFlow');
    case 'mainMenu':     return require('./mainMenuFlow');
    case 'offerRide':    return require('./offerRideFlow');
    case 'findRide':     return require('./findRideFlow');
    case 'booking':      return require('./bookingFlow');
    case 'myBookings':   return require('./myBookingsFlow');
    case 'postTrip':     return require('./postTripFlow');
    case 'feedback':     return require('./feedbackFlow');
    default: throw new Error(`Unknown flow: ${name}`);
  }
}

const RESTART_CMDS   = new Set(['restart', 'reset', '/restart', '/reset']);
const MENU_CMDS      = new Set(['hi', 'hello', 'start', '/start', 'menu', '/menu', 'hii', 'hey', 'home']);
const HELP_CMDS      = new Set(['help', '/help']);
const PRIVACY_CMDS   = new Set(['privacy', '/privacy', 'privacy policy']);
const TERMS_CMDS     = new Set(['terms', '/terms', 't&c', 'terms and conditions']);
const OFFER_CMDS     = new Set(['offer', '/offer', 'offer ride']);
const FIND_CMDS      = new Set(['find', '/find', 'find ride', 'search', '/search']);
const BOOKINGS_CMDS  = new Set(['bookings', '/bookings', 'my bookings', '/mybookings', 'my rides']);
const CANCEL_CMDS    = new Set(['cancel', '/cancel']);
const FEEDBACK_CMDS  = new Set(['feedback', '/feedback', '💬 leave feedback']);

async function route(phone, text) {
  const norm = text.trim().toLowerCase();

  // --- Global: restart ---
  if (RESTART_CMDS.has(norm)) {
    sessionManager.clearSession(phone);
    return waClient.sendText(phone, '🔄 Session reset. Send *Hi* to start fresh. 🚗');
  }

  // --- Global: main menu button (from sendButtons CTAs) ---
  if (norm === 'pf_menu') {
    sessionManager.clearSession(phone);
    const u = userService.getUserByPhone(phone);
    if (!u || !u.IsVerified) return getFlow('registration').start(phone);
    return getFlow('mainMenu').show(phone, u);
  }

  // --- Global: help ---
  if (HELP_CMDS.has(norm)) {
    return sendHelp(phone);
  }

  // --- Global: privacy policy ---
  if (PRIVACY_CMDS.has(norm)) {
    return waClient.sendText(phone, formatPrivacyPolicy());
  }

  // --- Global: terms & conditions ---
  if (TERMS_CMDS.has(norm)) {
    return waClient.sendText(phone, formatTermsConditions());
  }

  // --- Global: security check confirm — reveal OTP then full booking details ---
  if (norm.startsWith('sec_confirm_')) {
    const bookingId = parseInt(norm.replace('sec_confirm_', ''), 10);
    const booking = bookingService.getBookingById(bookingId);
    if (!booking || !booking.VerificationCode) {
      return waClient.sendText(phone, '❌ Booking not found. Check *My Bookings*.');
    }

    const ride   = rideService.getRideById(booking.RideID);
    const driver = ride ? userService.getUserById(ride.DriverID) : null;

    // 3. OTP
    await waClient.sendText(phone,
      `🎫 *Ride Code: ${booking.VerificationCode}*\n_Show this to your rider before boarding._`
    );

    // 4. Full booking details
    await waClient.sendText(phone, formatBookingConfirmation(booking, ride, driver));

    // 5. Safety info
    await waClient.sendText(phone, formatSafetyInfo());

    // 6. Location sharing tip + all set
    await waClient.sendText(phone,
      '📍 *Location Sharing (Optional)*\n\n' +
      'Keep your rider updated:\n' +
      '• Tap 📎 → *Location* in this chat\n' +
      '• Share current location or search\n\n' +
      'Bot will forward it to your rider. 🛡️'
    );
    return waClient.sendButtons(phone,
      '🎉 *All set! Enjoy your ride.*',
      [
        { id: 'pf_feedback', title: '💬 Leave Feedback' },
        { id: 'pf_menu',     title: '📋 Main Menu' },
      ]
    );
  }

  const user = userService.getUserByPhone(phone);
  const session = sessionManager.getSession(phone);

  // --- Global: passenger marks trip complete after boarding confirmation ---
  if (norm.startsWith('passenger_mark_complete_') && user) {
    const bookingId = parseInt(norm.replace('passenger_mark_complete_', ''), 10);
    return handlePassengerMarkComplete(phone, bookingId, user);
  }

  // --- Global shortcut: cancel (must be registered) ---
  if (CANCEL_CMDS.has(norm) && user) {
    sessionManager.clearSession(phone);
    return getFlow('myBookings').start(phone, user);
  }

  // --- Global: menu/greeting ---
  if (MENU_CMDS.has(norm)) {
    if (!user || !user.IsVerified) return getFlow('registration').start(phone);
    return getFlow('mainMenu').show(phone, user);
  }

  // --- Global shortcuts for registered users ---
  if (user && user.IsVerified) {
    if (OFFER_CMDS.has(norm)) {
      sessionManager.clearSession(phone);
      return getFlow('offerRide').start(phone, user);
    }
    if (FIND_CMDS.has(norm)) {
      sessionManager.clearSession(phone);
      return getFlow('findRide').start(phone, user);
    }
    if (BOOKINGS_CMDS.has(norm)) {
      sessionManager.clearSession(phone);
      return getFlow('myBookings').start(phone, user);
    }
    if (FEEDBACK_CMDS.has(norm)) {
      return getFlow('feedback').start(phone, null, 'passenger');
    }
  }

  // --- Global: driver boarding code (4-digit) — only when not mid-flow ---
  // Skip if user is in a flow that expects typed numeric input (time, seats, etc.)
  const flowsExpectingInput = [FLOWS.OFFER_RIDE, FLOWS.FIND_RIDE, FLOWS.REGISTRATION, FLOWS.BOOKING];
  if (/^\d{4}$/.test(norm) && user && (!session || !flowsExpectingInput.includes(session.flow))) {
    const activeRide = rideService.getActiveRideByDriver(user.UserID);
    if (activeRide) {
      return handleBoardingCode(phone, norm, user, activeRide.RideID);
    }
  }

  // --- No session → route to registration or menu ---
  if (!session) {
    if (!user || !user.IsVerified) return getFlow('registration').start(phone);
    return getFlow('mainMenu').show(phone, user);
  }

  // --- Dispatch to current flow ---
  try {
    switch (session.flow) {
      case FLOWS.IDLE:
        if (!user || !user.IsVerified) return getFlow('registration').start(phone);
        return getFlow('mainMenu').show(phone, user);

      case FLOWS.REGISTRATION:
        return getFlow('registration').handle(phone, text, session);

      case FLOWS.MAIN_MENU:
        return getFlow('mainMenu').handle(phone, text, session, user);

      case FLOWS.OFFER_RIDE:
        return getFlow('offerRide').handle(phone, text, session);

      case FLOWS.FIND_RIDE:
        return getFlow('findRide').handle(phone, text, session);

      case FLOWS.BOOKING:
        return getFlow('booking').handle(phone, text, session);

      case FLOWS.MY_BOOKINGS:
        return getFlow('myBookings').handle(phone, text, session);

      case FLOWS.POST_TRIP:
        return getFlow('postTrip').handle(phone, text, session);

      case FLOWS.ACTIVE_RIDE:
        // Allow user to exit location-sharing mode
        if (MENU_CMDS.has(norm) || norm === 'exit' || norm === 'done') {
          sessionManager.clearSession(phone);
          return getFlow('mainMenu').show(phone, user);
        }
        // Feedback button (passenger)
        if (norm === 'pf_feedback' || FEEDBACK_CMDS.has(norm)) {
          const bookingId = session.data ? session.data.bookingId : null;
          const role = session.data ? (session.data.role || 'passenger') : 'passenger';
          return getFlow('feedback').start(phone, bookingId, role);
        }
        // Driver entering passenger's 4-digit boarding code
        if (session.data && session.data.role === 'driver' && /^\d{4}$/.test(norm)) {
          return handleBoardingCode(phone, norm, user, session.data.rideId);
        }
        return waClient.sendButtons(phone,
          '📍 *Location Sharing Mode*\n\n' +
          'Share your location via 📎 → *Location* to forward it to the other party.',
          [{ id: 'pf_menu', title: '📋 Main Menu' }]
        );

      case FLOWS.FEEDBACK:
        return getFlow('feedback').handle(phone, text, session);

      default:
        sessionManager.clearSession(phone);
        return waClient.sendButtons(phone, 'Tap below to get started. 🚗', [{ id: 'pf_menu', title: '📋 Main Menu' }]);
    }
  } catch (err) {
    console.error(`[Router] Error for ${phone}:`, err);
    await waClient.sendButtons(phone,
      '⚠️ Something went wrong.',
      [{ id: 'pf_menu', title: '📋 Main Menu' }]
    );
  }
}

// Route an incoming WhatsApp location pin (shared via 📎 → Location or live location)
async function routeLocation(phone, locationData) {
  const user = userService.getUserByPhone(phone);

  // If user is not registered, nudge them to register
  if (!user || !user.IsVerified) {
    return waClient.sendText(phone, '📍 Got your location! Please register first — send *Hi* to start. 👋');
  }

  const session = sessionManager.getSession(phone);

  // Dispatch to active flow if it expects a location
  if (session) {
    if (session.flow === FLOWS.OFFER_RIDE) {
      return getFlow('offerRide').handleLocation(phone, locationData, session);
    }
    if (session.flow === FLOWS.FIND_RIDE) {
      return getFlow('findRide').handleLocation(phone, locationData, session);
    }
    if (session.flow === FLOWS.ACTIVE_RIDE) {
      return handleActiveRideLocation(phone, locationData, session, user);
    }
  }

  // No active session expecting a location — check if user has an ongoing / upcoming booking
  // to forward the location to the driver (safety feature)
  const activeBookings = bookingService.getActiveBookingsByUser(user.UserID);

  if (activeBookings.length > 0) {
    const booking = activeBookings[0]; // most imminent ride
    const driver  = userService.getUserById(booking.DriverID);
    if (driver) {
      // Forward location to driver
      const tag = locationData.isLive ? '📡 *Live Location Update*' : '📍 *Location Shared*';
      await waClient.sendText(driver.Phone,
        `${tag}\n\n` +
        `👤 ${user.Name} has shared their location for your upcoming ride:\n` +
        `🗺️ ${booking.PickupLocation} → ${booking.Destination}`
      );
      if (locationData.lat && locationData.lng) {
        await waClient.sendLocation(
          driver.Phone, locationData.lat, locationData.lng,
          locationData.name   || user.Name,
          locationData.address || null
        );
      }
      return waClient.sendText(phone,
        `✅ Your location has been forwarded to your rider *${driver.Name}*.\n\n` +
        '_Keep sharing your location for a safe ride! 🛡️_'
      );
    }
  }

  // No active booking found
  return waClient.sendButtons(phone,
    '📍 Location received! Share it when prompted during *Offer a Ride* or *Find a Ride*.',
    [{ id: 'pf_menu', title: '📋 Main Menu' }]
  );
}

// Handle location shared during an ACTIVE_RIDE session
async function handleActiveRideLocation(phone, locationData, session, user) {
  const { driverPhone, driverName, passengerPhone, passengerName, role } = session.data || {};

  let targetPhone, targetName;
  if (role === 'passenger') {
    targetPhone = driverPhone;
    targetName  = driverName;
  } else {
    targetPhone = passengerPhone;
    targetName  = passengerName;
  }

  if (!targetPhone) {
    return waClient.sendButtons(phone, '📍 Location noted.', [{ id: 'pf_menu', title: '📋 Main Menu' }]);
  }

  const tag = locationData.isLive ? '📡 *Live Location Update*' : '📍 *Location Shared*';
  await waClient.sendText(targetPhone,
    `${tag} from *${user.Name}*:`
  );
  if (locationData.lat && locationData.lng) {
    await waClient.sendLocation(
      targetPhone, locationData.lat, locationData.lng,
      locationData.name || user.Name, locationData.address || null
    );
  }
  return waClient.sendText(phone, `✅ Location forwarded to *${targetName}*. 🛡️`);
}

async function handleBoardingCode(phone, code, driver, rideId) {
  // Guard: rideId must be known (set in session when booking was made)
  if (!rideId) {
    return waClient.sendText(phone,
      '❌ Unable to verify — no active ride found in your session.\n' +
      '_Reply *menu* to go back._'
    );
  }

  const booking = bookingService.verifyBoardingCode(code, driver.UserID, rideId);

  if (!booking) {
    return waClient.sendText(phone,
      '❌ *Invalid code.*\n\n' +
      'That code doesn\'t match any commuter on this ride.\n' +
      '_Ask the commuter to check their booking confirmation for the correct 4-digit Ride Code._'
    );
  }

  // Confirm to driver
  await waClient.sendText(phone,
    `✅ *Commuter Confirmed!*\n\n` +
    `👤 ${booking.PassengerName} is on board.\n` +
    `💺 ${booking.SeatsBooked} seat(s) | ${booking.PickupLocation} → ${booking.Destination}\n\n` +
    '_Have a safe ride! 🚗_'
  );

  // Notify passenger with completion CTA
  waClient.sendButtons(booking.PassengerPhone,
    `✅ *Boarding Confirmed!*\n\n` +
    `Your rider has verified your code.\n` +
    `🚗 You\'re on the right ride — enjoy the journey!\n\n` +
    '_Safe ride! 🛡️_',
    [{ id: `passenger_mark_complete_${booking.BookingID}`, title: '✅ Mark Complete' }]
  ).catch(err => console.error('[BoardingCode] Passenger notify failed:', err.message));
}

async function handlePassengerMarkComplete(phone, bookingId, user) {
  if (!bookingId) {
    return waClient.sendText(phone, '❌ Could not find booking. Open *My Bookings* and try again.');
  }
  const booking = bookingService.getBookingById(bookingId);
  if (!booking || booking.UserID !== user.UserID) {
    return waClient.sendText(phone, '❌ Booking not found for your account.');
  }
  return getFlow('feedback').start(phone, bookingId, 'passenger');
}

async function routeContact(phone, contactPhone) {
  const cleaned = String(contactPhone).replace(/[\s\-\+\(\)]/g, '');
  const normalized = cleaned.length === 10 ? `91${cleaned}` : cleaned;
  const session = sessionManager.getSession(phone);
  if (session && session.flow === FLOWS.REGISTRATION) {
    return getFlow('registration').handleContact(phone, normalized, session);
  }
  // Outside registration — update contact phone for existing user
  const user = userService.getUserByPhone(phone);
  if (user) {
    userService.updateContactPhone(phone, normalized);
    return waClient.sendText(phone, `✅ Phone number updated to *+${normalized}*.`);
  }
}

async function sendHelp(phone) {
  await waClient.sendText(phone, formatHelpText());
}

async function sendTerms(phone) {
  await waClient.sendText(phone, formatTermsConditions());
}

async function sendUnsupportedTypeMessage(phone) {
  await waClient.sendText(phone, 'I can only read text messages. Please type your response. 😊');
}

module.exports = { route, routeLocation, routeContact, sendHelp, sendTerms, sendUnsupportedTypeMessage };
