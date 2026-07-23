import { Request, Response } from 'express';
import { mcrIngestService } from '../services/mcrIngest.service';
import { logger } from '../utils/logger';

/**
 * nginx-rtmp on_publish callback (no JWT — secret query param).
 *
 * CRITICAL: nginx-rtmp does NOT activate the published stream until this callback
 * returns 2xx. Any slow work here (spawning the live encoder, ffprobe/HLS inspection
 * in onLiveConnected→getSnapshot) keeps the stream in limbo: `rtmp_stat` shows
 * nclients=0, the consumer cannot read the stream, and the session tears down.
 * So we authorize the publish IMMEDIATELY and run all heavy work asynchronously.
 */
export const ingestOnPublish = (req: Request, res: Response): void => {
  if (!mcrIngestService.validateSecret(String(req.query.secret ?? ''))) {
    res.status(403).send('forbidden');
    return;
  }
  const name = String(req.body?.name ?? req.query?.name ?? '');
  const addr = String(req.body?.addr ?? req.query?.addr ?? '');
  if (!name) {
    res.status(400).send('missing name');
    return;
  }

  // Authorize first — nginx-rtmp can now activate the stream without delay.
  res.status(200).send('ok');

  // Encoder spawn + snapshot/ffprobe run off the RTMP critical path.
  void mcrIngestService
    .handlePublish(name, addr || undefined)
    .catch((e) => logger.error(`[MCR_INGEST] handlePublish failed name=${name}: ${String(e)}`));
};

export const ingestOnPublishDone = (req: Request, res: Response): void => {
  if (!mcrIngestService.validateSecret(String(req.query.secret ?? ''))) {
    res.status(403).send('forbidden');
    return;
  }
  const name = String(req.body?.name ?? req.query?.name ?? '');
  if (!name) {
    res.status(400).send('missing name');
    return;
  }

  res.status(200).send('ok');

  void mcrIngestService
    .handlePublishDone(name)
    .catch((e) => logger.error(`[MCR_INGEST] handlePublishDone failed name=${name}: ${String(e)}`));
};
