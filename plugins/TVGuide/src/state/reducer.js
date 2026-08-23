/**
 * The guide reducer.
 *
 * Pure: no DOM, no timers, no network. Everything that touches the outside
 * world leaves here as an effect. That is what lets the awkward parts -- the
 * midnight rollover, auto-advancing at a programme boundary, keyboard focus
 * movement across a grid of variable-width blocks -- be tested directly.
 */

import { Events, Effects, STORAGE_KEYS } from './actions.js';
import { createInitialState, PoolStatus } from './initialState.js';
import { buildDaySchedule, dayBucket, programAt } from '../domain/schedule.js';
import { snapToStep, clampWindowStart, HALF_HOUR_MS } from '../domain/layout.js';
import {
    groupChannels,
    flattenGroups,
    setPref,
    poolCapFor,
    togglePin,
    movePin
} from '../domain/channelPrefs.js';

/** How far ahead of the current day panning is allowed to go. */
const MAX_PAN_AHEAD_MS = 24 * 3600000;

const windowMsOf = (state) => state.settings.guide_window_hours * 3600000;

/**
 * Recompute the visible channel list after anything that affects it.
 *
 * Kept in state rather than derived at render time because the reducer itself
 * walks it: MOVE_FOCUS across channels has to agree with the on-screen order,
 * or arrow-down lands on the wrong row.
 *
 * Focus falls back to the first visible channel when its own row leaves the
 * screen -- it is the keyboard cursor, and MOVE_FOCUS walks this same list. The
 * tuned channel does not: collapsing a group, searching, or filtering by type
 * only changes what is *shown*, and retuning underneath the user because a row
 * scrolled out of the list is not something any of those actions asked for.
 */
function withVisibleChannels(state) {
    // The guide is always grouped, so the search box and the type filter narrow
    // the candidates before grouping rather than hiding rows afterwards.
    const query = state.guideSearch.trim().toLowerCase();
    const candidates = state.allChannels.filter((channel) => {
        if (state.typeFilter !== 'all' && channel.source !== state.typeFilter) return false;
        if (query && !channel.name.toLowerCase().includes(query)) return false;
        return true;
    });

    const channelGroups = groupChannels(candidates, {
        prefs: state.prefs,
        pinOrder: state.pinOrder,
        sourceOrder: state.sourceOrder,
        collapsed: state.collapsedGroups
    });

    // Collapsed groups contribute no rows, so keyboard traversal cannot enter
    // one -- the flattened list is exactly what is on screen.
    const channels = flattenGroups(channelGroups);
    const next = { ...state, channels, channelGroups };

    const stillThere = (id) => channels.some((c) => c.id === id);
    // Hiding a channel removes it from the guide for good; collapsing a group,
    // searching, or filtering by type only stops it being drawn.
    const stillExists = (id) =>
        state.allChannels.some((c) => c.id === id) && !state.prefs[id]?.hidden;

    if (next.tunedChannelId && !stillExists(next.tunedChannelId)) {
        next.tunedChannelId = channels[0]?.id || null;
    }
    if (next.focus && !stillThere(next.focus.channelId)) {
        next.focus = channels[0] ? { channelId: channels[0].id, timeMs: state.nowMs } : null;
    }

    return next;
}

function scheduleFor(state, channelId) {
    return state.schedules[channelId] || null;
}

/** What is live on a channel at `nowMs`, or null if it has no programming. */
function liveProgram(state, channelId, nowMs) {
    const schedule = scheduleFor(state, channelId);
    if (!schedule) return null;
    return programAt(schedule, nowMs, state.dayStartMs);
}

/** Tune effects are built in one place so TICK and TUNE cannot drift apart. */
function tuneEffects(state, channelId, nowMs) {
    if (!state.settings.guide_autoplay) return [];
    // A paused viewer must stay paused, and a preview owns the player until it
    // is dismissed -- otherwise the programme-boundary watcher would restart
    // playback underneath the user.
    if (state.viewerPaused || state.preview) return [];
    const program = liveProgram(state, channelId, nowMs);
    if (!program) return [];
    return [Effects.tuneViewer(channelId, program.scene, program.elapsedMs)];
}

