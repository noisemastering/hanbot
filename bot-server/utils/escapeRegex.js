// A search box holds TEXT. Handed to `new RegExp()` / `$regex` unescaped, the text is a
// PATTERN instead: "(" throws (the search 500s), ".*" matches everything, and a crafted
// pattern can pin a CPU for seconds. Escape it and it means what the person typed.
const escapeRegex = (s) => String(s == null ? "" : s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
module.exports = { escapeRegex };
