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

Press **Channels** in the toolbar (or `c`) to open the channel manager: browse
every studio, tag, group and saved filter in your library, search them, and
choose what becomes a channel.

Two independent things are stored, deliberately apart:

- **The lineup** (`tvguide_lineup`) decides which channels exist.
- **Prefs** (`tvguide_channel_prefs`) decide how a channel is presented — pinned,
  hidden, renamed, re-badged, or given its own scene cap.

They are separate because prefs are keyed by channel id: rename a studio, turn
its lineup rule off and back on, and the rename is still there. Storing them
together would lose it.

### The lineup

A list of source entries. Sources mix freely in one guide:

```json
[
  { "source": "studio", "minScenes": 5 },
  { "source": "tag", "ids": ["12", "34"] },
  { "source": "group", "minScenes": 1 },
  { "source": "savedFilter", "names": ["Favourites"] }
]
```

An entry with `minScenes` is a **rule**: while it is on, a newly-added studio
becomes a channel on its own. An entry with `ids` is an **explicit pick**.
Removing a rule-swept channel in the manager freezes the rest into explicit
picks — otherwise the next resolve would sweep it straight back in.

Every provider reduces its source to the same thing — a `SceneFilterType` — so
one shared fetcher serves all of them and a new source type is one entry in
`src/domain/providers/index.js`.

Saved filters are the interesting case: any filter you can build in the Stash UI
becomes a channel. Their stored `object_filter` uses the UI's own criterion
shape rather than the API's, so `src/domain/savedFilterCriteria.js` converts it.

### Ordering and customisation

Hand-ordering 87 channels is not workable, so order is **sort mode plus pins**:
choose name, scene count or source, and pin a handful of channels above it. Pin
order is the order you pinned them.

Per channel you can override the display name, point it at your own logo URL,
hide it from the guide without removing it from the lineup, and give it its own
scene cap when the global one is too small for a large studio.

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
| `C` | Manage channels |
| `?` | Shortcut help |
| `Esc` | Close |

While the manager is open it owns the keyboard — it is full of text fields, so
guide shortcuts stand aside and `Esc` closes the panel rather than the guide.

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
npm test           # 575 tests
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
  domain/    PURE -- scheduling, layout maths, lineup, prefs, providers
  state/     store, reducer, selectors, effects
  ui/        overlay, grid, list, banner, viewer, manager, keyboard, gestures
  index.js   composition root
```

Data flows one way: events go to the reducer, the reducer returns new state plus
effects, effects do the I/O and dispatch more events. Views are pure functions of
selectors, which is why the desktop grid and the mobile list are two renderers
over one state tree.

`domain/` and `state/` hold 100% test coverage (90% branches) — that is where the
scheduling, the midnight rollover and the keyboard movement live. `api/` and
`ui/` are held to 80/70.

One subtlety worth knowing before changing the state layer: the visible channel
list lives in `state.channels` rather than in a selector. `MOVE_FOCUS` walks it
inside the reducer, so if sorting only happened at render time, arrow-down would
land on the wrong row. `state.allChannels` holds the raw resolved list, and
`state.channels` is recomputed whenever channels, prefs or sort change.