export function reduce(state, event) {
    const effects = [];

    switch (event.type) {
        case Events.OPEN: {
            const { key, startMs } = dayBucket(event.nowMs);
            const next = {
                ...state,
                open: true,
                nowMs: event.nowMs,
                dayKey: key,
                dayStartMs: startMs,
                windowStartMs: snapToStep(event.nowMs, HALF_HOUR_MS),
                channelsStatus: state.channels.length > 0 ? state.channelsStatus : PoolStatus.LOADING
            };
            if (state.channels.length === 0) effects.push(Effects.loadChannels());
            else effects.push(...tuneEffects(next, next.tunedChannelId, event.nowMs));
            return { state: next, effects };
        }

        case Events.CLOSE:
            return { state: { ...state, open: false }, effects: [Effects.stopViewer()] };

        case Events.SETTINGS_LOADED:
            return { state: { ...state, settings: event.settings }, effects };

        case Events.RESTORE: {
            // Only adopt a remembered channel that still exists in the lineup.
            const tunedChannelId =
                event.tunedChannelId && state.channels.some((c) => c.id === event.tunedChannelId)
                    ? event.tunedChannelId
                    : state.tunedChannelId;
            return {
                state: { ...state, tunedChannelId, muted: event.muted ?? state.muted },
                effects
            };
        }

        case Events.TICK: {
            if (event.nowMs === state.nowMs) return { state, effects };

            const { key, startMs } = dayBucket(event.nowMs);

            // Midnight. The seed and the playback cursor both pivot on the day,
            // so every schedule is rebuilt together and the guide starts a new
            // broadcast day rather than drifting.
            if (key !== state.dayKey) {
                const schedules = {};
                for (const [channelId, pool] of Object.entries(state.pools)) {
                    if (pool.status === PoolStatus.READY) {
                        schedules[channelId] = buildDaySchedule(channelId, pool.scenes, key);
                    }
                }
                const rolled = {
                    ...state,
                    nowMs: event.nowMs,
                    dayKey: key,
                    dayStartMs: startMs,
                    schedules,
                    windowStartMs: snapToStep(event.nowMs, HALF_HOUR_MS)
                };
                return { state: rolled, effects: tuneEffects(rolled, rolled.tunedChannelId, event.nowMs) };
            }

            const next = { ...state, nowMs: event.nowMs };

            // A programme ended: retune so the viewer follows the schedule
            // rather than running past the end of its scene.
            const before = liveProgram(state, state.tunedChannelId, state.nowMs);
            const after = liveProgram(next, next.tunedChannelId, event.nowMs);
            if (after && (!before || before.scene.id !== after.scene.id)) {
                effects.push(...tuneEffects(next, next.tunedChannelId, event.nowMs));
            }

            return { state: next, effects };
        }

        case Events.CHANNELS_LOADED: {
            const next = withVisibleChannels({
                ...state,
                allChannels: event.channels,
                channelsStatus: PoolStatus.READY,
                // A successful load must clear a previous failure, or a stale
                // error would sit in the status bar over working channels.
                channelsError: null,
                sourceErrors: event.errors || []
            });

            next.tunedChannelId = next.tunedChannelId || next.channels[0]?.id || null;
            if (!next.focus && next.channels.length > 0) {
                next.focus = { channelId: next.channels[0].id, timeMs: state.nowMs };
            }
            return { state: next, effects };
        }

        case Events.CHANNELS_FAILED:
            return {
                state: { ...state, channelsStatus: PoolStatus.ERROR, channelsError: event.message },
                effects
            };

        case Events.POOL_REQUESTED: {
            const existing = state.pools[event.channelId];
            // Rows re-enter the viewport constantly; only the first request counts.
            if (existing && existing.status !== PoolStatus.ERROR) return { state, effects };

            const channel = state.channels.find((c) => c.id === event.channelId);
            if (!channel) return { state, effects };

            return {
                state: {
                    ...state,
                    pools: {
                        ...state.pools,
                        [event.channelId]: { status: PoolStatus.LOADING, scenes: [], error: null }
                    }
                },
                effects: [
                    Effects.fetchPool(
                        channel.id,
                        channel.sceneFilter,
                        poolCapFor(state.prefs, channel.id, state.settings.guide_pool_cap)
                    )
                ]
            };
        }

        case Events.POOL_LOADED: {
            const schedule = buildDaySchedule(event.channelId, event.scenes, state.dayKey);
            const next = {
                ...state,
                pools: {
                    ...state.pools,
                    [event.channelId]: { status: PoolStatus.READY, scenes: event.scenes, error: null }
                },
                schedules: { ...state.schedules, [event.channelId]: schedule }
            };
            // The tuned channel's pool arriving is what actually starts playback.
            if (event.channelId === state.tunedChannelId) {
                effects.push(...tuneEffects(next, event.channelId, state.nowMs));
            }
            return { state: next, effects };
        }

        case Events.POOL_FAILED:
            return {
                state: {
                    ...state,
                    pools: {
                        ...state.pools,
                        [event.channelId]: { status: PoolStatus.ERROR, scenes: [], error: event.message }
                    }
                },
                effects
            };

        case Events.TUNE: {
            if (!state.channels.some((c) => c.id === event.channelId)) return { state, effects };

            // Tuning always ends a preview and any pause: the whole point is to
            // start watching something. Leaving either set meant the player
            // never came back, because tuneEffects declines to act on both.
            const next = { ...state, tunedChannelId: event.channelId, preview: null, viewerPaused: false };
            effects.push(Effects.persist(STORAGE_KEYS.tunedChannel, event.channelId));

            const channel = state.channels.find((c) => c.id === event.channelId);
            const program = liveProgram(next, event.channelId, state.nowMs);
            effects.push(
                Effects.announce(
                    program ? `${channel.name}. ${program.scene.title || 'Untitled'}` : `${channel.name}. No programming`
                )
            );
            // Move the details onto what is now playing. Without this, tuning
            // out of a preview left the banner describing the scene you had
            // been previewing.
            if (program) {
                next.focus = {
                    channelId: event.channelId,
                    timeMs: program.startMs,
                    source: 'sticky'
                };
            }

            effects.push(...tuneEffects(next, event.channelId, state.nowMs));
            return { state: next, effects };
        }

        case Events.EXPAND: {
            // Without a time this is "open what is on now"; with one it is
            // "open the programme the details are describing".
            const schedule = scheduleFor(state, event.channelId);
            if (!schedule) return { state, effects };
            const program = programAt(schedule, event.timeMs ?? state.nowMs, state.dayStartMs);
            if (!program) return { state, effects };

            // Only a live programme has a meaningful position to open at --
            // dropping into the middle of something scheduled for later would
            // land at an offset that means nothing yet.
            const isLive = program.startMs <= state.nowMs && program.endMs > state.nowMs;
            const offsetSeconds = isLive ? Math.floor(program.elapsedMs / 1000) : 0;
            return { state, effects: [Effects.navigateToScene(program.scene.id, offsetSeconds)] };
        }

        case Events.PAN: {
            const windowStartMs = clampWindowStart(
                state.windowStartMs + event.deltaMs,
                state.dayStartMs,
                MAX_PAN_AHEAD_MS
            );
            if (windowStartMs === state.windowStartMs) return { state, effects };
            return { state: { ...state, windowStartMs }, effects };
        }

        case Events.GO_TO_NOW:
            return {
                state: { ...state, windowStartMs: snapToStep(state.nowMs, HALF_HOUR_MS) },
                effects
            };

        case Events.FOCUS_CELL:
            return {
                state: {
                    ...state,
                    focus: {
                        channelId: event.channelId,
                        timeMs: event.timeMs,
                        // Hover previews are transient; clicks and keyboard focus
                        // are not. Mouse-leave only undoes a hover.
                        source: event.source || 'sticky'
                    }
                },
                effects
            };

        case Events.FOCUS_LIVE: {
            // The mouse left the grid: put the banner back on what is playing.
            if (state.preview) return { state, effects };
            const live = liveProgram(state, state.tunedChannelId, state.nowMs);
            // Nothing playing to fall back to: an empty banner is honest, where
            // leaving the hovered scene up would claim it is on.
            if (!live) return { state: { ...state, focus: null }, effects };
            return {
                state: {
                    ...state,
                    focus: {
                        channelId: state.tunedChannelId,
                        timeMs: live.startMs,
                        source: 'live'
                    }
                },
                effects
            };
        }

        case Events.MOVE_FOCUS:
            return moveFocus(state, event);

        case Events.LAYOUT_CHANGED:
            if (event.layout === state.layout) return { state, effects };
            return { state: { ...state, layout: event.layout }, effects };

        case Events.PREFS_LOADED:
            return {
                state: withVisibleChannels({
                    ...state,
                    prefs: event.prefs,
                    managerSort: event.sort || state.managerSort,
                    lineup: event.lineup || state.lineup,
                    pinOrder: event.pinOrder || state.pinOrder,
                    collapsedGroups: event.collapsedGroups || state.collapsedGroups,
                    headWidthPx: event.headWidthPx || state.headWidthPx,
                    playerMode: event.playerMode || state.playerMode
                }),
                effects
            };

        case Events.SET_CHANNEL_PREF: {
            const prefs = setPref(state.prefs, event.channelId, event.patch);
            return {
                state: withVisibleChannels({ ...state, prefs }),
                effects: [Effects.persist(STORAGE_KEYS.prefs, JSON.stringify(prefs))]
            };
        }

        case Events.TOGGLE_PIN: {
            const pinOrder = togglePin(state.pinOrder, event.channelId);
            return {
                state: withVisibleChannels({ ...state, pinOrder }),
                effects: [Effects.persist(STORAGE_KEYS.pinOrder, JSON.stringify(pinOrder))]
            };
        }

        case Events.MOVE_PIN: {
            const pinOrder = movePin(state.pinOrder, event.channelId, event.toIndex);
            if (pinOrder === state.pinOrder) return { state, effects };
            return {
                state: withVisibleChannels({ ...state, pinOrder }),
                effects: [Effects.persist(STORAGE_KEYS.pinOrder, JSON.stringify(pinOrder))]
            };
        }

        case Events.TOGGLE_GROUP: {
            const collapsedGroups = state.collapsedGroups.includes(event.key)
                ? state.collapsedGroups.filter((k) => k !== event.key)
                : [...state.collapsedGroups, event.key];
            return {
                state: withVisibleChannels({ ...state, collapsedGroups }),
                effects: [Effects.persist(STORAGE_KEYS.collapsed, JSON.stringify(collapsedGroups))]
            };
        }

        case Events.GUIDE_SEARCH:
            if (event.query === state.guideSearch) return { state, effects };
            return { state: withVisibleChannels({ ...state, guideSearch: event.query }), effects };

        case Events.SET_TYPE_FILTER:
            if (event.typeFilter === state.typeFilter) return { state, effects };
            return { state: withVisibleChannels({ ...state, typeFilter: event.typeFilter }), effects };

        case Events.SET_HEAD_WIDTH: {
            const headWidthPx = Math.min(480, Math.max(120, Math.round(event.px)));
            if (headWidthPx === state.headWidthPx) return { state, effects };
            return {
                state: { ...state, headWidthPx },
                effects: [Effects.persist(STORAGE_KEYS.headWidth, String(headWidthPx))]
            };
        }

        case Events.TOGGLE_HIDDEN: {
            const hidden = Boolean(state.prefs[event.channelId]?.hidden);
            const prefs = setPref(state.prefs, event.channelId, { hidden: !hidden });
            return {
                state: withVisibleChannels({ ...state, prefs }),
                effects: [Effects.persist(STORAGE_KEYS.prefs, JSON.stringify(prefs))]
            };
        }

        // Dialog-only: this orders the channel manager's own list and nothing
        // else, so it deliberately does not recompute the visible channels.
        case Events.SET_MANAGER_SORT:
            if (event.sort === state.managerSort) return { state, effects };
            return {
                state: { ...state, managerSort: event.sort },
                effects: [Effects.persist(STORAGE_KEYS.sort, event.sort)]
            };

        case Events.SET_LINEUP:
            // Changing which sources are included means re-resolving from the
            // server; prefs and schedules for surviving channels are untouched.
            return {
                state: { ...state, lineup: event.lineup, channelsStatus: PoolStatus.LOADING },
                effects: [
                    Effects.persist(STORAGE_KEYS.lineup, JSON.stringify(event.lineup)),
                    Effects.reloadChannels()
                ]
            };

        case Events.MANAGER_OPEN: {
            const next = { ...state, managerOpen: true };
            const source = event.source || state.managerSource;
            next.managerSource = source;

            // One source at a time, fetched the first time it is opened: the
            // whole catalogue is many thousands of rows on a large library.
            if (!state.catalogStatus[source]) {
                next.catalogStatus = { ...state.catalogStatus, [source]: PoolStatus.LOADING };
                effects.push(Effects.loadCatalog(source));
            }
            return { state: next, effects };
        }

        case Events.SET_MANAGER_SOURCE: {
            if (event.source === state.managerSource) return { state, effects };
            const next = { ...state, managerSource: event.source };
            if (!state.catalogStatus[event.source]) {
                next.catalogStatus = { ...state.catalogStatus, [event.source]: PoolStatus.LOADING };
                effects.push(Effects.loadCatalog(event.source));
            }
            return { state: next, effects };
        }

        case Events.MANAGER_CLOSE:
            return { state: { ...state, managerOpen: false }, effects };

        case Events.MANAGER_SEARCH:
            return { state: { ...state, managerSearch: event.query }, effects };

        case Events.CATALOG_LOADED: {
            const source = event.source || state.managerSource;
            return {
                state: {
                    ...state,
                    catalog: { ...state.catalog, ...event.catalog },
                    catalogStatus: { ...state.catalogStatus, [source]: PoolStatus.READY },
                    catalogError: { ...state.catalogError, [source]: null }
                },
                effects
            };
        }

        case Events.CATALOG_FAILED: {
            const source = event.source || state.managerSource;
            return {
                state: {
                    ...state,
                    catalogStatus: { ...state.catalogStatus, [source]: PoolStatus.ERROR },
                    catalogError: { ...state.catalogError, [source]: event.message }
                },
                effects
            };
        }

        case Events.SET_PLAYER_MODE:
            if (event.mode === state.playerMode) return { state, effects };
            return {
                state: { ...state, playerMode: event.mode },
                effects: [
                    Effects.setPlayerMode(event.mode),
                    Effects.persist(STORAGE_KEYS.playerMode, event.mode)
                ]
            };

        case Events.SET_VIEWER_PAUSED: {
            if (event.paused === state.viewerPaused) return { state, effects };
            // Remember when the pause started so the player can freeze its
            // readout there. The schedule keeps running -- the now-line and the
            // grid still track real time -- but the panel describing a stopped
            // picture must not claim to be advancing through it.
            const next = { ...state, viewerPaused: event.paused, pausedAtMs: event.paused ? state.nowMs : 0 };
            if (event.paused) return { state: next, effects: [Effects.setPaused(true)] };
            // Resuming re-syncs to live rather than continuing from where it
            // stopped: a paused channel has fallen behind its own schedule.
            return { state: next, effects: tuneEffects(next, next.tunedChannelId, state.nowMs) };
        }

        case Events.PREVIEW: {
            const schedule = state.schedules[event.channelId];
            if (!schedule) return { state, effects };
            const program = programAt(schedule, event.timeMs, state.dayStartMs);
            if (!program) return { state, effects };

            // Clicking something already live is not a preview -- it is tuning.
            const isLive = program.startMs <= state.nowMs && program.endMs > state.nowMs;
            if (isLive) {
                return reduce(state, { type: Events.TUNE, channelId: event.channelId });
            }

            // Previewing hides the video entirely, and a hidden element cannot
            // stay fullscreen -- so leave it deliberately rather than letting
            // the CSS drop it out from under the browser.
            const leavingFullscreen = state.playerMode === 'fullscreen';
            return {
                state: {
                    ...state,
                    playerMode: leavingFullscreen ? 'corner' : state.playerMode,
                    preview: { channelId: event.channelId, scene: program.scene, startMs: program.startMs },
                    focus: { channelId: event.channelId, timeMs: program.startMs, source: 'sticky' }
                },
                effects: [
                    ...(leavingFullscreen ? [Effects.setPlayerMode('corner')] : []),
                    Effects.setPaused(true),
                    Effects.showPoster(program.scene)
                ]
            };
        }

        case Events.BACK_TO_LIVE: {
            if (!state.preview) return { state, effects };
            const next = { ...state, preview: null, viewerPaused: false };
            const live = liveProgram(next, next.tunedChannelId, state.nowMs);
            if (live) {
                next.focus = {
                    channelId: next.tunedChannelId,
                    timeMs: live.startMs,
                    source: 'sticky'
                };
            }
            return { state: next, effects: tuneEffects(next, next.tunedChannelId, state.nowMs) };
        }

        case Events.RESUME_AFTER_HIDDEN: {
            // Returning from another app leaves the element paused with no event
            // that drift correction can act on, so playback is re-established
            // explicitly.
            if (!state.open || state.viewerPaused || state.preview) return { state, effects };
            return { state, effects: tuneEffects(state, state.tunedChannelId, state.nowMs) };
        }

        case Events.SET_MUTED:
            return {
                state: { ...state, muted: event.muted },
                effects: [Effects.setMuted(event.muted), Effects.persist(STORAGE_KEYS.muted, String(event.muted))]
            };

        default:
            return { state, effects };
    }
}

