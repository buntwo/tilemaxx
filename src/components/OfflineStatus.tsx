import { useEffect, useState } from "react";
import { HardDriveDownload, LoaderCircle, TriangleAlert } from "lucide-react";
import type { Game } from "../../shared/model";
import { prepareOfflineApp } from "../offline";
import {
  dictionaryUrl,
  familiarWordsUrl,
  loadWordList,
} from "../word-list-cache";

export default function OfflineStatus({
  game,
  online,
  storageError = false,
}: {
  game?: Game;
  online: boolean;
  storageError?: boolean;
}) {
  const dictionaryId = game?.dictionaryId;
  const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState({ key: "", busy: true, message: "" });
  useEffect(() => {
    if (!dictionaryId) return;
    let cancelled = false;
    setStatus({ key: dictionaryId, busy: true, message: "" });
    const words = async () => {
      for (const url of [
        dictionaryUrl(dictionaryId),
        familiarWordsUrl,
      ]) {
        const result = await loadWordList(url, { refresh: online });
        if (!result.persisted)
          throw new Error(
            "Word lists could not be stored on this device. Free some browser storage and retry.",
          );
      }
    };
    void Promise.allSettled([words(), prepareOfflineApp()]).then((results) => {
      if (cancelled) return;
      const failed = results.find((result) => result.status === "rejected");
      setStatus({
        key: dictionaryId,
        busy: false,
        message:
          failed?.status === "rejected"
            ? failed.reason instanceof Error
              ? failed.reason.message
              : "Offline preparation failed. Reconnect and retry."
            : "",
      });
    });
    return () => {
      cancelled = true;
    };
  }, [dictionaryId, online, retry]);
  if (!dictionaryId) return null;
  const busy = status.key !== dictionaryId || status.busy;
  const message = storageError
    ? "This game could not be saved on this device. Keep this page open and restore browser storage before going offline."
    : status.message;
  if (busy || !message)
    return (
      <span className="offline-status offline-status-label">
        {busy ? (
          <LoaderCircle size={15} className="spin" aria-hidden="true" />
        ) : (
          <HardDriveDownload size={15} aria-hidden="true" />
        )}
        <span>{busy ? "Preparing offline…" : "Available offline"}</span>
      </span>
    );
  return (
    <details className="offline-status">
      <summary className="offline-status-label">
        <TriangleAlert size={15} aria-hidden="true" />
        <span>Offline unavailable</span>
      </summary>
      <div>
        <p>{message}</p>
        <button type="button" onClick={() => setRetry((value) => value + 1)}>
          Retry offline setup
        </button>
      </div>
    </details>
  );
}
