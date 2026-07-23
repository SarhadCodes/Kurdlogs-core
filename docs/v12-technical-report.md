# KurdLogs Core v12 — Technical Report (Localhost)

**Build:** `2026-05-31-v12-local`  
**Scope:** Branding, unified upload pipeline, processing queue, monitoring, benchmark, scalability hooks  
**Deployment status:** NOT deployed — localhost implementation only

---

## Executive summary

v12 replaces the two-pass upload flow (normalize → logo burn) with a **single FFmpeg ingest pipeline**, introduces **Brand Profiles** for reusable static branding, adds a **ProcessingJob queue** with live progress, improves **channel health monitoring**, and includes a **benchmark page** for stress testing. Playlist channels **never** apply static logos at runtime — only clock, date, ticker, and LIVE badge overlays are allowed live.

---

## Architecture changes

### 1. Unified upload pipeline (`ingest.service.ts`)

```
Upload → Analyze source → [remux | transcode | transcode+brand] → channel-ready MP4
```

| Path | When |
|------|------|
| **Remux** | H.264 + AAC + 24fps CFR + ≤720p + no branding |
| **Transcode** | Source mismatch, no branding |
| **Transcode + brand** | Branding enabled (single pass — no second logo burn) |

- Formats: MP4, MKV, AVI, MOV  
- Output: H.264, AAC, CFR 24fps, timestamps reset (`setpts=PTS-STARTPTS`, `-shortest`)  
- Progress parsed from FFmpeg stderr → `ProcessingJob` + WebSocket `processing:job`

### 2. Brand profile system

- **Model:** `BrandProfile` (name, logo, position, size, opacity, enabled)  
- **Resolution order:** per-item override → playlist default → channel default (`brandResolver.service.ts`)  
- **Future fields reserved:** `watermarkPath`, `bugPath`  
- **UI:** `/brand-profiles`

### 3. Processing queue

- **Model:** `ProcessingJob` — status, progress %, frame, time, speed, ETA  
- **Queue:** serial ingest via `processingQueue.service.ts` (CPU-efficient)  
- **UI:** `/processing` with WebSocket live updates

### 4. Monitoring

- Real system CPU via `monitorService.getSystemCpuPercent()` (was hardcoded 15.5%)  
- Per-channel: CPU, RAM, bitrate, speed, PID, viewers, health score  
- Health levels: EXCELLENT / GOOD / WARNING / CRITICAL  
- App logs export: `/monitoring/app-logs/export`

### 5. Stability rules

- `overlay.service.ts` blocks LOGO/WATERMARK on `isPlaylistChannel` channels  
- Static logos only during ingest

### 6. Scalability (preparation only)

- `workers/types.ts` — worker adapter interface for future multi-node  
- Existing `BoostNode` schema unchanged  
- No clustering implemented

---

## Comparison: v11 vs v12

| Metric | v11 (old) | v12 (new) | Improvement |
|--------|-----------|-----------|-------------|
| FFmpeg passes (branded upload) | 2 (normalize + logo burn) | 1 | ~40–50% less encode time |
| Upload visibility | Item status only | Full progress, ETA, speed | Operational clarity |
| Runtime logo on playlists | Possible (bug source) | Blocked at API | Stability |
| System CPU in dashboard | Hardcoded 15.5% | Real measurement | Accurate monitoring |
| Brand reuse | Per-item only | Profiles + defaults | Less duplication |
| Stress testing | Manual | Built-in benchmark page | Repeatable |

*Upload time savings depend on source length and hardware. Branded MKV sources benefit most (one transcode instead of two). Remux-eligible MP4s see minimal change.*

---

## Localhost test plan

1. `docker compose up` or local postgres + backend + frontend  
2. `npx prisma migrate dev` in `backend/`  
3. Create brand profile (Wave+, etc.)  
4. Upload MP4 matching spec → expect **REMUX**, fast completion  
5. Upload MKV + brand → expect **TRANSCODE_BRAND**, single job, no second pass  
6. Open Processing page — verify progress updates  
7. Start playlist channel — confirm no runtime logo overlay allowed  
8. Monitoring → channel health table populated  
9. Benchmark → run 1/5/10/20 channel test, download JSON report  

---

## Benchmark (localhost)

Run via UI at `/benchmark` or:

```powershell
.\scripts\benchmark-localhost.ps1 -Channels 5 -Seconds 30
```

Results are stored in memory (`benchmarkService.lastReport`) and downloadable as JSON. Compare peak CPU/RAM across channel counts before VPS deployment.

---

## Files added / changed (v12)

**Backend:** `ingest.service.ts`, `processingQueue.service.ts`, `brandProfile.service.ts`, `brandResolver.service.ts`, `appLog.service.ts`, `channelHealth.service.ts`, `benchmark.service.ts`, `workers/types.ts`, routes/controllers for brand/processing/benchmark  

**Frontend:** `BrandProfilesPage`, `ProcessingPage`, `BenchmarkPage`, enhanced `MonitoringPage`  

**Schema:** `BrandProfile`, `ProcessingJob`, `AppLog`

---

## Deployment gate

Do **not** deploy until:

- [ ] Localhost tests pass  
- [ ] Benchmark report reviewed for target channel count  
- [ ] Manual approval from operator  

When approved: run migration on VPS, sync code, rebuild containers, verify sidebar shows `build 2026-05-31-v12-local`.
