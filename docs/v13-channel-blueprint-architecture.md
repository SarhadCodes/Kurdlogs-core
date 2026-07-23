# KurdLogs Core v13 — Channel Blueprint Architecture

**Build:** `2026-05-31-v13-local`  
**Status:** Prototype on localhost — **NOT approved for VPS deployment**

---

## Mission

Move beyond static playlists. A **Channel Blueprint** defines *how* a TV channel behaves. **Playlists are content libraries**, not the schedule.

```
Intro → Movie → Promo → Movie → Station ID → Loop
```

Non-technical users build this visually — no code, no node graphs, no broadcast jargon.

---

## Architecture overview

```mermaid
flowchart TB
  subgraph UI [Frontend]
    Builder[Blueprint Canvas - drag blocks]
    Sim[Simulator - 1h / 24h / 7d]
    Pub[Publish to channel]
  end

  subgraph API [Backend REST]
    CRUD[/api/blueprints]
    SimAPI[POST /blueprints/:id/simulate]
  end

  subgraph Engine [Blueprint Engine]
    Resolve[resolveSegments - dynamic]
    Walk[simulate - time horizon]
  end

  subgraph Content [Content layer]
    PL1[Playlist: Wave Movies]
    PL2[Playlist: Promos]
    Items[READY items only]
  end

  subgraph Playback [Playback prototype]
    Window[Rolling concat window]
    FF[FFmpeg concat → HLS]
  end

  Builder --> CRUD
  Sim --> SimAPI
  SimAPI --> Engine
  Engine --> PL1
  Engine --> PL2
  PL1 --> Items
  Pub --> Window
  Window --> FF
```

---

## Data model

### `ChannelBlueprint`
| Field | Purpose |
|-------|---------|
| `name` | Display name |
| `blocks` | JSON array of blueprint blocks |
| `status` | DRAFT / PUBLISHED |
| `templateKey` | Source template if created from preset |

### `Channel` (extended)
| Field | Purpose |
|-------|---------|
| `useBlueprint` | Enable blueprint playback |
| `blueprintId` | Linked blueprint (1:1) |

### Block structure
```json
{
  "id": "uuid",
  "type": "MOVIE",
  "label": "Movie",
  "config": {
    "playlistId": "...",
    "selectionMode": "RANDOM",
    "repeatCount": 1,
    "scheduleRules": {}
  }
}
```

`scheduleRules` is reserved for weekly / prime-time / holiday scheduling (future).

---

## Dynamic resolution (core requirement)

**The blueprint does NOT materialize a fixed playlist file.**

When the engine reaches a content block:

1. Load the configured playlist from DB (READY items only).
2. Pick next item: **Random** or **Sequential** (per-block cursor).
3. Emit a `ResolvedSegment` with title, duration, timestamps.
4. Advance to next block; on **LOOP**, reset to block 0.

### Benefits (as designed)
| Scenario | Behavior |
|----------|----------|
| New movie uploaded to Wave Movies | Appears in random pool on next resolution |
| Movie removed | Excluded automatically |
| Channel running | Rolling window refresh (prototype: on publish/start) |
| No full channel restart for catalog changes | Extension point: block-boundary refresh |

---

## Blueprint engine

**File:** `backend/src/services/blueprintEngine.service.ts`

| Method | Purpose |
|--------|---------|
| `resolveSegments()` | Next N segments from current state |
| `simulate()` | Walk blueprint until horizon (1h / 24h / 7d) |

**Warnings detected:**
- Missing playlist on block
- Empty playlist
- No LOOP block
- Repetition (same title too often in window)

---

## Playback integration (prototype)

**File:** `backend/src/services/blueprintPlayback.service.ts`

- Generates a **rolling ffconcat window** (24 segments) at channel start/publish.
- FFmpeg reads blueprint concat instead of static playlist concat when `channel.useBlueprint === true`.

