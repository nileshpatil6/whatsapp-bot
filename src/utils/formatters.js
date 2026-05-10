'use strict';

function formatDepartureTime(isoString) {
  if (!isoString) return 'Unknown';
  const date = new Date(isoString.replace(' ', 'T'));
  const now = new Date();

  const isToday = date.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = date.toDateString() === tomorrow.toDateString();

  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const timeStr = `${hours}:${minutes}`;

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
  const distStr   = ride.DistanceKm ? `\n📏 Distance: ~${ride.DistanceKm.toFixed(1)} km` : '';
  const vehicleLabel  = ride.VehicleType ? (ride.VehicleType.charAt(0).toUpperCase() + ride.VehicleType.slice(1)) : 'N/A';
  const vehicleNumStr = ride.VehicleNumber ? ` (${ride.VehicleNumber})` : '';
  return (
    '✅ *Ride Confirmed!*\n\n' +
    `👤 Rider: ${driver ? driver.Name : 'Unknown'}\n` +
    `📞 Contact: ${driver && driver.ContactPhone ? `+${driver.ContactPhone}` : '_via Telegram_'}\n` +
    `🗺️ Route: ${ride.PickupLocation} → ${ride.Destination}${distStr}\n` +
    `🕐 Departure: ${formatDepartureTime(ride.DepartureTime)}\n` +
    `💺 Seats Booked: ${booking.SeatsBooked}\n` +
    `💰 Total Amount: ${total}\n` +
    `🚗 Vehicle: ${vehicleLabel}${vehicleNumStr}\n\n` +
    '_Please contact the rider and coordinate pickup._\n' +
    '_Pay directly to rider via UPI or Cash._\n\n' +
    `🎫 Booking ID: #${booking.BookingID}`
  );
}

function formatSafetyInfo() {
  return (
    '🛡️ *Safety & Responsibility*\n\n' +
    '• Check rider name/contact before ride\n' +
    '• Share trip details with your ride partner\n' +
    '• Use Live Location if needed\n\n' +
    '🚨 *Emergency:* 100\n\n' +
    '⚠️ Loopz only connects users. Safety, coordination & payments are your responsibility.\n\n' +
    '_Safe ride_ 🚗'
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
    `🆔 Ride #${ride.RideID}\n` +
    `💺 Booked: ${ride.BookedSeats}/${ride.TotalSeats} seats\n` +
    `📞 Commuter contact: ${passenger.ContactPhone ? `+${passenger.ContactPhone}` : '_shared via Telegram_'}\n\n` +
    'Tap *My Bookings* to manage your rides.'
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
    '• Riders offer rides with price and seats\n' +
    '• Commuters find and join rides\n' +
    '• Payments are made directly to the rider\n\n' +
    '*Commands:*\n' +
    '• /offer — Offer a ride\n' +
    '• /find — Find a ride\n' +
    '• /bookings — My bookings\n' +
    '• /cancel — Cancel current action\n' +
    '• /start or /menu — Return to main menu\n' +
    '• /terms — Terms & Privacy\n' +
    '• /feedback — Leave feedback\n\n' +
    '📄 *Legal*\n' +
    'Reply *privacy* to read our Privacy Policy.\n' +
    'Reply *terms* to read our Terms & Conditions.\n' +
    'By using Loopz you agree to our terms. All rides are between users directly.\n\n' +
    'For support, reply here anytime. 🚗'
  );
}

function formatPrivacyPolicy() {
  return (
    '📄 *Loopz Ride Share — Privacy Policy*\n\n' +
    '*1. Introduction*\n' +
    'Loopz values your privacy and is committed to protecting your personal information.\n\n' +
    '*2. Information We Collect*\n' +
    '• Name & phone number\n' +
    '• Ride details (pickup, destination, time)\n\n' +
    '*3. How We Use It*\n' +
    '• Connect you with other users for ride sharing\n' +
    '• Facilitate ride matching\n' +
    '• Improve service quality\n\n' +
    '*4. Information Sharing*\n' +
    'Your name and ride details are shared with matched users.\n' +
    'Loopz does *NOT* sell or share your data with third parties for marketing.\n\n' +
    '*5. Data Security*\n' +
    'We take reasonable steps to protect your data. Since communication happens via Telegram, complete security cannot be guaranteed.\n\n' +
    '*6. User Responsibility*\n' +
    '• Avoid sharing sensitive personal information\n' +
    '• Verify details before sharing contact information\n\n' +
    '*7. Third-Party Platforms*\n' +
    'Loopz operates via Telegram. Use of Telegram is subject to Telegram\'s Terms of Service.\n\n' +
    '*8. Changes to Policy*\n' +
    'This policy may be updated periodically. Continued use of Loopz implies acceptance.\n\n' +
    '*9. Consent*\n' +
    'By using Loopz, you consent to the collection and use of your information as described above.\n\n' +
    '_Reply *menu* to go back. 🚗_'
  );
}

function formatTermsConditions() {
  return (
    '📋 *Loopz Ride Share — Terms & Conditions*\n\n' +
    '*1. Nature of Service*\n' +
    'Loopz is a facilitator only. We do *NOT* provide transport, own vehicles, or employ drivers.\n' +
    'All ride arrangements are made directly between users.\n\n' +
    '*2. User Responsibility*\n' +
    '• Verify ride details before confirming\n' +
    '• Ensure your own safety during travel\n' +
    '• Communicate directly with other users\n' +
    '• Behave respectfully and professionally\n\n' +
    '*3. Payments*\n' +
    'Payments are made directly between rider and commuter. Loopz is not responsible for payment disputes.\n\n' +
    '*4. Safety Disclaimer*\n' +
    'Loopz does not guarantee ride safety, accuracy of user info, or driver/passenger reliability.\n' +
    'Verify identity, share trip details with trusted contacts, and use your judgment.\n\n' +
    '*5. Limitation of Liability*\n' +
    'Loopz shall NOT be held responsible for accidents, injuries, loss of belongings, misconduct, delays, or cancellations.\n' +
    'Use of the platform is at your own risk.\n\n' +
    '*6. User Conduct*\n' +
    'Do not provide false information, misuse the platform, or harass other users.\n' +
    'Loopz reserves the right to remove users who violate these terms.\n\n' +
    '*7. Modifications*\n' +
    'Loopz may update these Terms at any time. Continued use implies acceptance.\n\n' +
    '*8. Acceptance*\n' +
    'By using Loopz, you confirm you have read and agreed to these Terms & Conditions.\n\n' +
    '_Reply *menu* to go back. 🚗_'
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
  formatPrivacyPolicy, formatTermsConditions,
};
