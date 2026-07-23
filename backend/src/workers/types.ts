/**
 * Worker abstraction — future multi-node / CDN deployment.
 * v12: local-only implementation; interfaces stable for BoostNode workers later.
 */

export type WorkerCapability = 'ingest' | 'stream' | 'benchmark';

export interface WorkerNodeInfo {
  id: string;
  name: string;
  host: string;
  capabilities: WorkerCapability[];
  maxChannels: number;
  activeJobs: number;
  online: boolean;
}

export interface IngestJobPayload {
  itemId: string;
  sourcePath: string;
  outputPath: string;
  playlistId: string;
  brandEnabled: boolean;
  mode: 'remux' | 'transcode' | 'transcode_brand';
}

export interface WorkerDispatchResult {
  accepted: boolean;
  workerId: string;
  message?: string;
}

/** Local worker — all jobs run in-process on this server (localhost / single VPS). */
export interface IngestWorkerAdapter {
  readonly workerId: string;
  canAcceptJob(): boolean;
  dispatchIngest(payload: IngestJobPayload): Promise<WorkerDispatchResult>;
  listNodes(): Promise<WorkerNodeInfo[]>;
}
