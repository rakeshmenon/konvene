/** Sends each chunk to the writer worker and waits until it is on disk. */
export class OpfsChunkSink {
  createWorker;
  worker = null;
  nextId = 1;
  pending = new Map();
  constructor(createWorker) {
    this.createWorker = createWorker;
  }
  async open(stagingName) {
    const worker = this.createWorker();
    worker.onmessage = (e) => this.settle(e.data);
    worker.onerror = (e) => this.failAll(new Error(e.message || "The file writer stopped."));
    this.worker = worker;
    await this.request({ op: "open", name: stagingName });
  }
  async append(chunk) {
    const buffer = await chunk.arrayBuffer();
    await this.request({ op: "append", buffer }, [buffer]);
  }
  async close() {
    if (!this.worker) return 0;
    try {
      return await this.request({ op: "close" });
    } finally {
      this.worker.terminate();
      this.worker = null;
    }
  }
  request(message, transfer = []) {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error("The file writer is not open."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ ...message, id }, transfer);
    });
  }
  settle(reply) {
    const waiting = this.pending.get(reply.id);
    if (!waiting) return;
    this.pending.delete(reply.id);
    if (reply.ok) waiting.resolve(reply.bytes);
    else waiting.reject(new Error(reply.error));
  }
  failAll(error) {
    for (const w of this.pending.values()) w.reject(error);
    this.pending.clear();
  }
}

/**
 * The part of a Worker this class uses, so a test can pass a fake.
 * @typedef {object} WorkerLike
 * @property {(message: unknown, transfer?: Transferable[]) => void} postMessage
 * @property {() => void} terminate
 * @property {((e: MessageEvent) => void) | null} onmessage
 * @property {((e: ErrorEvent) => void) | null} onerror
 */

/**
 * @typedef {{ id: number; ok: true; bytes: number } | { id: number; ok: false; error: string }} Reply
 */
