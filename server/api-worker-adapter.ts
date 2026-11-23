import { Worker as NodeWorker } from "node:worker_threads";

export class CandidateWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  private worker: NodeWorker;

  constructor() {
    this.worker = new NodeWorker(
      new URL("./api-candidate.worker.js", import.meta.url),
      { execArgv: [] },
    );
    this.worker.on("message", (data) =>
      this.onmessage?.({ data } as MessageEvent),
    );
    this.worker.on("messageerror", (error) =>
      this.onmessageerror?.({ data: error } as MessageEvent),
    );
    this.worker.on("error", (error) =>
      this.onerror?.({
        message: error.message,
        error,
        preventDefault() {},
      } as ErrorEvent),
    );
  }
  postMessage(message: unknown) {
    this.worker.postMessage(message);
  }
  terminate() {
    void this.worker.terminate();
  }
}
