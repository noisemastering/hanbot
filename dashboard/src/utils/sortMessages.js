// utils/sortMessages.js
//
// Chronological ordering for conversation transcripts. Rendering a chat in the
// right order is the UI's job — never assume the API hands them back sorted (or
// newest-first). Several views used to `.reverse()` the response, which silently
// jumbled the transcript whenever the API's order differed.
//
// Messages with no/invalid timestamp sink to the end, keeping their relative order
// (Array.prototype.sort is stable), so they can never scramble the dated ones.
export function byTimestampAsc(list) {
  const arr = Array.isArray(list) ? [...list] : [];
  return arr.sort((a, b) => {
    const ta = a && a.timestamp ? new Date(a.timestamp).getTime() : NaN;
    const tb = b && b.timestamp ? new Date(b.timestamp).getTime() : NaN;
    const va = Number.isFinite(ta) ? ta : Infinity;
    const vb = Number.isFinite(tb) ? tb : Infinity;
    return va - vb;
  });
}

export default byTimestampAsc;
