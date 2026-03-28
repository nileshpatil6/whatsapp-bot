'use strict';

const { OTP_EXPIRY_MS, OTP_MAX_ATTEMPTS } = require('../utils/constants');

// In-memory OTP store: Map<phone, { otp, expiresAt, attempts }>
const otpStore = new Map();

function generateOtp(phone) {
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  otpStore.set(phone, {
    otp,
    expiresAt: Date.now() + OTP_EXPIRY_MS,
    attempts: 0,
  });
  return otp;
}

// Returns: { success: true } | { success: false, reason: 'expired'|'invalid'|'too_many_attempts' }
function verifyOtp(phone, input) {
  const entry = otpStore.get(phone);

  if (!entry) return { success: false, reason: 'expired' };
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(phone);
    return { success: false, reason: 'expired' };
  }
  if (entry.attempts >= OTP_MAX_ATTEMPTS) {
    return { success: false, reason: 'too_many_attempts' };
  }
  if (entry.otp !== input.trim()) {
    entry.attempts++;
    return { success: false, reason: 'invalid', attemptsLeft: OTP_MAX_ATTEMPTS - entry.attempts };
  }

  otpStore.delete(phone);
  return { success: true };
}

function clearOtp(phone) {
  otpStore.delete(phone);
}

function hasOtp(phone) {
  return otpStore.has(phone);
}

module.exports = { generateOtp, verifyOtp, clearOtp, hasOtp };
