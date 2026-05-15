'use strict';

const waClient = require('../whatsapp/client');
const sessionManager = require('../state/sessionManager');
const userService = require('../services/userService');
const { FLOWS } = require('../utils/constants');
const { isValidName, isValidPhone } = require('../utils/validators');

async function show(phone, user) {
  if (!user) user = userService.getUserByPhone(phone);
  sessionManager.setSession(phone, { flow: FLOWS.PROFILE, step: 'PROFILE_MENU', data: {} });

  const vehicleStr = user.VehicleType && user.VehicleNumber
    ? `${user.VehicleType.charAt(0).toUpperCase() + user.VehicleType.slice(1)} (${user.VehicleNumber})`
    : user.VehicleNumber || '—';

  return waClient.sendButtons(phone,
    `👤 *My Profile*\n\n` +
    `📛 Name: *${user.Name || '—'}*\n` +
    `📞 Mobile: *${user.ContactPhone || '—'}*\n` +
    `🚗 Vehicle: *${vehicleStr}*\n\n` +
    `What would you like to update?`,
    [
      { id: 'prof_name',    title: '📛 Update Name' },
      { id: 'prof_phone',   title: '📞 Update Mobile' },
      { id: 'prof_vehicle', title: '🚗 Update Vehicle No' },
      { id: 'pf_menu',      title: '← Back' },
    ]
  );
}

async function handle(phone, text, session) {
  const t = text.trim().toLowerCase();
  const user = userService.getUserByPhone(phone);

  if (t === 'prof_name' || session.step === 'PROFILE_EDIT_NAME') {
    if (t === 'prof_name') {
      sessionManager.setSession(phone, { step: 'PROFILE_EDIT_NAME', data: {} });
      return waClient.sendButtons(phone, `📛 Enter your new name:`, [{ id: 'pf_menu', title: '← Cancel' }]);
    }
    if (!isValidName(text)) {
      return waClient.sendText(phone, '❌ Invalid name. Use letters only (2-50 chars).\n\nEnter your name:');
    }
    userService.updateName(phone, text.trim());
    sessionManager.clearSession(phone);
    return waClient.sendButtons(phone, `✅ Name updated to *${text.trim()}*`, [{ id: 'menu_profile', title: '👤 My Profile' }, { id: 'pf_menu', title: '🏠 Main Menu' }]);
  }

  if (t === 'prof_phone' || session.step === 'PROFILE_EDIT_PHONE') {
    if (t === 'prof_phone') {
      sessionManager.setSession(phone, { step: 'PROFILE_EDIT_PHONE', data: {} });
      return waClient.sendButtons(phone, `📞 Enter your new mobile number:`, [{ id: 'pf_menu', title: '← Cancel' }]);
    }
    const cleaned = text.replace(/[\s\-\+\(\)]/g, '');
    if (!isValidPhone(text)) {
      return waClient.sendText(phone, '❌ Invalid number. Enter a valid 10-digit mobile number:');
    }
    userService.updateContactPhone(phone, cleaned);
    sessionManager.clearSession(phone);
    return waClient.sendButtons(phone, `✅ Mobile updated to *${cleaned}*`, [{ id: 'menu_profile', title: '👤 My Profile' }, { id: 'pf_menu', title: '🏠 Main Menu' }]);
  }

  if (t === 'prof_vehicle' || session.step === 'PROFILE_EDIT_VEHICLE') {
    if (t === 'prof_vehicle') {
      sessionManager.setSession(phone, { step: 'PROFILE_EDIT_VEHICLE', data: {} });
      return waClient.sendButtons(phone, `🚗 Enter your new vehicle number:\n_(e.g. TS05SS1679)_`, [{ id: 'pf_menu', title: '← Cancel' }]);
    }
    const vNum = text.trim().toUpperCase();
    if (vNum.length < 4 || vNum.length > 15) {
      return waClient.sendText(phone, '❌ Invalid vehicle number. Try again:');
    }
    const vType = user.VehicleType || 'car';
    userService.saveVehicleInfo(phone, vType, vNum);
    sessionManager.clearSession(phone);
    return waClient.sendButtons(phone, `✅ Vehicle updated to *${vNum}*`, [{ id: 'menu_profile', title: '👤 My Profile' }, { id: 'pf_menu', title: '🏠 Main Menu' }]);
  }

  return show(phone, user);
}

module.exports = { show, handle };
