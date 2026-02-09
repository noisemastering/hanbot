// ai/utils/businessHours.js
// Shared utility for business hours checking

/**
 * Check if we're currently in business hours (Mon-Fri, 9am-6pm Mexico City time)
 * @returns {boolean}
 */
function isBusinessHours() {
  const now = new Date();
  const mexicoTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Mexico_City" }));

  const day = mexicoTime.getDay(); // 0 = Sunday, 6 = Saturday
  const hour = mexicoTime.getHours();

  const isWeekday = day >= 1 && day <= 5;
  const isDuringHours = hour >= 9 && hour < 18;

  return isWeekday && isDuringHours;
}

/**
 * Check if a specific date/time was during business hours (Mon-Fri, 9am-6pm Mexico City time)
 * @param {Date} date - The date to check
 * @returns {boolean}
 */
function wasBusinessHours(date) {
  const mexicoTime = new Date(date.toLocaleString("en-US", { timeZone: "America/Mexico_City" }));

  const day = mexicoTime.getDay();
  const hour = mexicoTime.getHours();

  const isWeekday = day >= 1 && day <= 5;
  const isDuringHours = hour >= 9 && hour < 18;

  return isWeekday && isDuringHours;
}

module.exports = { isBusinessHours, wasBusinessHours };
