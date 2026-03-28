'use strict';

// Format a SQLite datetime string to a human-readable form
function formatDepartureTime(isoString) {
  if (!isoString) return 'Unknown';

  const date = new Date(isoString.replace(' ', 'T')); // SQLite uses space separator
  const now = new Date();

  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow =
    date.getDate() === tomorrow.getDate() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getFullYear() === tomorrow.getFullYear();

  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;

  const timeStr = `${hours}:${minutes} ${ampm}`;

  if (isToday) return `Today ${timeStr}`;
  if (isTomorrow) return `Tomorrow ${timeStr}`;
  return `${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} ${timeStr}`;
}

// Format a single ride as a numbered card
function formatRideCard(ride, index, driverName) {
  const available = ride.TotalSeats - ride.BookedSeats;
  const vehicle = ride.VehicleType.charAt(0).toUpperCase() + ride.VehicleType.slice(1);
  const price = ride.PricePerSeat === 0 ? 'Free' : `₹${ride.PricePerSeat}/seat`;

  return (
    `*${index}. ${ride.PickupLocation} → ${ride.Destination}*\n` +
    `   🕐 ${formatDepartureTime(ride.DepartureTime)}\n` +
    `   💺 ${available} seat(s) available | 💰 ${price}\n` +
    `   🚗 ${vehicle}` +
    (driverName ? ` | 👤 ${driverName}` : '')
  );
}

function formatMainMenu(userName) {
  return (
    `Welcome back, *${userName}*! 🚗\n\n` +
    '*ICICI RideShare Menu:*\n\n' +
    '1️⃣  Offer a Ride\n' +
    '2️⃣  Find a Ride\n' +
    '3️⃣  My Rides\n' +
    '4️⃣  Help\n\n' +
    '_Reply with a number to continue._'
  );
}

function formatBookingConfirmation(booking, ride, driver, passenger) {
  return (
    '✅ *Ride Booked Successfully!*\n\n' +
    `🎫 Booking ID: #${booking.BookingID}\n` +
    `🚗 Route: ${ride.PickupLocation} → ${ride.Destination}\n` +
    `🕐 Departure: ${formatDepartureTime(ride.DepartureTime)}\n` +
    `💺 Seats: ${booking.SeatsBooked}\n` +
    `💰 Total: ₹${booking.TotalAmount}\n` +
    `👤 Driver: ${driver.Name}\n` +
    `📞 Driver contact: +${driver.Phone}\n\n` +
    '_Pay directly to driver via UPI or Cash._\n' +
    'Reply *Menu* to go back.'
  );
}

function formatDriverNotification(booking, ride, passenger) {
  return (
    '🔔 *New Booking!*\n\n' +
    `👤 ${passenger.Name} has booked *${booking.SeatsBooked}* seat(s) on your ride.\n\n` +
    `🚗 Route: ${ride.PickupLocation} → ${ride.Destination}\n` +
    `🕐 Departure: ${formatDepartureTime(ride.DepartureTime)}\n` +
    `💺 Seats booked: ${ride.BookedSeats}/${ride.TotalSeats}\n` +
    `📞 Passenger contact: +${passenger.Phone}\n\n` +
    'Reply *3* to view all your rides.'
  );
}

function formatMyRides(offeredRides, bookings) {
  let msg = '🚗 *Your Rides*\n\n';

  if (offeredRides.length === 0 && bookings.length === 0) {
    return msg + 'You haven\'t offered or booked any rides yet.\n\nReply *Menu* to get started.';
  }

  if (offeredRides.length > 0) {
    msg += '*Rides You Offered (as Driver):*\n';
    offeredRides.forEach((ride, i) => {
      const available = ride.TotalSeats - ride.BookedSeats;
      const status = ride.Status === 'active' ? '🟢 Active' : ride.Status === 'full' ? '🔴 Full' : '⚫ ' + ride.Status;
      msg += `${i + 1}. ${ride.PickupLocation} → ${ride.Destination} | ${formatDepartureTime(ride.DepartureTime)} | ${available}/${ride.TotalSeats} seats | ${status}\n`;
    });
    msg += '\n';
  }

  if (bookings.length > 0) {
    msg += '*Your Bookings (as Passenger):*\n';
    bookings.forEach((b, i) => {
      msg += `${i + 1}. ${b.PickupLocation} → ${b.Destination} | ${formatDepartureTime(b.DepartureTime)} | ${b.SeatsBooked} seat(s) | ₹${b.TotalAmount} | ✅ ${b.Status}\n`;
    });
  }

  msg += '\nReply *Menu* to go back.';
  return msg;
}

module.exports = {
  formatDepartureTime,
  formatRideCard,
  formatMainMenu,
  formatBookingConfirmation,
  formatDriverNotification,
  formatMyRides,
};
