import { useEffect, useState } from "react";
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
  const ids = [
    ...new Set(
      [
        game?.dictionaryId,
        ...(game?.trackedMoves ?? []).map((move) => move.review?.dictionaryId),
        ...(game?.past ?? []).map((turn) => turn.review?.dictionaryId),
        ...(game?.future ?? []).map((turn) => turn.review?.dictionaryId),
      ].filter((id): id is string => !!id),
    ),
  ]
    .sort()
    .join("\n");
  const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState({ key: "", busy: true, message: "" });
  useEffect(() => {
    if (!ids) return;
    let cancelled = false;
    setStatus({ key: ids, busy: true, message: "" });
    const words = async () => {
      for (const url of [
        ...ids.split("\n").map(dictionaryUrl),
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
        key: ids,
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
  }, [ids, online, retry]);
  if (!ids) return null;
  const busy = status.key !== ids || status.busy;
  const message = storageError
    ? "This game could not be saved on this device. Keep this page open and restore browser storage before going offline."
    : status.message;
  return (
    <details className="offline-status">
      <summary>
        {busy
          ? "Preparing offline…"
          : message
            ? "Offline setup"
            : "Available offline"}
      </summary>
      <div>
        <p>
          {busy
            ? "Downloading this game’s word lists and screenshot tools for offline use."
            : message ||
              "This game, analysis tools, and screenshot import are available offline. Edits sync when Tilemaxx is reachable again."}
        </p>
        {!busy && message && (
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry offline setup
          </button>
        )}
      </div>
    </details>
  );
}