**Extension points (not implemented):**
- `BlueprintRuntimeState` persisted in DB/Redis
- Block-boundary refresh without full restart
- `BlueprintPlaybackAdapter.refreshRollingWindow()`
- SCHEDULE block with cron / timezone rules
- Prime time / holiday overrides
- Auto "Coming Up Next" metadata

---

## Templates

| Key | Flow |
|-----|------|
| `movie-channel` | Intro → Movie → Promo → Movie → Station ID → Loop |
| `music-channel` | Intro → Music ×2 → Promo → Station ID → Loop |
| `kids-channel` | Intro → Cartoon → Promo → Educational → Station ID → Loop |

---

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/blueprints/templates` | List templates |
| GET | `/api/blueprints` | List blueprints |
| POST | `/api/blueprints` | Create (optionally `templateKey`) |
| PUT | `/api/blueprints/:id` | Save blocks |
| POST | `/api/blueprints/:id/simulate` | Run simulator |
| GET | `/api/blueprints/:id/preview` | Next N segments |
| POST | `/api/blueprints/:id/publish` | Attach to channel (localhost) |

---

## UI prototype

**Route:** `/blueprints`

| Area | Feature |
|------|---------|
| Left | Block palette (8 block types) |
| Center | Vertical drag-and-drop canvas (@dnd-kit) |
| Right | Block settings (playlist, random/sequential) |
| Bottom | Simulator + Publish panel |

---

## Localhost test plan

1. Open http://localhost/blueprints
2. Create **Movie Channel** template
3. Assign playlists to Intro, Movie, Promo, Station ID blocks
4. **Run** simulator → Next hour / 24h / 7d
5. Verify warnings for empty/missing playlists
6. **Publish** to a test playlist channel (localhost only)
7. Start channel → verify HLS uses blueprint rolling concat

---

## Comparison: v12 playlist vs v13 blueprint

| Aspect | v12 Playlist channel | v13 Blueprint channel |
|--------|----------------------|------------------------|
| Schedule | Fixed item order | Block-driven flow |
| Content source | One playlist | Multiple playlists per block |
| New content | Requires concat regen | Resolved at runtime |
| User model | Upload to playlist | Design channel behavior |
| Selection | Position order | Random / Sequential per block |

---

## Deployment gate

- [ ] Localhost simulator validated
- [ ] Rolling playback tested on test channel only
- [ ] No production/VPS channels modified
- [ ] Manual approval required before VPS deploy

---

## Files added (v13)

```
backend/prisma/schema.prisma                    — ChannelBlueprint, Channel.useBlueprint
backend/src/types/blueprint.types.ts
backend/src/config/blueprintTemplates.ts
backend/src/services/blueprintEngine.service.ts
backend/src/services/blueprint.service.ts
backend/src/services/blueprintPlayback.service.ts
backend/src/controllers/blueprint.controller.ts
backend/src/routes/blueprint.routes.ts
frontend/src/pages/BlueprintsPage.tsx
frontend/src/components/blueprint/*
docs/v13-channel-blueprint-architecture.md
```

---

## v13.1 — Blueprint Polish & UX (localhost)

**Build:** `2026-05-31-v13.1-local`

### Added

| Feature | Implementation |
|---------|----------------|
| Blueprint Summary | `blueprintAnalytics.service.ts` + `POST /blueprints/:id/summary` |
| Playlist insights | Block settings panel + summary API |
| Smart warnings | `analyzeBlueprint()` with `suggestion` + `severity` |
| Transition rules | `transitionIn` on blocks — click arrow in canvas |
| Diversity + coverage | `enrichSimulation()` on simulate/timeline responses |
| Watch Blueprint | `BlueprintPreviewTimeline` + `POST /blueprints/:id/timeline` |
| Templates | 7 total: Movie, Music, Kids, 24/7 Cinema, Weekend Cinema, Music Hits, Kids Learning |

### Future extension points (types only — not implemented)

- `BlueprintScheduleEngine` — weekly scheduling
- `BlueprintEpgAdapter` — coming up next
- `BlueprintVersioning` — blueprint version history
- `config.scheduleRules`, `config.primeTimeRules`, `config.versionMeta` on blocks
