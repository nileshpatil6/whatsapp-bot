'use strict';

const axios = require('axios');

// Geocode a text address to { lat, lng, formattedAddress }
// Always appends Hyderabad, India for accuracy
async function geocodeAddress(addressText) {
  const query = `${addressText.trim()}, Hyderabad, Telangana, India`;
  const url = 'https://maps.googleapis.com/maps/api/geocode/json';

  try {
    const response = await axios.get(url, {
      params: { address: query, key: process.env.GOOGLE_MAPS_API_KEY },
      timeout: 8000,
    });
    const data = response.data;
    if (data.status === 'ZERO_RESULTS' || !data.results || !data.results.length) {
      console.warn(`[Maps] No results for: "${addressText}"`);
      return null;
    }
    if (data.status !== 'OK') {
      console.error(`[Maps] Geocoding error: ${data.status}`);
      return null;
    }
    const { lat, lng } = data.results[0].geometry.location;
    const formattedAddress = data.results[0].formatted_address;
    return { lat, lng, formattedAddress };
  } catch (err) {
    console.error('[Maps] Geocoding request failed:', err.message);
    return null;
  }
}

// Reverse geocode lat/lng to a short human-readable area name
async function reverseGeocode(lat, lng) {
  const url = 'https://maps.googleapis.com/maps/api/geocode/json';
  try {
    const response = await axios.get(url, {
      params: { latlng: `${lat},${lng}`, key: process.env.GOOGLE_MAPS_API_KEY },
      timeout: 8000,
    });
    const data = response.data;
    if (data.status !== 'OK' || !data.results || !data.results.length) return null;

    const result = data.results[0];
    const components = result.address_components || [];

    // Prefer sublocality → locality → formatted_address
    const sublocality = components.find(c => c.types.includes('sublocality_level_1'));
    const locality    = components.find(c => c.types.includes('locality'));
    const name = sublocality?.long_name || locality?.long_name || result.formatted_address;

    return { name, formattedAddress: result.formatted_address };
  } catch (err) {
    console.error('[Maps] Reverse geocode failed:', err.message);
    return null;
  }
}

// Get a short display name from a WhatsApp location message
// Uses the name/address provided by WhatsApp first; falls back to reverse geocoding
async function getDisplayName(lat, lng, waName, waAddress) {
  if (waName && waName.trim()) return waName.trim();
  if (waAddress && waAddress.trim()) {
    // Take just the first part of the address (before first comma)
    return waAddress.split(',')[0].trim();
  }
  const geo = await reverseGeocode(lat, lng);
  return geo ? geo.name : `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

// Haversine formula — returns distance in kilometres between two lat/lng points
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

// Auto-calculate price per seat based on distance slab and vehicle type
// Bike slabs:  0-3 km ₹12/km | 3-5 ₹10/km | 5-8 ₹8/km | 8-15 ₹6/km | 15+ ₹5/km
// Car slabs:   0-3 km ₹18/km | 3-5 ₹15/km | 5-8 ₹12/km | 8-15 ₹8/km | 15+ ₹7/km
// Auto/other:  flat ₹10/km
function calculatePrice(distanceKm, vehicleType) {
  const d = distanceKm;
  if (vehicleType === 'bike') {
    if (d <= 3)  return Math.max(20, Math.round(d * 12));
    if (d <= 5)  return Math.round(d * 10);
    if (d <= 8)  return Math.round(d * 8);
    if (d <= 15) return Math.round(d * 6);
    return Math.round(d * 5);
  }
  if (vehicleType === 'car') {
    if (d <= 3)  return Math.max(40, Math.round(d * 18));
    if (d <= 5)  return Math.round(d * 15);
    if (d <= 8)  return Math.round(d * 12);
    if (d <= 15) return Math.round(d * 8);
    return Math.round(d * 7);
  }
  // auto or other vehicle
  return Math.max(30, Math.round(d * 10));
}

module.exports = { geocodeAddress, reverseGeocode, getDisplayName, haversineDistance, calculatePrice };
