'use strict';

const axios = require('axios');

// Geocode a text address to { lat, lng, formattedAddress }
// Always appends Hyderabad, India for accuracy
async function geocodeAddress(addressText) {
  const query = `${addressText.trim()}, Hyderabad, Telangana, India`;
  const url = 'https://maps.googleapis.com/maps/api/geocode/json';

  try {
    const response = await axios.get(url, {
      params: {
        address: query,
        key: process.env.GOOGLE_MAPS_API_KEY,
      },
      timeout: 8000,
    });

    const data = response.data;

    if (data.status === 'ZERO_RESULTS' || !data.results || data.results.length === 0) {
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

// Haversine formula — returns distance in kilometres between two lat/lng points
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth radius in km
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

module.exports = { geocodeAddress, haversineDistance };
