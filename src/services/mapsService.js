'use strict';

const axios = require('axios');

// Geocode a text address to { lat, lng, formattedAddress }
// Always appends Hyderabad, India for accuracy
async function geocodeAddress(addressText) {
  if (!process.env.GOOGLE_MAPS_API_KEY) return null;

  const query = `${addressText.trim()}, India`;
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

// Get a short display name from a location message
// Uses the name/address provided first; falls back to reverse geocoding (only if API key is set)
async function getDisplayName(lat, lng, waName, waAddress) {
  if (waName && waName.trim()) return waName.trim();
  if (waAddress && waAddress.trim()) {
    return waAddress.split(',')[0].trim();
  }
  if (process.env.GOOGLE_MAPS_API_KEY) {
    const geo = await reverseGeocode(lat, lng);
    if (geo) return geo.name;
  }
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
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

// Get actual road distance via Google Maps Routes API (returns km)
// Falls back to haversine if API fails or key is missing
async function getRouteDistance(lat1, lng1, lat2, lng2) {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return haversineDistance(lat1, lng1, lat2, lng2);
  }

  try {
    const url = 'https://routes.googleapis.com/directions/v2:computeRoutes';
    const response = await axios.post(url, {
      origin: { location: { latLng: { latitude: lat1, longitude: lng1 } } },
      destination: { location: { latLng: { latitude: lat2, longitude: lng2 } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
    }, {
      headers: {
        'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'routes.distanceMeters',
      },
      timeout: 8000,
    });

    const routes = response.data?.routes;
    if (!routes || routes.length === 0) {
      console.warn('[Maps] No route found, falling back to haversine');
      return haversineDistance(lat1, lng1, lat2, lng2);
    }

    const distanceMeters = routes[0].distanceMeters || 0;
    const distanceKm = distanceMeters / 1000;
    return distanceKm;
  } catch (err) {
    console.error('[Maps] Route distance API failed:', err.message);
    return haversineDistance(lat1, lng1, lat2, lng2);
  }
}

// Auto-calculate price per seat based on distance slab and vehicle type
// Bike: 0-3km ₹9/km | 4-6km ₹8/km | 7-10km ₹7/km | 11-20km ₹6/km | 20+km ₹5/km
// Car:  0-3km ₹16/km | 4-6km ₹13/km | 7-10km ₹10/km | 11-20km ₹8/km | 21-30km ₹6/km | 30+km ₹5/km
function calculatePrice(distanceKm, vehicleType) {
  const d = distanceKm;
  if (vehicleType === 'bike') {
    if (d <= 3)  return Math.max(18, Math.round(d * 9));
    if (d <= 6)  return Math.round(d * 8);
    if (d <= 10) return Math.round(d * 7);
    if (d <= 20) return Math.round(d * 6);
    return Math.round(d * 5);
  }
  // car (default for all other vehicle types)
  if (d <= 3)  return Math.max(32, Math.round(d * 16));
  if (d <= 6)  return Math.round(d * 13);
  if (d <= 10) return Math.round(d * 10);
  if (d <= 20) return Math.round(d * 8);
  if (d <= 30) return Math.round(d * 6);
  return Math.round(d * 5);
}

// Search for up to 4 matching places for a query in Hyderabad
// Returns array of { name, shortAddr, lat, lng }
async function searchPlaces(query) {
  if (!process.env.GOOGLE_MAPS_API_KEY) return [];
  const q = `${query.trim()}, India`;
  try {
    const res = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: { address: q, key: process.env.GOOGLE_MAPS_API_KEY },
      timeout: 8000,
    });
    if (res.data.status !== 'OK' || !res.data.results?.length) return [];
    return res.data.results.slice(0, 4).map(r => {
      const parts = r.formatted_address.split(',').map(s => s.trim());
      const name = parts[0];
      const shortAddr = parts.slice(1, 3).join(', ');
      return { name, shortAddr, lat: r.geometry.location.lat, lng: r.geometry.location.lng };
    });
  } catch (err) {
    console.error('[Maps] searchPlaces failed:', err.message);
    return [];
  }
}

module.exports = { geocodeAddress, reverseGeocode, getDisplayName, haversineDistance, getRouteDistance, calculatePrice, searchPlaces };
