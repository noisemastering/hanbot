// utils/quoteSessions.js
//
// One chat is not one conversation. A customer who writes on the 3rd about a
// borde and on the 19th about a roll had two conversations in the same thread,
// and a quote belongs to one of them. A VISIT ends when the thread goes quiet
// for 12 h — the same boundary the engine ("new visit") and the audit use.
//
// Pure functions: no DB, no model, no network.
const GAP_MS = 12 * 60 * 60 * 1000;
const NUMBER_RE = /^\d{4,6}$/;

// A pasted folio often arrives as "Cot. #12345" or with spaces; keep the digits.
function cleanQuoteNumber(raw) {
  const digits = String(raw == null ? "" : raw).replace(/\D/g, "");
  return NUMBER_RE.test(digits) ? digits : null;
}

/**
 * @param {Array<{timestamp:Date|string,senderType:string,text:string}>} messages  any order
 * @returns {Array<{index,start,end,count,userCount,firstUserText,messages}>} oldest first
 */
function splitSessions(messages, gapMs = GAP_MS) {
  const rows = (messages || [])
    .filter((m) => m && m.timestamp)
    .map((m) => ({ ...m, _t: new Date(m.timestamp).getTime() }))
    .filter((m) => Number.isFinite(m._t))
    .sort((a, b) => a._t - b._t);
  const out = [];
  let cur = null;
  for (const m of rows) {
    if (!cur || m._t - cur._last > gapMs) {
      cur = { messages: [], _last: m._t };
      out.push(cur);
    }
    cur.messages.push(m);
    cur._last = m._t;
  }
  return out.map((s, i) => {
    const users = s.messages.filter((m) => m.senderType === "user");
    return {
      index: i,
      start: new Date(s.messages[0]._t),
      end: new Date(s._last),
      count: s.messages.length,
      userCount: users.length,
      firstUserText: users.length ? String(users[0].text || "").slice(0, 120) : null,
      messages: s.messages.map(({ _t, ...m }) => m),
    };
  });
}

// The visit a moment belongs to; a moment between two visits goes to the one
// before it (a hand-off stamped seconds after the last message is that visit's).
function sessionIndexAt(sessions, at) {
  if (!sessions.length) return -1;
  const t = at ? new Date(at).getTime() : NaN;
  if (!Number.isFinite(t)) return sessions.length - 1;
  let best = 0;
  for (const s of sessions) if (s.start.getTime() <= t) best = s.index;
  return best;
}

// Which visit already carries which quote: the stored window overlaps the visit.
function quotesOfSession(session, quotes) {
  const a = session.start.getTime(), b = session.end.getTime();
  return (quotes || []).filter((q) => {
    const s = q.sessionStart ? new Date(q.sessionStart).getTime() : null;
    const e = q.sessionEnd ? new Date(q.sessionEnd).getTime() : s;
    if (s == null) return false;
    return s <= b && e >= a;
  });
}

module.exports = { GAP_MS, cleanQuoteNumber, splitSessions, sessionIndexAt, quotesOfSession };
