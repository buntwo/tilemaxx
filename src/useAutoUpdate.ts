import { useEffect } from "react";
import { version } from "../version.json";
import { activateOfflineUpdate } from "./offline";
import { preserveBrandForUpdate } from "./components/Brand";

const updateAttemptKey = "tilemaxx:automatic-update-attempt";
const currentVersion = version.split(".").map(Number);

function hasNewerVersion(serverVersion: string | undefined) {
  if (
    typeof serverVersion !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(serverVersion)
  )
    return false;
  const parts = serverVersion.split(".").map(Number);
  const index = parts.findIndex((part, i) => part !== currentVersion[i]);
  return index !== -1 && parts[index] > currentVersion[index];
}

export function useAutoUpdate(
  serverVersion: string | undefined,
  enabled: boolean,
  busy: boolean,
) {
  const availableVersion = hasNewerVersion(serverVersion)
    ? serverVersion
    : undefined;
  useEffect(() => {
    if (!enabled || busy || !availableVersion) return;
    const attempt = `${version} → ${availableVersion}`;
    try {
      if (sessionStorage.getItem(updateAttemptKey) === attempt) return;
    } catch {
      return;
    }

    let checking = false;
    let cancelled = false;
    let retryAfter = 0;
    async function reloadWhenIdle() {
      if (checking || cancelled || Date.now() < retryAfter) return;
      if (
        document.hidden ||
        document.querySelector("dialog[open], .editor-layout") ||
        document.activeElement?.matches(
          "input, select, textarea, [contenteditable]",
        )
      )
        return;
      checking = true;
      try {
        if (
          !(await activateOfflineUpdate(
            () =>
              !cancelled &&
              !document.hidden &&
              !document.querySelector("dialog[open], .editor-layout") &&
              !document.activeElement?.matches(
                "input, select, textarea, [contenteditable]",
              ),
          )) ||
          cancelled
        )
          return;
        clearInterval(timer);
        preserveBrandForUpdate();
        // A cached page may still serve the old build. Attempt this reload once.
        sessionStorage.setItem(updateAttemptKey, attempt);
        window.location.reload();
      } catch {
        // A failed download keeps the current offline app usable.
      } finally {
        checking = false;
        retryAfter = Date.now() + 10_000;
      }
    }

    const timer = setInterval(reloadWhenIdle, 500);
    reloadWhenIdle();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [availableVersion, enabled, busy]);
  return availableVersion;
}
