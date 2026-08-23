# TV Guide

Presents your Stash library as live TV channels with a cable-style programme
guide. Every channel is always broadcasting: open the guide and something is
already halfway through, with a corner viewer playing it at its true live
position.

## How the "live" part works

The schedule is a **pure function of (channel, scene pool, wall clock)**. Nothing
is stored, and nothing is randomised per session:

```
order  = seededShuffle(scenes, hash(channelId + '2026-08-22'))
cursor = (now - local_midnight) % totalRuntime
```

So reloading the page keeps the same programme playing, at an offset that has
advanced by exactly the time that passed. Two browsers looking at the same
channel agree without talking to each other.

The broadcast day runs from local midnight. Both the shuffle seed and the
playback cursor pivot on it, so they roll over together and the day restarts
cleanly instead of jumping mid-programme. A channel holding less than a day of
programming simply loops — which is what cable does anyway.

## Channels

Channels come from a **lineup**, a list of source entries stored in
`localStorage` under `tvguide_lineup`. Sources mix freely in one guide:

```json
[
  { "source": "studio", "minScenes": 5 },
  { "source": "tag", "ids": ["12", "34"] },
  { "source": "group", "minScenes": 1 },
  { "source": "savedFilter", "names": ["Favourites"] }
]
```

Every provider reduces its source to the same thing — a `SceneFilterType` — so
one shared fetcher serves all of them and a new source type is one entry in
`src/domain/providers/index.js`.

Saved filters are the interesting case: any filter you can build in the Stash UI
becomes a channel. Their stored `object_filter` uses the UI's own criterion
shape rather than the API's, so `src/domain/savedFilterCriteria.js` converts it.

## Controls

| Key | Action |
|---|---|
| `←` `→` | Previous / next programme |
| `↑` `↓` | Previous / next channel |
| `Page Up` / `Page Down` | Pan by one screen |
| `Home` / `End` | Jump to the window edges |
| `N` | Back to now |
| `Enter` | Watch in the corner viewer |
| `E` / `Shift+Enter` | Open the scene at its live position |
| `M` | Mute / unmute |
| `?` | Shortcut help |
| `Esc` | Close |

The guide is fully operable by mouse, keyboard and touch. It follows the ARIA
grid pattern with a roving tabindex, traps focus while open, and announces
channel changes through a live region.

On viewports under 768px the time-grid is replaced by a vertical Now/Next list —
the layout that actually suits a phone, and where descriptions fit. The choice is
made by media query, not touch capability, so tablets keep the grid.

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `guide_min_scenes` | 5 | Sources below this become no channel |
| `guide_window_hours` | 3 | Hours visible in the grid at once |
| `guide_pool_cap` | 100 | Scenes drawn into a channel's schedule |
| `guide_autoplay` | on | Play the tuned channel in the corner |
| `guide_start_muted` | on | Browsers block autoplay with sound |
| `guide_navbar_button` | on | The guide is always at `#tvguide` regardless |

## Development

```bash
npm test           # 455 tests
npm run build      # bundles src/ -> tvguide.js + tvguide.css
npm run watch      # rebuild on change
STASH_PLUGIN_DIR=/path/to/stash/plugins/TVGuide npm run sync
```

`tvguide.js` and `tvguide.css` are **build output** and are gitignored;
`build_site.sh` runs the build before zipping.

### Layout

```
src/
  api/       GraphQL client, queries, settings, pool cache
  domain/    PURE -- scheduling, layout maths, lineup, providers
  state/     store, reducer, selectors, effects
  ui/        overlay, grid, list, banner, viewer, keyboard, gestures
  index.js   composition root
```

Data flows one way: events go to the reducer, the reducer returns new state plus
effects, effects do the I/O and dispatch more events. Views are pure functions of
selectors, which is why the desktop grid and the mobile list are two renderers
over one state tree.

`domain/` and `state/` hold 100% test coverage (90% branches) — that is where the
scheduling, the midnight rollover and the keyboard movement live. `api/` and
`ui/` are held to 80/70.
