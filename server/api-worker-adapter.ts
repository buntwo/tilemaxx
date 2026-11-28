import type { Worker as NodeWorker } from "node:worker_threads";
import { startApiThread } from "./api-thread";

export class CandidateWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  private worker: NodeWorker;
  private terminating = false;

  constructor(onExit?: () => void) {
    this.worker = startApiThread(
      new URL("./api-candidate.worker.js", import.meta.url),
      new URL("./api-candidate.worker.ts", import.meta.url),
    );
    this.worker.on("message", (data) =>
      this.onmessage?.({ data } as MessageEvent),
    );
    this.worker.on("messageerror", (error) =>
      this.onmessageerror?.({ data: error } as MessageEvent),
    );
    const fail = (error: Error) =>
      this.onerror?.({
        message: error.message,
        error,
        preventDefault() {},
      } as ErrorEvent);
    this.worker.on("error", fail);
    this.worker.on("exit", (code) => {
      onExit?.();
      if (!this.terminating) fail(new Error(`Candidate worker exited with code ${code}.`));
    });
  }
  postMessage(message: unknown) {
    this.worker.postMessage(message);
  }
  terminate() {
    this.terminating = true;
    void this.worker.terminate();
  }
}

export function limitedCandidateWorker(limit: number) {
  let active = 0;
  return class extends CandidateWorker {
    constructor() {
      if (active >= limit) throw new Error("No analysis threads are available.");
      super(() => { active--; });
      active++;
    }
  };
}
