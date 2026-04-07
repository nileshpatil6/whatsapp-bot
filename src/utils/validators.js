'use strict';

// Name: letters, spaces, dots, hyphens — 2-50 chars, must have at least 2 letters
function isValidName(text) {
  const t = text.trim();
  return /^[a-zA-Z][a-zA-Z\s.\-']{1,49}$/.test(t) && /[a-zA-Z]{2,}/.test(t);
}

// Area/location: must contain at least 2 letters, no pure numbers
function isValidAreaText(text) {
  const t = text.trim();
  if (t.length < 2 || t.length > 150) return false;
  if (!/[a-zA-Z]{2,}/.test(t)) return false; // must have at least 2 consecutive letters
  if (/^\d+$/.test(t)) return false;          // pure numbers rejected
  return true;
}

function isValidSeats(text) {
  const n = parseInt(text.trim(), 10);
  return !isNaN(n) && n >= 1 && n <= 6;
}

function isValidBookingSeats(text, maxSeats) {
  const n = parseInt(text.trim(), 10);
  return !isNaN(n) && n >= 1 && n <= maxSeats;
}

function isValidPrice(text) {
  const n = parseInt(text.trim(), 10);
  return !isNaN(n) && n >= 0 && n <= 9999;
}

function isValidRating(text) {
  const n = parseInt(text.trim(), 10);
  return !isNaN(n) && n >= 1 && n <= 5;
}

// Parse time input — returns a Date or null
function parseTimeInput(text) {
  const t = text.trim().toLowerCase();
  const isTomorrow = t.includes('tomorrow');
  const cleaned = t.replace('tomorrow', '').replace('today', '').trim();

  let hours = null;
  let minutes = 0;

  // "9:30 AM" or "09:30 AM" or "9:30"
  const match1 = cleaned.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);
  if (match1) {
    hours = parseInt(match1[1], 10);
    minutes = parseInt(match1[2], 10);
    const ampm = match1[3];
    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;
  }

  // "9 AM" or "9AM"
  if (hours === null) {
    const match2 = cleaned.match(/^(\d{1,2})\s*(am|pm)$/);
    if (match2) {
      hours = parseInt(match2[1], 10);
      const ampm = match2[2];
      if (ampm === 'pm' && hours < 12) hours += 12;
      if (ampm === 'am' && hours === 12) hours = 0;
    }
  }

  // "930" → 9:30, "0900" → 9:00
  if (hours === null) {
    const match3 = cleaned.match(/^(\d{3,4})$/);
    if (match3) {
      const raw = parseInt(match3[1], 10);
      hours = Math.floor(raw / 100);
      minutes = raw % 100;
    }
  }

  // "9" — bare number, assume AM if < 12
  if (hours === null) {
    const match4 = cleaned.match(/^(\d{1,2})$/);
    if (match4) {
      hours = parseInt(match4[1], 10);
    }
  }

  if (hours === null || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);

  if (isTomorrow) {
    date.setDate(date.getDate() + 1);
  } else if (date <= now) {
    date.setDate(date.getDate() + 1);
  }

  return date;
}

function formatDateForDb(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
         `${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

module.exports = {
  isValidName, isValidAreaText, isValidSeats, isValidBookingSeats,
  isValidPrice, isValidRating, parseTimeInput, formatDateForDb,
};
