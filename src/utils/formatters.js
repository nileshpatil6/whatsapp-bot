'use strict';

function formatDepartureTime(isoString) {
  if (!isoString) return 'Unknown';
  const date = new Date(isoString.replace(' ', 'T'));
  const now = new Date();

  const isToday = date.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = date.toDateString() === tomorrow.toDateString();

  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const timeStr = `${hours}:${minutes} ${ampm}`;

  if (isToday) return `Today ${timeStr}`;
  if (isTomorrow) return `Tomorrow ${timeStr}`;
  return `${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} ${timeStr}`;
}

function formatRideCard(ride, index, driverName, driverGender) {
  const available = ride.TotalSeats - ride.BookedSeats;
  const vehicle = ride.VehicleType.charAt(0).toUpperCase() + ride.VehicleType.slice(1);
  const price = ride.PricePerSeat === 0 ? 'Free 🎁' : `₹${ride.PricePerSeat}/seat`;
  const pref = ride.RidePreference === 'women_only' ? ' | 👩 Women Only' : '';

  return (
    `*${index}. ${ride.PickupLocation} → ${ride.Destination}*\n` +
    `   🕐 ${formatDepartureTime(ride.DepartureTime)}\n` +
    `   💺 ${available} seat(s) left | 💰 ${price}\n` +
    `   🚗 ${vehicle}${pref}` +
    (driverName ? ` | 👤 ${driverName}` : '')
  );
}

function formatDisclaimer() {
  return (
    '⚠️ *Important Disclaimer*\n\n' +
    'Loopz is an *independent ride-sharing platform* created for employee convenience.\n\n' +
    'We are *NOT* officially affiliated with any company, including your employer.\n\n' +
    'All rides are arranged directly between users at their own discretion and responsibility. ' +
    'Loopz only helps in connecting riders and drivers for office commute.\n\n' +
    '_This disclaimer is shown only once._'
  );
}

function formatMainMenu(userName) {
  return (
    `Hi 👋 Welcome to *Loopz* 🚗\n` +
    `Hello, *${userName}*!\n\n` +
    '_Smart ride sharing for daily office commute._\n\n' +
    'Please choose an option:\n\n' +
    '1️⃣  Offer a Ride\n' +
    '2️⃣  Find a Ride\n' +
    '3️⃣  My Bookings\n' +
    '4️⃣  Help\n\n' +
    '_Reply with 1, 2, 3 or 4_'
  );
}

function formatRideFound(ride, driver, index, total) {
  const available = ride.TotalSeats - ride.BookedSeats;
  const price = ride.PricePerSeat === 0 ? 'Free' : `₹${ride.PricePerSeat}`;
  const pref = ride.RidePreference === 'women_only' ? '\n👩 *Women Only Ride*' : '';

  return (
    `🚗 *Ride Found* (${index} of ${total})${pref}\n\n` +
    `👤 Driver: ${driver ? driver.Name : 'Unknown'}\n` +
    `🗺️ Route: ${ride.PickupLocation} → ${ride.Destination}\n` +
    `🕐 Departure: ${formatDepartureTime(ride.DepartureTime)}\n` +
    `💺 Seats Available: ${available}\n` +
    `💰 Price per Seat: ${price}\n` +
    `🚗 Vehicle: ${ride.VehicleType.charAt(0).toUpperCase() + ride.VehicleType.slice(1)}\n\n` +
    `Reply *1* ✅ to confirm booking\n` +
    `Reply *2* ➡️ to see next ride`
  );
}

function formatBookingConfirmation(booking, ride, driver) {
  const total = booking.TotalAmount === 0 ? 'Free' : `₹${booking.TotalAmount}`;
  return (
    '✅ *Ride Confirmed!*\n\n' +
    `👤 Driver: ${driver ? driver.Name : 'Unknown'}\n` +
    `📞 Contact: +${driver ? driver.Phone : 'N/A'}\n` +
    `🗺️ Route: ${ride.PickupLocation} → ${ride.Destination}\n` +
    `🕐 Departure: ${formatDepartureTime(ride.DepartureTime)}\n` +
    `💺 Seats Booked: ${booking.SeatsBooked}\n` +
    `💰 Total Amount: ${total}\n\n` +
    '_Please contact the driver and coordinate pickup._\n' +
    '_Pay directly to driver via UPI or Cash._\n\n' +
    `🎫 Booking ID: #${booking.BookingID}`
  );
}

