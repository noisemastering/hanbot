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

/**
 * Get the last business hours close (6pm Mexico City) as a UTC Date.
 * On Monday morning → Friday 6pm; on Tuesday morning → Monday 6pm; etc.
 * @returns {Date} UTC date of the last business close
 */
function getLastBusinessClose() {
  const now = new Date();
  const mxStr = now.toLocaleString("en-US", { timeZone: "America/Mexico_City" });
  const mx = new Date(mxStr);

  const day = mx.getDay();
  const hour = mx.getHours();

  let daysBack = 0;

  if (day === 0) {          // Sunday → Friday 6pm
    daysBack = 2;
  } else if (day === 6) {   // Saturday → Friday 6pm
    daysBack = 1;
  } else if (day === 1 && hour < 18) { // Monday before 6pm → Friday 6pm
    daysBack = 3;
  } else if (hour < 18) {   // Weekday before 6pm → yesterday 6pm
    daysBack = 1;
  }
  // Weekday at/after 6pm → today 6pm (daysBack stays 0)

  const cutoffMx = new Date(mx);
  cutoffMx.setDate(cutoffMx.getDate() - daysBack);
  cutoffMx.setHours(18, 0, 0, 0);

  // Convert from Mexico-tz representation back to real UTC
  const offsetMs = now.getTime() - mx.getTime();
  return new Date(cutoffMx.getTime() + offsetMs);
}

module.exports = { isBusinessHours, wasBusinessHours, getLastBusinessClose };
