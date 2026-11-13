// ONE owner for "every request to our API carries the logged-in user's token".
//
// The dashboard talks to the backend three ways — the shared axios instance (api.js),
// bare axios, and ~190 raw fetch() calls — and each call site used to decide for itself
// whether to send a token. Many sent none, and two sent a static password that shipped
// in the public JS bundle. Deciding it per call is how that happened, so it is decided
// here, once: a request to an API origin gets `Authorization: Bearer <jwt>` when a user
// is logged in. Requests to anyone else (Cloudinary, Google, Mercado Libre) are never
// touched — the token must not leave our own backend.
import axios from "axios";

const API_ORIGINS = new Set(
  [
    process.env.REACT_APP_API_URL,
    "https://hanbot-production.up.railway.app",
    "http://localhost:3000",
  ]
    .filter(Boolean)
    .map((u) => {
      try { return new URL(u).origin; } catch { return null; }
    })
    .filter(Boolean)
);

export function isApiUrl(url) {
  try {
    return API_ORIGINS.has(new URL(String(url), window.location.href).origin);
  } catch {
    return false;
  }
}

export function currentToken() {
  try { return localStorage.getItem("token") || null; } catch { return null; }
}

let installed = false;
export function installAuthTransport() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  // --- fetch ---
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" || input instanceof URL ? input : input && input.url;
    const token = currentToken();
    if (!token || !isApiUrl(url)) return nativeFetch(input, init);

    const headers = new Headers(
      (init && init.headers) || (input instanceof Request ? input.headers : undefined)
    );
    headers.set("Authorization", `Bearer ${token}`);
    return nativeFetch(input, { ...(init || {}), headers });
  };

  // --- bare axios (the shared instance in api.js has its own interceptor) ---
  axios.interceptors.request.use((config) => {
    const token = currentToken();
    const full = config.baseURL ? `${config.baseURL}${config.url || ""}` : config.url;
    if (token && isApiUrl(full)) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });
}
