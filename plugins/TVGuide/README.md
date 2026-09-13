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
every studio, tag, group and saved filter in your library, plus the built-in
**New releases**, **Recently added**, **Movies**, and **Shorts** channels; then
choose what becomes a channel.

Two independent things are stored, deliberately apart in TV Guide's Stash
plugin configuration, so they follow the same Stash instance across browsers:

- **The lineup** (`tvguide_lineup`) decides which channels exist.
- **Prefs** (`tvguide_channel_prefs`) decide how a channel is presented — pinned,
  hidden, renamed, re-badged, or given its own scene cap.

They are separate because prefs are keyed by channel id: rename a studio, turn
its lineup rule off and back on, and the rename is still there. Storing them
together would lose it.

### The lineup

A list of source entries — studios, **models** (performers), tags, groups and
saved filters mix freely in one guide. The Special section contains four
individual channels, which are explicit picks just like any other channel:

```json
[
  { "source": "studio", "minScenes": 5 },
  { "source": "performer", "minScenes": 10 },
  { "source": "tag", "ids": ["12", "34"] },
  { "source": "group", "minScenes": 1 },
  { "source": "savedFilter", "names": ["Favourites"] },
  { "source": "special", "ids": ["new-releases", "movies"] }
]
```

Special channels use Stash scene filters: **New releases** uses a scene's
release date, **Recently added** uses when it was added to your library,
**Movies** matches longer scenes, and **Shorts** matches shorter ones. They can
be added, removed, pinned, hidden, renamed, and customised exactly like other
channels. Fresh installations add all four automatically; existing saved
lineups are left unchanged.

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

### Ordering and navigation

The guide is **always grouped by type** — Pinned first, then a collapsible group
per source with a count. Within a group you sort by name or scene count.

Hand-ordering 119 channels is not workable, so finding things is done with:
a **search box**, a **grouping dropdown** built from the sources you actually have, an
**A–Z rail** beside the channel column for the current source group, and a
**jump to current** button. Selecting a grouping expands it if collapsed. A short
current date appears to the left of the guide times. The rail has no letters in the custom-ordered Pinned group.

**Pins** sit in their own group at the top and are drag-reorderable, or moved
with the keyboard. The channel column uses a fixed default width of 200px.

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

The player carries its own controls over the video: play/pause, mute, theater,
fullscreen and Watch. Three sizes — corner, **theater** (full width, guide
scrolling below) and **fullscreen**. When iPad Safari rejects element
fullscreen, TV Guide uses the same viewport-filling fallback as Gallery Mode,
so the video and its controls remain available; theater remains the alternative
that keeps the guide visible.

Click the video or tab to the player to channel surf with `←` / `→`; `Space`
pauses or resumes. Arrow-key changes scroll the guide to the tuned channel; in
native fullscreen, the guide catches up when you exit. Surfing follows the
visible guide order, wraps at either end,
and respects search, filters, hidden channels and collapsed groups. In fullscreen,
scroll down or swipe up for the next channel (reverse for the previous channel).
Each wheel gesture or swipe changes one channel with a short vertical slide
transition (disabled for reduced motion). The next stream may still need to buffer.
If the browser rejects a scene's stream, the guide requests compatible alternate
streams from Stash and tries them at the current programme offset. If none plays,
the player shows an error instead of silently remaining blank.
In fullscreen, controls and channel info appear on video taps, mouse movement or
channel changes, and hide together after three seconds of inactivity. They stay
visible while paused; entering fullscreen during playback leaves them hidden. The overlay
shows the channel number, name, studio logo, current programme, start and end
times, minutes remaining, performer names (up to two lines), and a description
excerpt (three lines by default, adjusting to the available space when resized). Times follow the clock
setting, and minutes remaining freeze while paused. Use the minus button to
minimize the overlay to the channel name and the plus button to expand it;
this preference is saved across sessions. Hover or tap the overlay to reveal its
buttons and resize handle; tap again to hide them. The miniplayer resize handle
appears the same way when you hover or tap its picture. Keyboard focus also
reveals these controls. Drag the expanded overlay's top-right
corner to resize it, or focus the handle and use the arrow keys (Shift for larger
steps). Its bottom-left corner stays anchored above the controls. To hide it entirely, disable **Show
Channel Info Overlay** in Stash's TV Guide plugin settings and reload the page.
Playback controls remain available. Numbers start at 1 in the
full lineup and do not change when filtering, collapsing groups or pinning.

Clicking a programme that is not on now **previews** it as a still and pauses
live playback, with a Back to live control. Clicking anything currently live
tunes to it instead.
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
| `guide_12_hour_clock` | off | Show AM/PM times throughout the guide; reload after changing |
| `guide_pool_cap` | 100 | Scenes drawn into a channel's schedule |
| `guide_new_release_days` | 30 | Release-date age for New releases |
| `guide_recently_added_days` | 14 | Library-added age for Recently added |
| `guide_movie_min_minutes` | 90 | Minimum length for Movies |
| `guide_short_max_minutes` | 5 | Maximum length for Shorts |
| `guide_autoplay` | on | Play the tuned channel in the corner |
| `guide_start_muted` | on | Browsers block autoplay with sound |
| `guide_navbar_button` | on | The guide is always at `#tvguide` regardless |

## Development

```bash
npm test           # 770 tests
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

Subtleties worth knowing before changing this:

- **The visible channel list lives in `state.channels`, not in a selector.**
  `MOVE_FOCUS` walks it inside the reducer, so if grouping and sorting only
  happened at render time, arrow-down would land on the wrong row — or inside a
  collapsed group. `state.allChannels` is the raw resolved list;
  `state.channelGroups` is for rendering; `state.channels` is the flattened,
  collapse-aware order.
- **The now-line and gridlines live in a track overlay** that starts where the
  channel column ends, so their `left: %` is a percentage of the track. They were
  previously positioned against the whole scroll container with a margin, which
  put the line progressively too far right.
- **Condensed rows are not to scale.** A channel of two-minute scenes collapses
  to `[N before][prev][current][next][N after]`, laid out for readability. Those
  rows do not line up with the clock; the live highlight identifies what is on.
- **The keyboard handler runs in the capture phase** and stops propagation on
  keys it owns, so any control that interprets arrows itself must be listed in
  `handlesOwnKeys` — otherwise it never receives them.
