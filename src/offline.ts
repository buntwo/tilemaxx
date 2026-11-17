/** Install the production app and its screenshot tools without keeping them in RAM. */
let preparing: Promise<void> | undefined;
export function prepareOfflineApp(): Promise<void> {
  return (preparing ??= prepare().catch((error) => {
    preparing = undefined;
    throw error;
  }));
}
async function prepare(): Promise<void> {
  if (!globalThis.isSecureContext || !("serviceWorker" in navigator))
    throw new Error(
      "Offline reopening needs an HTTPS address. Game edits and downloaded word lists still stay on this device.",
    );
  if (import.meta.env.DEV)
    throw new Error("Offline reopening is available in the production build.");
  const registration = await navigator.serviceWorker.register("/sw.js", {
    updateViaCache: "none",
  });
  const worker =
    registration.active ??
    (await new Promise<ServiceWorker>((resolve, reject) => {
      const installing = registration.installing ?? registration.waiting;
      if (!installing)
        return reject(new Error("Offline setup could not start."));
      const timeout = setTimeout(
        () =>
          finish(new Error("Offline setup timed out. Reconnect and retry.")),
        90_000,
      );
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        installing.removeEventListener("statechange", changed);
        if (error) reject(error);
        else resolve(installing);
      };
      const changed = () => {
        if (installing.state === "activated") finish();
        else if (installing.state === "redundant")
          finish(
            new Error(
              "Could not download the offline app. Reconnect and retry.",
            ),
          );
      };
      installing.addEventListener("statechange", changed);
      changed();
    }));
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const finish = (ready: boolean) => {
      clearTimeout(timeout);
      channel.port1.close();
      if (ready) resolve();
      else
        reject(
          new Error(
            "Screenshot tools are not available offline yet. Reconnect and retry.",
          ),
        );
    };
    const timeout = setTimeout(() => finish(false), 90_000);
    channel.port1.onmessage = ({ data }) => finish(data.ready === true);
    worker.postMessage({ kind: "prepare-offline" }, [channel.port2]);
  });
}

/** Activate only at an idle reload boundary; other tabs keep their running build. */
export async function activateOfflineUpdate(
  canActivate: () => boolean = () => true,
): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return true;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration?.active) return true;
  await registration.update();
  if (registration.installing) {
    const installing = registration.installing;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => finish(new Error("Update download timed out.")),
        60_000,
      );
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        installing.removeEventListener("statechange", changed);
        error ? reject(error) : resolve();
      };
      const changed = () => {
        if (
          installing.state === "installed" ||
          installing.state === "activated"
        )
          finish();
        else if (installing.state === "redundant")
          finish(new Error("Update download failed."));
      };
      installing.addEventListener("statechange", changed);
      changed();
    });
  }
  const waiting = registration.waiting;
  if (!waiting || !canActivate()) return false;
  return new Promise<boolean>((resolve) => {
    const channel = new MessageChannel();
    const finish = (ready: boolean) => {
      clearTimeout(timeout);
      channel.port1.close();
      waiting.removeEventListener("statechange", changed);
      resolve(ready);
    };
    const timeout = setTimeout(() => finish(false), 10_000);
    const changed = () => {
      if (waiting.state === "activated") finish(true);
      else if (waiting.state === "redundant") finish(false);
    };
    waiting.addEventListener("statechange", changed);
    channel.port1.onmessage = ({ data }) => {
      if (!data.activating) finish(false);
      else changed();
    };
    waiting.postMessage({ kind: "activate-update" }, [channel.port2]);
  });
}
