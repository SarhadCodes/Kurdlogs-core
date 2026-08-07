import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { appendConcatInputArgs } from '../utils/ffmpegConcatInput';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kurdlogs-blueprint-loop-'));
  const mediaPath = path.join(root, 'one-second.mp4');
  const concatPath = path.join(root, 'weekly.ffconcat');
  const playlistPath = path.join(root, 'index.m3u8');
  const segmentPattern = path.join(root, 'segment_%05d.ts');

  try {
    const generated = spawnSync(
      'ffmpeg',
      [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=25:d=1',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25',
        '-c:a', 'aac', '-shortest', mediaPath,
      ],
      { encoding: 'utf8' }
    );
    assert.equal(generated.status, 0, generated.stderr || 'failed to generate test media');

    const escaped = mediaPath.replace(/\\/g, '/').replace(/'/g, "'\\''");
    fs.writeFileSync(concatPath, `ffconcat version 1.0\nfile '${escaped}'\n`, 'utf8');

    const args = ['-hide_banner', '-loglevel', 'error'];
    appendConcatInputArgs(args, concatPath, { loop: true });
    args.push(
      '-map', '0:v:0', '-map', '0:a:0',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25', '-sc_threshold', '0',
      '-c:a', 'aac',
      '-f', 'hls', '-hls_time', '0.5', '-hls_list_size', '4',
      '-hls_flags', 'delete_segments+independent_segments',
      '-hls_segment_filename', segmentPattern,
      playlistPath
    );

    const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    ffmpeg.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    await wait(2_500);
    assert.equal(ffmpeg.exitCode, null, `FFmpeg exited at the first concat EOF: ${stderr}`);
    assert.ok(fs.existsSync(playlistPath), 'HLS playlist was not created');
    const firstMtime = fs.statSync(playlistPath).mtimeMs;

    await wait(2_500);
    assert.equal(ffmpeg.exitCode, null, `FFmpeg exited instead of looping: ${stderr}`);
    const playlist = fs.readFileSync(playlistPath, 'utf8');
    assert.ok(fs.statSync(playlistPath).mtimeMs > firstMtime, 'HLS playlist stopped advancing');
    assert.ok(!playlist.includes('#EXT-X-ENDLIST'), 'live HLS playlist was incorrectly finalized');
    assert.ok(fs.readdirSync(root).some((name) => name.endsWith('.ts')), 'no HLS segments were produced');

    ffmpeg.kill('SIGTERM');
    await wait(300);
    console.log('PASS: Blueprint concat crossed multiple natural EOF boundaries without restarting FFmpeg.');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
