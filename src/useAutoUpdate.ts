import { useEffect, useState } from "react";
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
  const [requestedVersion, setRequestedVersion] = useState<string>();
  const [failure, setFailure] = useState<{ version: string; message: string }>();
  const manual = !!availableVersion && requestedVersion === availableVersion;
  useEffect(() => {
    if ((!enabled && !manual) || busy || !availableVersion) return;
    const nextVersion = availableVersion;
    const attempt = `${version} → ${nextVersion}`;
    if (!manual) {
      try {
        if (sessionStorage.getItem(updateAttemptKey) === attempt) return;
      } catch {
        return;
      }
    }

    let checking = false;
    let cancelled = false;
    let retryAfter = 0;
    const canReload = () =>
      !cancelled &&
      !document.hidden &&
      !document.querySelector("dialog[open], .editor-layout") &&
      !document.activeElement?.matches("input, select, textarea, [contenteditable]");
    function fail(message: string) {
      if (!manual || cancelled) return;
      setFailure({ version: nextVersion, message });
      setRequestedVersion(undefined);
    }
    async function reloadWhenIdle() {
      if (checking || Date.now() < retryAfter || !canReload()) return;
      checking = true;
      try {
        const activated = await activateOfflineUpdate(canReload);
        if (!canReload()) return;
        if (!activated) {
          fail("The update could not start. Close any other Tilemaxx tabs and try again.");
          return;
        }
        clearInterval(timer);
        preserveBrandForUpdate();
        sessionStorage.setItem(updateAttemptKey, attempt);
        window.location.reload();
      } catch {
        fail("The update could not be downloaded. Try again.");
      } finally {
        checking = false;
        retryAfter = Date.now() + 10_000;
      }
    }

    const timer = setInterval(reloadWhenIdle, 500);
    void reloadWhenIdle();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [availableVersion, enabled, busy, manual]);
  return {
    availableVersion,
    updating: manual,
    updateError: failure?.version === availableVersion ? failure?.message : undefined,
    requestUpdate() {
      if (busy || !availableVersion) return;
      setFailure(undefined);
      setRequestedVersion(availableVersion);
    },
  };
}