/**
 * Keyboard focus movement across the grid.
 *
 * Blocks have no fixed width, so "next" means the next programme in time on the
 * focused channel, and moving between channels keeps the current time position
 * rather than a column index -- which is how a real guide behaves.
 */
function moveFocus(state, event) {
    const effects = [];
    if (!state.focus || state.channels.length === 0) return { state, effects };

    const { channelId, timeMs } = state.focus;

    if (event.axis === 'channel') {
        const index = state.channels.findIndex((c) => c.id === channelId);
        const nextIndex = Math.min(state.channels.length - 1, Math.max(0, index + event.delta));
        if (nextIndex === index) return { state, effects };
        return {
            state: {
                ...state,
                focus: { channelId: state.channels[nextIndex].id, timeMs, source: 'keyboard' }
            },
            effects
        };
    }

    const schedule = scheduleFor(state, channelId);
    if (!schedule) return { state, effects };

    const current = programAt(schedule, timeMs, state.dayStartMs);
    if (!current) return { state, effects };

    // Step just inside the neighbouring programme rather than onto its edge,
    // so the following lookup cannot land back on the current block.
    const target = event.delta > 0 ? current.endMs : current.startMs - 1;
    // Non-null: `current` existing proves the schedule has programming, and the
    // schedule loops, so every instant maps to some programme.
    const neighbour = programAt(schedule, target, state.dayStartMs);

    const next = { ...state, focus: { channelId, timeMs: neighbour.startMs, source: 'keyboard' } };

    // Follow the focus if it walked off the visible window.
    const windowMs = windowMsOf(state);
    if (neighbour.startMs < state.windowStartMs) {
        next.windowStartMs = clampWindowStart(
            snapToStep(neighbour.startMs, HALF_HOUR_MS),
            state.dayStartMs,
            MAX_PAN_AHEAD_MS
        );
    } else if (neighbour.startMs >= state.windowStartMs + windowMs) {
        next.windowStartMs = clampWindowStart(
            snapToStep(neighbour.startMs, HALF_HOUR_MS),
            state.dayStartMs,
            MAX_PAN_AHEAD_MS
        );
    }

    return { state: next, effects };
}

export { createInitialState };