function formatSafetyInfo() {
  return (
    '🛡️ *Safety Information*\n\n' +
    'For your safety, please follow these guidelines:\n\n' +
    '• Share your live location with a trusted contact\n' +
    '• Inform a friend or family member before starting the ride\n' +
    '• Verify driver details before boarding\n' +
    '• Avoid sharing personal information during the ride\n\n' +
    '🚨 *Emergency Contact:* Dial 100 (Police)\n\n' +
    '📍 You can also share your ride details with a trusted person.\n\n' +
    '_Stay safe and have a comfortable journey with Loopz_ 🚗'
  );
}

function formatLiabilityNotice() {
  return (
    '⚠️ *Liability Notice*\n\n' +
    'Loopz acts only as a *facilitator* to connect users.\n\n' +
    'We do *NOT*:\n' +
    '• Provide transport services\n' +
    '• Guarantee ride quality or safety\n' +
    '• Take responsibility for delays, cancellations, or disputes\n\n' +
    'Users are responsible for:\n' +
    '• Verifying ride details\n' +
    '• Personal safety\n' +
    '• Payments and coordination'
  );
}

function formatDriverNotification(booking, ride, passenger) {
  return (
    '🔔 *New Booking on Loopz!*\n\n' +
    `👤 ${passenger.Name} has booked *${booking.SeatsBooked}* seat(s) on your ride.\n\n` +
    `🗺️ Route: ${ride.PickupLocation} → ${ride.Destination}\n` +
    `🕐 Departure: ${formatDepartureTime(ride.DepartureTime)}\n` +
    `💺 Booked: ${ride.BookedSeats}/${ride.TotalSeats} seats\n` +
    `📞 Passenger contact: +${passenger.Phone}\n\n` +
    'Reply *3* to view your bookings.'
  );
}

function formatMyBookings(bookings) {
  if (bookings.length === 0) {
    return (
      '📋 *My Bookings*\n\n' +
      'You have no active bookings.\n\n' +
      'Reply *2* to find a ride or *Menu* to go back.'
    );
  }

  let msg = '📋 *My Bookings*\n\n';
  bookings.forEach((b, i) => {
    const price = b.TotalAmount === 0 ? 'Free' : `₹${b.TotalAmount}`;
    const recurring = b.IsRecurring ? ' 🔁' : '';
    msg += `*${i + 1}.* ${b.PickupLocation} → ${b.Destination}\n`;
    msg += `   🕐 ${formatDepartureTime(b.DepartureTime)} | 💺 ${b.SeatsBooked} seat(s) | 💰 ${price}${recurring}\n`;
    msg += `   🎫 #${b.BookingID} | ✅ ${b.Status}\n\n`;
  });

  msg += '_Reply the booking number to cancel, or *Menu* to go back._';
  return msg;
}

function formatHelpText() {
  return (
    'ℹ️ *Help — Loopz*\n\n' +
    '*How it works:*\n' +
    '• Drivers offer rides with price and seats\n' +
    '• Travellers find and join rides\n' +
    '• Payments are made directly to the driver\n\n' +
    '*Commands:*\n' +
    '• Reply *1* — Offer a ride\n' +
    '• Reply *2* — Find a ride\n' +
    '• Reply *3* — My bookings\n' +
    '• Reply *offer* — Shortcut to offer a ride\n' +
    '• Reply *find* — Shortcut to find a ride\n' +
    '• Reply *cancel* — Cancel a booking\n' +
    '• Reply *menu* — Return to main menu\n' +
    '• Reply *restart* — Start over\n\n' +
    '📄 *Terms & Privacy*\n' +
    'By using Loopz you agree to our terms. All rides are between users directly.\n\n' +
    'For support, reply here anytime. 🚗'
  );
}

function formatNoRideAvailable(pickup, dest) {
  return (
    '❌ *No rides available at the moment*\n\n' +
    `Route: ${pickup} → ${dest}\n\n` +
    'Your request has been noted.\n\n' +
    '💡 *What you can do:*\n' +
    '• Try again with a broader area name\n' +
    '• Try a slightly different time\n' +
    '• Ask a colleague to offer a ride on Loopz!\n\n' +
    'Reply *2* to search again or *Menu* to go back.'
  );
}

module.exports = {
  formatDepartureTime, formatRideCard, formatDisclaimer,
  formatMainMenu, formatRideFound, formatBookingConfirmation,
  formatSafetyInfo, formatLiabilityNotice, formatDriverNotification,
  formatMyBookings, formatHelpText, formatNoRideAvailable,
};
