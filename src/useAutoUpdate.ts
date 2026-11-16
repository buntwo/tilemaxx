import { useEffect } from "react";
import { version } from "../package.json";
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
  useEffect(() => {
    if (!enabled || busy || !hasNewerVersion(serverVersion)) return;
    const attempt = `${version} → ${serverVersion}`;
    try {
      if (sessionStorage.getItem(updateAttemptKey) === attempt) return;
    } catch {
      return;
    }

    function reloadWhenIdle() {
      if (
        document.hidden ||
        document.querySelector("dialog[open], .editor-layout") ||
        document.activeElement?.matches(
          "input, select, textarea, [contenteditable]",
        )
      )
        return;
      clearInterval(timer);
      try {
        preserveBrandForUpdate();
        // A cached page may still serve the old build. Attempt this reload once.
        sessionStorage.setItem(updateAttemptKey, attempt);
      } catch {
        return;
      }
      window.location.reload();
    }

    const timer = setInterval(reloadWhenIdle, 500);
    reloadWhenIdle();
    return () => clearInterval(timer);
  }, [serverVersion, enabled, busy]);
}
