'use strict';

const waClient = require('../whatsapp/client');
const sessionManager = require('../state/sessionManager');
const userService = require('../services/userService');
const { FLOWS, STEPS } = require('../utils/constants');
const { isValidName, isValidAreaText } = require('../utils/validators');
const { formatDisclaimer, formatMainMenu } = require('../utils/formatters');

const TOTAL_STEPS = 5;

function progress(step) {
  return `_(Step ${step} of ${TOTAL_STEPS})_`;
}

async function start(phone) {
  sessionManager.setSession(phone, {
    flow: FLOWS.REGISTRATION,
    step: STEPS.REG_ASK_NAME,
    data: {},
  });

  await waClient.sendText(phone,
    '👋 *Welcome to Loopz!* 🚗\n\n' +
    '_Smart ride sharing for daily office commute._\n\n' +
    "Let's get you set up in just *5 quick steps*.\n\n" +
    `${progress(1)} What is your *full name*?`
  );
}

async function handle(phone, text, session) {
  switch (session.step) {
    case STEPS.REG_ASK_NAME:    return handleName(phone, text, session);
    case STEPS.REG_ASK_GENDER:  return handleGender(phone, text, session);
    case STEPS.REG_ASK_HOME:    return handleHome(phone, text, session);
    case STEPS.REG_ASK_OFFICE:  return handleOffice(phone, text, session);
    case STEPS.REG_ASK_VEHICLE: return handleVehicle(phone, text, session);
    default: return start(phone);
  }
}

async function handleName(phone, text, session) {
  if (!isValidName(text)) {
    return waClient.sendText(phone,
      '❌ Please enter a valid name (letters only, e.g. *Rahul Sharma*).\n\n' +
      `${progress(1)} What is your *full name*?`
    );
  }
  sessionManager.setSession(phone, { step: STEPS.REG_ASK_GENDER, data: { name: text.trim() } });

  await waClient.sendButtons(phone,
    `Nice to meet you, *${text.trim()}*! 😊\n\n${progress(2)} What is your *gender*?\n_(Used for women-only ride matching)_`,
    [
      { id: 'gender_female', title: '👩 Female' },
      { id: 'gender_male', title: '👨 Male' },
      { id: 'gender_other', title: '🧑 Other' },
    ]
  );
}

async function handleGender(phone, text, session) {
  const genderMap = {
    gender_female: 'Female', 'female': 'Female', '👩 female': 'Female',
    gender_male: 'Male', 'male': 'Male', '👨 male': 'Male',
    gender_other: 'Other', 'other': 'Other', '🧑 other': 'Other',
  };
  const gender = genderMap[text.trim().toLowerCase()];

  if (!gender) {
    return waClient.sendButtons(phone,
      `${progress(2)} Please select your *gender*:`,
      [
        { id: 'gender_female', title: '👩 Female' },
        { id: 'gender_male', title: '👨 Male' },
        { id: 'gender_other', title: '🧑 Other' },
      ]
    );
  }

  sessionManager.setSession(phone, { step: STEPS.REG_ASK_HOME, data: { gender } });
  await waClient.sendText(phone,
    `${progress(3)} What is your *home area* in Hyderabad?\n\n` +
    '_(e.g. Kondapur, Miyapur, Kukatpally, Madhapur, KPHB)_'
  );
}

async function handleHome(phone, text, session) {
  if (!isValidAreaText(text)) {
    return waClient.sendText(phone,
      '❌ Please enter a valid area name with letters (e.g. *Kondapur*, *Miyapur*).\n\n' +
      `${progress(3)} Your *home area*:`
    );
  }
  sessionManager.setSession(phone, { step: STEPS.REG_ASK_OFFICE, data: { homeArea: text.trim() } });
  await waClient.sendText(phone,
    `${progress(4)} Which *office location* do you commute to?\n\n` +
    '_(e.g. Gachibowli, HITEC City, Nanakramguda, Financial District, Uppal)_'
  );
}

async function handleOffice(phone, text, session) {
  if (!isValidAreaText(text)) {
    return waClient.sendText(phone,
      '❌ Please enter a valid office location (e.g. *Gachibowli*, *HITEC City*).\n\n' +
      `${progress(4)} Your *office location*:`
    );
  }
  sessionManager.setSession(phone, { step: STEPS.REG_ASK_VEHICLE, data: { officeLocation: text.trim() } });

  await waClient.sendButtons(phone,
    `${progress(5)} Do you own a *vehicle* you can use for ride sharing?`,
    [
      { id: 'veh_yes', title: '🚗 Yes, I have one' },
      { id: 'veh_no', title: '🙅 No vehicle' },
    ]
  );
}

async function handleVehicle(phone, text, session) {
  const val = text.trim().toLowerCase();
  let vehicleOwner;

  if (['yes', 'veh_yes', 'y', '🚗 yes, i have one'].includes(val)) vehicleOwner = 'Yes';
  else if (['no', 'veh_no', 'n', '🙅 no vehicle'].includes(val)) vehicleOwner = 'No';
  else {
    return waClient.sendButtons(phone,
      `${progress(5)} Do you own a *vehicle*?`,
      [
        { id: 'veh_yes', title: '🚗 Yes, I have one' },
        { id: 'veh_no', title: '🙅 No vehicle' },
      ]
    );
  }

  const { name, gender, homeArea, officeLocation } = sessionManager.getSession(phone).data;

  // Save to database immediately — no OTP
  const user = userService.createUser({ phone, name, gender, homeArea, officeLocation, vehicleOwner });

  sessionManager.clearSession(phone);
  console.log(`[Registration] ✅ New user: ${name} (${phone})`);

  // Send disclaimer first
  await waClient.sendText(phone, formatDisclaimer());
  userService.markDisclaimerSeen(phone);

  await waClient.sendText(phone,
    `🎉 *You're all set, ${name}!*\n\n` +
    `📍 Home: ${homeArea}\n` +
    `🏢 Office: ${officeLocation}\n` +
    `⚧ Gender: ${gender}\n` +
    `🚗 Vehicle owner: ${vehicleOwner}\n\n` +
    '_Your info is saved. You won\'t need to enter it again._'
  );

  // Show main menu
  return require('./mainMenuFlow').show(phone, user);
}

module.exports = { start, handle };
