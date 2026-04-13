'use strict';

const waClient = require('../whatsapp/client');
const sessionManager = require('../state/sessionManager');
const { FLOWS } = require('../utils/constants');
const userService = require('../services/userService');
const { formatHelpText, formatPrivacyPolicy, formatTermsConditions } = require('../utils/formatters');
const bookingService = require('../services/bookingService');

function getFlow(name) {
  switch (name) {
    case 'registration': return require('./registrationFlow');
    case 'mainMenu':     return require('./mainMenuFlow');
    case 'offerRide':    return require('./offerRideFlow');
    case 'findRide':     return require('./findRideFlow');
    case 'booking':      return require('./bookingFlow');
    case 'myBookings':   return require('./myBookingsFlow');
    case 'postTrip':     return require('./postTripFlow');
    default: throw new Error(`Unknown flow: ${name}`);
  }
}

const RESTART_CMDS  = new Set(['restart', 'reset', '/restart', '/reset']);
const MENU_CMDS     = new Set(['hi', 'hello', 'start', 'menu', '/menu', 'hii', 'hey', 'home']);
const HELP_CMDS     = new Set(['help', '/help']);
const PRIVACY_CMDS  = new Set(['privacy', '/privacy', 'privacy policy']);
const TERMS_CMDS    = new Set(['terms', '/terms', 't&c', 'terms and conditions']);
const OFFER_CMDS    = new Set(['offer', '/offer', 'offer ride']);
const FIND_CMDS     = new Set(['find', '/find', 'find ride', 'search', '/search']);
const BOOKINGS_CMDS = new Set(['bookings', 'my bookings', '/mybookings', 'my rides', '/myridesr']);
const CANCEL_CMDS   = new Set(['cancel', '/cancel']);

async function route(phone, text) {
  const norm = text.trim().toLowerCase();

  // --- Global: restart ---
  if (RESTART_CMDS.has(norm)) {
    sessionManager.clearSession(phone);
    return waClient.sendText(phone, '🔄 Session reset. Send *Hi* to start fresh. 🚗');
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

  const user = userService.getUserByPhone(phone);
  const session = sessionManager.getSession(phone);

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

      case FLOWS.RECURRING:
        return getFlow('booking').handleRecurring(phone, text, session);

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
        return waClient.sendText(phone,
          '📍 *Location Sharing Mode*\n\n' +
          'Share your location via 📎 → *Location* to forward it to the other party.\n\n' +
          '_Reply *menu* to stop and go back to the main menu._'
        );

      default:
        sessionManager.clearSession(phone);
        return waClient.sendText(phone, 'Send *Hi* to get started. 🚗');
    }
  } catch (err) {
    console.error(`[Router] Error for ${phone}:`, err);
    await waClient.sendText(phone,
      '⚠️ Something went wrong. Reply *Menu* to start over or *Restart* to reset.'
    );
  }
}

// Route an incoming WhatsApp location pin (shared via 📎 → Location or live location)
async function routeLocation(phone, locationData) {
  const user = userService.getUserByPhone(phone);

  // If user is not registered, nudge them to register
  if (!user || !user.IsVerified) {
    return waClient.sendText(phone, '📍 Got your location! Please register first. Send *Hi* to start. 👋');
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
        `✅ Your location has been forwarded to your driver *${driver.Name}*.\n\n` +
        '_Keep sharing your location for a safe ride! 🛡️_'
      );
    }
  }

  // No active booking found
  return waClient.sendText(phone,
    '📍 Location received! Share it when prompted during *Offer a Ride* or *Find a Ride*.\n\n' +
    'Reply *menu* to start. 🚗'
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
    return waClient.sendText(phone, '📍 Location noted. Reply *menu* to go back.');
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

async function sendHelp(phone) {
  await waClient.sendText(phone, formatHelpText());
}

async function sendUnsupportedTypeMessage(phone) {
  await waClient.sendText(phone, 'I can only read text messages. Please type your response. 😊');
}

module.exports = { route, routeLocation, sendHelp, sendUnsupportedTypeMessage };
