import { useState, useEffect, useCallback } from "react";

const CHECK_INTERVAL = 60_000; // check every 60s

export default function useNewVersionCheck() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [initialVersion, setInitialVersion] = useState(null);

  const checkVersion = useCallback(async () => {
    try {
      const res = await fetch("/version.json?t=" + Date.now());
      if (!res.ok) return;
      const { v } = await res.json();
      if (initialVersion === null) {
        setInitialVersion(v);
      } else if (v !== initialVersion) {
        setUpdateAvailable(true);
      }
    } catch {
      // ignore fetch errors
    }
  }, [initialVersion]);

  useEffect(() => {
    checkVersion();
    const timer = setInterval(checkVersion, CHECK_INTERVAL);
    return () => clearInterval(timer);
  }, [checkVersion]);

  return updateAvailable;
}
