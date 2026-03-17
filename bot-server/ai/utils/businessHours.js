// ai/utils/businessHours.js
// Shared utility for business hours checking (Mon-Fri 8am-6pm Mexico City, holiday-aware)

const OPEN_HOUR = 8;
const CLOSE_HOUR = 18;

// ── Mexican holiday helpers ──────────────────────────────────────────

/**
 * Compute Easter Sunday for a given year (Anonymous Gregorian algorithm).
 * Returns { month (1-based), day }.
 */
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/**
 * Get the Nth weekday of a month.
 * @param {number} year
 * @param {number} month - 0-based (0=Jan)
 * @param {number} weekday - 0=Sun, 1=Mon, …
 * @param {number} n - 1=first, 2=second, 3=third
 * @returns {number} day of month
 */
function nthWeekday(year, month, weekday, n) {
  const first = new Date(year, month, 1).getDay();
  let day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  return day;
}

/**
 * Build the set of Mexican holidays for a given year as "MM-DD" strings.
 * Includes federal mandatory holidays + de-facto business closures.
 */
function getHolidays(year) {
  const holidays = new Set();
  const add = (m, d) => holidays.add(`${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);

  // ── Fixed-date holidays ──
  add(1, 1);   // Año Nuevo
  add(5, 1);   // Día del Trabajo
  add(9, 16);  // Día de la Independencia
  add(11, 2);  // Día de Muertos
  add(12, 12); // Día de la Virgen de Guadalupe
  add(12, 24); // Nochebuena
  add(12, 25); // Navidad
  add(12, 31); // Fin de Año

  // ── Movable federal holidays ──
  // 1st Monday of February — Día de la Constitución
  add(2, nthWeekday(year, 1, 1, 1));
  // 3rd Monday of March — Natalicio de Benito Juárez
  add(3, nthWeekday(year, 2, 1, 3));
  // 3rd Monday of November — Revolución Mexicana
  add(11, nthWeekday(year, 10, 1, 3));

  // ── Semana Santa (Holy Thursday + Good Friday) ──
  const easter = easterSunday(year);
  const easterDate = new Date(year, easter.month - 1, easter.day);
  const holyThursday = new Date(easterDate);
  holyThursday.setDate(easterDate.getDate() - 3);
  const goodFriday = new Date(easterDate);
  goodFriday.setDate(easterDate.getDate() - 2);
  add(holyThursday.getMonth() + 1, holyThursday.getDate());
  add(goodFriday.getMonth() + 1, goodFriday.getDate());

  return holidays;
}

/**
 * Check if a Mexico-City Date falls on a Mexican holiday.
 */
function isMexicanHoliday(mxDate) {
  const year = mxDate.getFullYear();
  const holidays = getHolidays(year);
  const key = `${String(mxDate.getMonth() + 1).padStart(2, '0')}-${String(mxDate.getDate()).padStart(2, '0')}`;
  return holidays.has(key);
}

/**
 * Check if a Mexico-City Date is a business day (weekday + not a holiday).
 */
function isBusinessDay(mxDate) {
  const day = mxDate.getDay();
  if (day === 0 || day === 6) return false;
  return !isMexicanHoliday(mxDate);
}

// ── Core business hours functions ────────────────────────────────────

/**
 * Get current Mexico City time as a Date object.
 */
function getMexicoNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
}

/**
 * Check if we're currently in business hours (Mon-Fri 8am-6pm, not a holiday).
 */
function isBusinessHours() {
  const mx = getMexicoNow();
  const hour = mx.getHours();
  return isBusinessDay(mx) && hour >= OPEN_HOUR && hour < CLOSE_HOUR;
}

/**
 * Check if a specific date/time was during business hours.
 */
function wasBusinessHours(date) {
  const mx = new Date(date.toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
  const hour = mx.getHours();
  return isBusinessDay(mx) && hour >= OPEN_HOUR && hour < CLOSE_HOUR;
}

/**
 * Get the last business hours close (6pm Mexico City) as a UTC Date.
 */
function getLastBusinessClose() {
  const now = new Date();
  const mx = getMexicoNow();

  // Walk backwards to find the last business day at or before today
  const candidate = new Date(mx);
  if (isBusinessDay(candidate) && mx.getHours() >= CLOSE_HOUR) {
    // Today after close — today 6pm
    candidate.setHours(CLOSE_HOUR, 0, 0, 0);
  } else {
    // Go back day by day until we find a business day
    candidate.setDate(candidate.getDate() - 1);
    while (!isBusinessDay(candidate)) {
      candidate.setDate(candidate.getDate() - 1);
    }
    candidate.setHours(CLOSE_HOUR, 0, 0, 0);
  }

  // Convert from Mexico-tz representation back to real UTC
  const offsetMs = now.getTime() - mx.getTime();
  return new Date(candidate.getTime() + offsetMs);
}

/**
 * Find the next business day at OPEN_HOUR starting from a Mexico-City Date.
 * Returns a new Date in Mexico-tz representation.
 */
function nextBusinessOpen(mxDate) {
  const next = new Date(mxDate);
  next.setDate(next.getDate() + 1);
  next.setHours(OPEN_HOUR, 0, 0, 0);
  while (!isBusinessDay(next)) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

/**
 * Get a human-friendly string for the next business hours window.
 */
function getNextBusinessTimeStr() {
  const mx = getMexicoNow();
  const hour = mx.getHours();
  const dayNames = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

  // If today is a business day and before opening → "hoy a las 8am"
  if (isBusinessDay(mx) && hour < OPEN_HOUR) {
    return `hoy a las ${OPEN_HOUR}am`;
  }

  // Find the next business open
  const next = nextBusinessOpen(mx);
  const diffDays = Math.round((new Date(next.getFullYear(), next.getMonth(), next.getDate()) -
                                new Date(mx.getFullYear(), mx.getMonth(), mx.getDate())) / 86400000);

  if (diffDays === 1) {
    return `mañana ${dayNames[next.getDay()]} a las ${OPEN_HOUR}am`;
  }

  // e.g. "el lunes a las 8am"
  return `el ${dayNames[next.getDay()]} a las ${OPEN_HOUR}am`;
}

/**
 * Get the appropriate timing message for handoff responses.
 */
function getHandoffTimingMessage(suffix = '') {
  if (isBusinessHours()) {
    return `En un momento te atienden${suffix}.`;
  }
  return `Nuestro horario de atención es de lunes a viernes de 8am a 6pm. Un especialista te contactará ${getNextBusinessTimeStr()}${suffix}.`;
}

module.exports = { isBusinessHours, wasBusinessHours, getLastBusinessClose, getNextBusinessTimeStr, getHandoffTimingMessage, isMexicanHoliday, isBusinessDay };
