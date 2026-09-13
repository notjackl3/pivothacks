import type { Queue } from "@reelrelay/shared";

type Job = { messageId: string };
/** One renderer at a time. Duplicate pending/running jobs coalesce by message ID. */
export class MemoryQueue implements Queue {
  private pending: Job[] = [];
  private known = new Set<string>();
  private handler?: (data: Job) => Promise<void>;
  private running = false;
  private scheduled = false;
  private idleListeners: Array<() => void> = [];
  constructor(private readonly onError: (error: unknown, job: Job) => void = () => {}) {}
  async add(_name: "generate_reel", data: Job): Promise<void> {
    if (!this.known.has(data.messageId)) {
      this.known.add(data.messageId);
      this.pending.push(data);
    }
    this.schedule();
  }
  process(_name: "generate_reel", handler: (data: Job) => Promise<void>): void {
    if (this.handler && this.handler !== handler) throw new Error("Queue already has a worker.");
    this.handler = handler;
    this.schedule();
  }
  private schedule(): void {
    if (this.scheduled || this.running || !this.handler || !this.pending.length) return;
    this.scheduled = true;
    setImmediate(() => { this.scheduled = false; void this.drain(); });
  }
  private async drain(): Promise<void> {
    if (this.running || !this.handler) return;
    this.running = true;
    try {
      let job: Job | undefined;
      while ((job = this.pending.shift())) {
        try { await this.handler(job); } catch (error) { this.onError(error, job); }
        finally { this.known.delete(job.messageId); }
      }
    } finally {
      this.running = false;
      for (const resolve of this.idleListeners.splice(0)) resolve();
      this.schedule();
    }
  }
  async idle(): Promise<void> {
    if (!this.running && !this.scheduled && this.pending.length === 0) return;
    await new Promise<void>((resolve) => this.idleListeners.push(resolve));
  }
}
export const queue = new MemoryQueue((error, job) => {
  console.error("Queue job failed", { messageId: job.messageId, error: error instanceof Error ? error.name : "UnknownError" });
});
export function getQueue(): Queue { return queue; }
