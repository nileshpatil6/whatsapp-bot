'use strict';

const waClient = require('../whatsapp/client');
const sessionManager = require('../state/sessionManager');
const userService = require('../services/userService');
const otpService = require('../services/otpService');
const emailService = require('../services/emailService');
const { FLOWS, STEPS } = require('../utils/constants');
const {
  isValidName,
  isValidIciciEmail,
  isValidAreaText,
} = require('../utils/validators');

async function start(phone) {
  sessionManager.setSession(phone, {
    flow: FLOWS.REGISTRATION,
    step: STEPS.REG_ASK_NAME,
    data: {},
  });

  await waClient.sendText(phone,
    '👋 Welcome to *ICICI RideShare*!\n\n' +
    'Share your daily commute with ICICI colleagues, save money, and reduce traffic. 🚗\n\n' +
    'First, I need to verify you\'re an ICICI employee. Let\'s get you registered.\n\n' +
    '*What is your full name?*'
  );
}

async function handle(phone, text, session) {
  switch (session.step) {
    case STEPS.REG_ASK_NAME:
      return handleName(phone, text, session);
    case STEPS.REG_ASK_EMAIL:
      return handleEmail(phone, text, session);
    case STEPS.REG_ASK_HOME:
      return handleHome(phone, text, session);
    case STEPS.REG_ASK_OFFICE:
      return handleOffice(phone, text, session);
    case STEPS.REG_ASK_TIMING:
      return handleTiming(phone, text, session);
    case STEPS.REG_ASK_VEHICLE:
      return handleVehicle(phone, text, session);
    case STEPS.REG_OTP_SENT:
      return handleOtp(phone, text, session);
    default:
      return start(phone);
  }
}

async function handleName(phone, text, session) {
  if (!isValidName(text)) {
    return waClient.sendText(phone,
      '❌ Please enter a valid name (letters only, 2–50 characters).\n\n*What is your full name?*'
    );
  }

  sessionManager.setSession(phone, {
    step: STEPS.REG_ASK_EMAIL,
    data: { name: text.trim() },
  });

  await waClient.sendText(phone,
    `Nice to meet you, *${text.trim()}*! 😊\n\n` +
    'Please enter your *ICICI Bank email address* (must end with @icicibank.com):'
  );
}

async function handleEmail(phone, text, session) {
  const email = text.trim().toLowerCase();

  if (!isValidIciciEmail(email)) {
    return waClient.sendText(phone,
      '❌ Email must end with *@icicibank.com*.\n\n' +
      'Example: *yourname@icicibank.com*\n\n' +
      'Please enter your ICICI email:'
    );
  }

  if (userService.userExistsByEmail(email)) {
    return waClient.sendText(phone,
      '⚠️ This email is already registered.\n\n' +
      'If this is your account, send *Hi* to log in. ' +
      'If you think this is an error, contact support.\n\n' +
      'Send *Hi* to continue.'
    );
  }

  sessionManager.setSession(phone, {
    step: STEPS.REG_ASK_HOME,
    data: { email },
  });

  await waClient.sendText(phone,
    '✅ Email accepted!\n\n' +
    'What is your *home area* in Hyderabad?\n' +
    '_(e.g. Kondapur, Miyapur, Kukatpally, Madhapur)_'
  );
}

async function handleHome(phone, text, session) {
  if (!isValidAreaText(text)) {
    return waClient.sendText(phone,
      '❌ Please enter a valid area name (at least 2 characters).\n\nYour *home area*:'
    );
  }

  sessionManager.setSession(phone, {
    step: STEPS.REG_ASK_OFFICE,
    data: { homeArea: text.trim() },
  });

  await waClient.sendText(phone,
    'Which *ICICI office* do you work at?\n' +
    '_(e.g. HITEC City, Gachibowli, Nanakramguda, Financial District, Uppal)_'
  );
}

async function handleOffice(phone, text, session) {
  if (!isValidAreaText(text)) {
    return waClient.sendText(phone,
      '❌ Please enter a valid office location.\n\nYour *ICICI office*:'
    );
  }

  sessionManager.setSession(phone, {
    step: STEPS.REG_ASK_TIMING,
    data: { officeLocation: text.trim() },
  });

  await waClient.sendText(phone,
    'What are your *office hours*?\n' +
    '_(e.g. 9 AM – 6 PM, 10 AM – 7 PM, Night shift)_'
  );
}

