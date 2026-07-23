#!/usr/bin/env node
/**
 * Long-runtime observer verification for blueprint channels.
 * Usage: node scripts/verify-blueprint-runtime.mjs <blueprintId> <channelId> [token]
 * Checks at 1, 5, 15, 30, 60 minutes (or --intervals=60,300,... seconds).
 */
const BASE = process.env.API_URL || 'http://localhost:3001/api';
const blueprintId = process.argv[2];
const channelId = process.argv[3];
const token = process.argv[4] || process.env.API_TOKEN;

if (!blueprintId || !channelId) {
  console.error('Usage: node verify-blueprint-runtime.mjs <blueprintId> <channelId> [jwt]');
  process.exit(1);
}

const intervalsArg = process.argv.find((a) => a.startsWith('--intervals='));
const intervalsSec = intervalsArg
  ? intervalsArg.split('=')[1].split(',').map((n) => parseInt(n, 10))
  : [60, 300, 900, 1800, 3600];

async function verify() {
  const res = await fetch(
    `${BASE}/blueprints/${blueprintId}/verify-observers?channelId=${channelId}&horizon=24h`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }
  );
  const json = await res.json();
  return json.data;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  console.log(`Blueprint runtime verify: ${blueprintId} channel ${channelId}`);
  let elapsed = 0;
  for (const waitSec of intervalsSec) {
    const delta = waitSec - elapsed;
    if (delta > 0) {
      console.log(`Waiting ${delta}s until ${waitSec}s checkpoint...`);
      await sleep(delta * 1000);
    }
    elapsed = waitSec;
    const data = await verify();
    const label = `${Math.round(waitSec / 60)}min`;
    console.log(`[${label}] ok=${data.ok} cursorSource=${data.cursorSource}`);
    console.log(`  ffmpeg=${data.ffmpegMedia} live=${data.liveCursorMedia} now=${data.nowPlayingMedia} timeline=${data.timelineMedia}`);
    if (data.mismatches?.length) {
      console.warn('  mismatches:', data.mismatches);
    }
    if (!data.ok) {
      console.error(`FAIL at ${label}`);
      process.exit(1);
    }
  }
  console.log('PASS — all checkpoints ok');
})();
