/** Serial processing queue — one ingest job at a time for CPU stability on localhost/VPS. */
class ProcessingQueueService {
  private chain: Promise<void> = Promise.resolve();
  private pending = 0;

  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    this.pending++;
    const run = this.chain.then(() => fn());
    this.chain = run.then(
      () => undefined,
      () => undefined
    );
    return run.finally(() => {
      this.pending--;
    });
  }

  getPendingCount(): number {
    return this.pending;
  }
}

export const processingQueueService = new ProcessingQueueService();