async function handleTiming(phone, text, session) {
  if (!isValidAreaText(text)) {
    return waClient.sendText(phone,
      '❌ Please enter your office hours.\n\n_(e.g. 9 AM – 6 PM)_'
    );
  }

  sessionManager.setSession(phone, {
    step: STEPS.REG_ASK_VEHICLE,
    data: { officeTiming: text.trim() },
  });

  await waClient.sendButtons(phone,
    'Do you own a *vehicle* (car/bike/auto) that you can use for ride sharing?',
    [
      { id: 'vehicle_yes', title: 'Yes, I have a vehicle' },
      { id: 'vehicle_no', title: 'No vehicle' },
    ]
  );
}

async function handleVehicle(phone, text, session) {
  const val = text.trim().toLowerCase();
  let vehicleOwner;

  if (['yes', 'vehicle_yes', 'yes, i have a vehicle', 'y'].includes(val)) {
    vehicleOwner = 'Yes';
  } else if (['no', 'vehicle_no', 'no vehicle', 'n'].includes(val)) {
    vehicleOwner = 'No';
  } else {
    return waClient.sendButtons(phone,
      'Please choose whether you own a vehicle:',
      [
        { id: 'vehicle_yes', title: 'Yes, I have a vehicle' },
        { id: 'vehicle_no', title: 'No vehicle' },
      ]
    );
  }

  sessionManager.setSession(phone, {
    step: STEPS.REG_OTP_SENT,
    data: { vehicleOwner },
  });

  // Re-fetch the full session to get all accumulated data
  const updatedSession = sessionManager.getSession(phone);
  const { name, email } = updatedSession.data;

  // Generate and send OTP
  const otp = otpService.generateOtp(phone);
  const emailResult = await emailService.sendOtpEmail(email, otp, name);

  if (!emailResult.success) {
    // OTP email failed — let user retry
    otpService.clearOtp(phone);
    sessionManager.setSession(phone, { step: STEPS.REG_ASK_VEHICLE }); // back one step
    return waClient.sendText(phone,
      '❌ Failed to send OTP to your email. Please try again.\n\nDo you own a vehicle?'
    );
  }

  await waClient.sendText(phone,
    `📧 A 6-digit OTP has been sent to *${email}*.\n\n` +
    'Please check your inbox (and spam folder) and enter the OTP here:\n\n' +
    '_OTP is valid for 10 minutes._'
  );
}

async function handleOtp(phone, text, session) {
  const input = text.trim();

  if (!/^\d{6}$/.test(input)) {
    return waClient.sendText(phone,
      '❌ OTP must be exactly 6 digits.\n\nPlease enter the OTP from your email:'
    );
  }

  const result = otpService.verifyOtp(phone, input);

  if (result.success) {
    // Create user in database
    const { name, email, homeArea, officeLocation, officeTiming, vehicleOwner } = session.data;
    const user = userService.createUser({ phone, name, email, homeArea, officeLocation, officeTiming, vehicleOwner });

    sessionManager.clearSession(phone);
    console.log(`[Registration] New user registered: ${name} (${phone})`);

    await waClient.sendText(phone,
      `🎉 *Registration complete!* Welcome, ${name}!\n\n` +
      `📍 Home: ${homeArea}\n` +
      `🏢 Office: ${officeLocation}\n` +
      `🚗 Vehicle owner: ${vehicleOwner}\n\n` +
      'You\'re all set to start sharing rides!'
    );

    // Show main menu
    return require('./mainMenuFlow').show(phone, user);
  }

  if (result.reason === 'expired') {
    otpService.clearOtp(phone);
    sessionManager.setSession(phone, { step: STEPS.REG_ASK_VEHICLE });
    return waClient.sendText(phone,
      '⏰ Your OTP has expired.\n\nLet\'s send a new one — do you own a vehicle? Reply *Yes* or *No*'
    );
  }

  if (result.reason === 'too_many_attempts') {
    otpService.clearOtp(phone);
    sessionManager.setSession(phone, { step: STEPS.REG_ASK_VEHICLE });
    return waClient.sendText(phone,
      '❌ Too many incorrect attempts.\n\nLet\'s send a fresh OTP — do you own a vehicle? Reply *Yes* or *No*'
    );
  }

  // Invalid OTP
  const attemptsLeft = result.attemptsLeft || 0;
  await waClient.sendText(phone,
    `❌ Incorrect OTP. You have *${attemptsLeft}* attempt(s) remaining.\n\nPlease enter the 6-digit OTP:`
  );
}

module.exports = { start, handle };
