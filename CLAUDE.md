# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Stash plugin repository containing plugins for the Stash media server: **SpriteTab** (sprite sheet viewer tab), **TheaterMode**, **GalleryMode**, and **TVGuide** (a live cable-style channel guide).

## Commands

All commands run from `plugins/SpriteTab/`:

```bash
npm test              # Run Jest test suite
npm test:watch        # Run Jest in watch mode
npm test:coverage     # Run tests with coverage report
STASH_PLUGIN_DIR=/path/to/stash/plugins/SpriteTab npm run sync  # Sync plugin to Stash
```

Build the plugin index (from repo root):
```bash
./build_site.sh       # Generates index.yml and plugin zips
```

`npm run sync` performs a **clean install**: it removes the destination directory entirely before copying, so stale files from previous versions don't accumulate.

`build_site.sh` uses an **inclusion approach** for zipping: only `.yml`, `.js`, `.css`, `.py`, and `.sh` files at the plugin root level (no recursion, `*.config.js` excluded). Do not change this to `zip -r` without exclusions — Stash scans all `.yml` files in the plugin directory and will log errors for any it cannot parse as a plugin manifest. `node_modules` must never be present in a deployed plugin.

`build_site.sh` also **runs `npm ci && npm run build` for any plugin whose `package.json` declares a `build` script** (currently only TVGuide), before zipping. Two things follow from this:

- Manifest discovery **must** keep pruning `node_modules` — the build step creates it mid-run, and without the prune those hundreds of dependency `.yml` files would be picked up as plugins on the very same run.
- Bundled plugins gitignore their build output, so a plugin directory in git may contain no shippable `.js` at all until the build runs.

## Test Coverage Requirements

Tests require 100% coverage for functions, lines, and statements, with 80% branch coverage. The test suite uses jsdom for DOM simulation.

**TVGuide sets thresholds per directory instead**, because driving a UI-heavy plugin to 100% in jsdom buys assertions about DOM trivia rather than behaviour: `src/domain/` and `src/state/` are held to 100% statements/lines/functions and **90%** branches (stricter than the repo default, and where all the real logic lives), while `src/api/` and `src/ui/` are held to 80% / 70% branches.

## Architecture

**Core separation pattern**: Pure utilities live in `core.js`, exposed at `window.SpriteTabCore` in the browser and via `module.exports` for Jest. `sprites.js` destructures what it needs from `SpriteTabCore` at the top of its IIFE — there is one shared implementation, not parallel copies. The yml loads `core.js` before `sprites.js` so the global is in place when `sprites.js` runs; reordering breaks the destructure.

### plugins/TVGuide/

The only bundled plugin: ES modules under `src/`, built by esbuild into root-level `tvguide.js` + `tvguide.css`. It deliberately does **not** follow SpriteTab's `window.*` globals pattern — it is far too large for it.

Layered, one-way data flow: `api/` (GraphQL) → `domain/` (pure: scheduling, layout maths, lineup, channel providers) → `state/` (store + reducer + selectors + effects) → `ui/` (overlay, grid, list, viewer). Events go to the reducer; the reducer returns new state **plus effects**; effects perform I/O and dispatch more events. This is GalleryMode's `createStore({ runEffect, ctx })` architecture, minus the hand-duplication that a bundler removes.

Non-obvious invariants:

- **The schedule is a pure function of (channelId, scene pool, day)** — `seededShuffle` seeded by `channelId|YYYY-MM-DD`, cursor `(now - local_midnight) % totalRuntime`. Nothing is persisted. This is what makes a reload keep playing the same programme at an advanced offset. Seed and cursor both pivot on local midnight so they roll over together; changing one without the other makes the day jump mid-programme.
- **Scene pools must be fetched `sort: "id", direction: ASC`.** The schedule is a seeded shuffle of the pool, so an unstable pool order destroys the illusion.
- **Channel ids are source-prefixed** (`studio:12`, `tag:12`) because they double as schedule seeds and must not collide across sources.
- **`SavedFilter.object_filter` is NOT a `SceneFilterType`** despite looking like one. It uses the Stash *UI's* criterion shape (`value: {items:[{id}], excluded, depth}`); forwarding it raw fails with "cannot use map as ID". `src/domain/savedFilterCriteria.js` converts it.
- **The `?start=` seek fallback shifts the stream's timeline.** Once it engages, the stream's `t=0` is the seek offset, so `streamBaseSeconds` must be subtracted from any comparison of `currentTime` against schedule time — otherwise drift correction re-seeks in a loop.
- **The grid restyles on tick and only rebuilds on pan/pool/day change** (`track.dataset.signature`). Rebuilding every second would churn the DOM and throw away keyboard focus.
- **DOM focus is only adopted when focus is already inside the grid**, so a background re-render cannot steal focus from another control.
- **The grid's row rebuild is keyed on id + name + badge, not id alone.** A rename or custom logo changes neither the id list nor the block set, so keying on ids left the old name on screen.
- **The visible channel list is state, not a selector.** `state.allChannels` is the raw resolved lineup; `state.channels` is the prefs-applied, sorted list, recomputed whenever channels/prefs/sort change. It has to be real state because `MOVE_FOCUS` walks it inside the reducer — derive it at render time and arrow-down lands on the wrong row.
- **Lineup and prefs are stored separately on purpose.** `tvguide_lineup` says which channels exist; `tvguide_channel_prefs` (keyed by channel id) says how they are presented. Keeping prefs out of the lineup is what lets a rename survive toggling a lineup rule off and on.
- **Removing a rule-swept channel freezes the rest into explicit picks.** Otherwise the next resolve sweeps it straight back in and the button looks broken.
- **The now-line lives in a track overlay** (`left: var(--tvguide-head-width); right: 0`), so its `left: %` is a percentage of the track. Positioning it against the whole scroll container and adding a margin — as it once did — puts it progressively too far right and eventually off-screen.
- **Not every source is hierarchical.** `SceneFilterType.performers` is a `MultiCriterionInput` with no `depth`, unlike studios/tags/groups; `createEntityProvider` takes a `hierarchical` flag for this. Sending `depth` to performers is rejected by the server.
- **The guide is always grouped by type**, so there is no "sort by source" mode. `state.channels` is the flattened, collapse-aware visible order that `MOVE_FOCUS` walks; `state.channelGroups` is what renders.
- **Pins are an ordered array** (`tvguide_pin_order`), not a `pinnedAt` timestamp — a timestamp cannot express a manual drag order. Legacy `pinnedAt` prefs migrate on first load.
- **The keyboard handler captures and stops propagation**, so controls that interpret arrow keys themselves (the column resizer, sliders) must be covered by `handlesOwnKeys` in `src/ui/keyboard.js` or they never receive them.
- **`body { overflow: hidden }` does not lock scrolling in iOS Safari.** The overlay pins the body with `position: fixed` and restores `window.scrollY` on close.

### plugins/SpriteTab/

- **sprites.js** - Main plugin entry point. Handles DOM rendering, event listeners, GraphQL queries to Stash API, and plugin lifecycle. Contains configuration constants and initialization logic with race condition prevention. Consumes pure utilities from `window.SpriteTabCore` rather than reimplementing them.

- **core.js** - Shared pure utilities, loaded before `sprites.js` per the manifest. Time formatting, settings (localStorage), tooltip positioning with viewport bounds, sprite grid + VTT cue parsing, active-sprite index calculation, URL/GraphQL parsing helpers, mobile layout detection. Wrapped in an IIFE that publishes its API to `window.SpriteTabCore` (browser) and `module.exports` (Jest).

- **SpriteTab.yml** - Plugin manifest defining metadata and user-configurable settings: `tooltip_enabled`, `tooltip_width`, `show_timestamps`, `compact_view`, `auto_scroll`, `grid_columns`.

- **__tests__/** - Jest tests split into unit tests (core.test.js) and integration tests (integration.test.js) for DOM interactions.

## Key Patterns

- Plugin uses localStorage for client-side user preferences
- GraphQL queries communicate with Stash server API
- Touch-aware event handling filters synthetic mouse events
- Tooltip positioning algorithm prevents viewport overflow

## Mobile Touch Handling

Several non-obvious invariants must be preserved:

- **`lastTouchTime` is shared across all sprite cells** (declared once before the cell loop, not inside it). Per-cell timestamps would fail to block synthetic `mouseenter` events fired on neighbouring cells after a finger lift.
- **`isLongPress` gates scroll detection in `ontouchmove`**: when a long press is active the handler returns early, before any scroll-detection code runs. This allows the tooltip to follow the finger across cells. Do not move the scroll-detection block above the `isLongPress` check.
- **Mobile layout is detected via media query** (`window.matchMedia('(max-width: 767px)')`), not by touch capability. Tablets may have their own scroll containers and should behave like desktop. `isMobileLayout()` in `core.js` accepts an injectable `matchMediaFn` for testability.
- **Auto-scroll during playback is suppressed on mobile** to avoid hijacking the page scroll. On mobile, tapping a sprite seeks the video and (if auto-scroll is enabled) scrolls the player back into view instead.
