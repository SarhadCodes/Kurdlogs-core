import { env } from '../config/env';
import {
  assertMcrPortConfig,
  assertMcrRtmpUrl,
  buildMcrInternalIngestUrl,
  buildMcrPublicIngestServerUrl,
  buildMcrPublicIngestUrl,
  buildMcrRtmpUrl,
  getMcrBusRtmpUrl,
  getMcrRtmpApp,
} from '../config/mcrRtmp';
import {
  logNginxApplications,
  logNginxStatRaw,
  parseNginxApplicationNames,
  resolveNginxRtmpApp,
} from '../config/nginxRtmpStat';
import { logger } from '../utils/logger';
import { mcrRelayService } from './mcrRelay.service';
import { mcrSourceSessionService } from './mcrSourceSession.service';

const SAMPLE_CHANNEL_ID = '00000000-0000-4000-8000-000000000001';
const SAMPLE_SOURCE_ID = '11111111-1111-4111-8111-111111111111';

class McrRtmpAuditService {
  runStartupAudit(): void {
    assertMcrPortConfig();
    const rtmpApp = getMcrRtmpApp();

    const ingestExample = buildMcrPublicIngestUrl('studio-camera-1');
    const ingestServer = buildMcrPublicIngestServerUrl();
    const internalIngest = buildMcrInternalIngestUrl('studio-camera-1');
    const programBus = getMcrBusRtmpUrl(SAMPLE_CHANNEL_ID);
    const sessionKey = mcrSourceSessionService.getSessionKey(SAMPLE_CHANNEL_ID, SAMPLE_SOURCE_ID);
    const sessionRtmp = buildMcrRtmpUrl(sessionKey);
    const programEncoderInput = programBus;
    const programEncoderOutput = '/stream/{slug}/master.m3u8';

    const urls: Array<[string, string]> = [
      ['INGEST_URL', ingestExample],
      ['INGEST_SERVER', ingestServer],
      ['INTERNAL_INGEST', internalIngest],
      ['PROGRAM_BUS_URL', programBus],
      ['SESSION_RTMP_URL', sessionRtmp],
      ['PROGRAM_ENCODER_INPUT', programEncoderInput],
      ['RELAY_BUS_URL', mcrRelayService.getBusRtmpUrl(SAMPLE_CHANNEL_ID)],
    ];

    for (const [label, url] of urls) {
      assertMcrRtmpUrl(url, label);
    }

    logger.info(
      `[MCR_RTMP_AUDIT] INGEST_URL=${ingestExample} INGEST_SERVER=${ingestServer} ` +
        `INTERNAL_INGEST=${internalIngest} PROGRAM_BUS_URL=${programBus} ` +
        `SESSION_RTMP_URL=${sessionRtmp} PROGRAM_ENCODER_INPUT=${programEncoderInput} ` +
        `PROGRAM_ENCODER_OUTPUT=${programEncoderOutput} NGINX_RTMP_PORT=${env.MCR_RTMP_PORT} ` +
        `NGINX_RTMP_HOST=${env.NGINX_RTMP_HOST} RTMP_APP=${rtmpApp} ` +
        `PUBLIC_PUBLISH_PORT=${env.RTMP_PUBLISH_PORT} POLICY=no-port-1935=ok`
    );

    void this.auditNginxApplications();
  }

  private async auditNginxApplications(): Promise<void> {
    try {
      const res = await fetch(`http://${env.NGINX_RTMP_HOST}:8080/stat`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        logger.warn(`[MCR_NGINX_APPLICATIONS] stat request failed status=${res.status}`);
        return;
      }
      const xml = await res.text();
      logNginxStatRaw(xml);
      const configuredApp = getMcrRtmpApp();
      const discoveredApps = parseNginxApplicationNames(xml);
      const resolvedApp = resolveNginxRtmpApp(configuredApp, discoveredApps);
      logNginxApplications(discoveredApps, configuredApp, resolvedApp);
    } catch (err) {
      logger.warn(`[MCR_NGINX_APPLICATIONS] stat unreachable: ${err}`);
    }
  }
}

export const mcrRtmpAuditService = new McrRtmpAuditService();
