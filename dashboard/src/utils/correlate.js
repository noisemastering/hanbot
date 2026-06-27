// utils/correlate.js
//
// POST /analytics/correlate-conversions now returns 202 immediately and runs the
// correlation in the BACKGROUND (the synchronous version timed out at Railway's
// edge → a 502 with no CORS header, which the browser reported as a CORS error).
// This helper kicks the job off and resolves when it finishes, by polling the
// progress endpoint. Returns the final result object (or throws on error/timeout).
import API from "../api";

export async function correlateAndWait(params = {}, opts = {}) {
  const { sellerId = "482595248", onProgress, timeoutMs = 240000, pollMs = 1500 } = opts;
  await API.post("/analytics/correlate-conversions", { sellerId, ...params });
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollMs));
    let p;
    try {
      const res = await API.get(`/analytics/correlate-conversions/progress?sellerId=${sellerId}`);
      p = res.data;
    } catch {
      continue; // transient network blip — keep polling
    }
    if (onProgress && p) onProgress(p);
    if (p?.status === "completed") return p.result || p;
    if (p?.status === "error") throw new Error(p.error || "Correlation failed");
    // 'running' / 'idle' → keep polling
  }
  throw new Error("Correlation timed out");
}
