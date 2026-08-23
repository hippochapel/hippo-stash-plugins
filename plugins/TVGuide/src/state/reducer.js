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
import { visibleChannels, setPref, poolCapFor } from '../domain/channelPrefs.js';

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
 * If the tuned or focused channel just became hidden, both fall back to the
 * first channel still visible rather than pointing at nothing.
 */
function withVisibleChannels(state) {
    const channels = visibleChannels(state.allChannels, state.prefs, state.sort);
    const next = { ...state, channels };

    const stillThere = (id) => channels.some((c) => c.id === id);

    if (next.tunedChannelId && !stillThere(next.tunedChannelId)) {
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

            const next = { ...state, tunedChannelId: event.channelId };
            effects.push(Effects.persist(STORAGE_KEYS.tunedChannel, event.channelId));

            const channel = state.channels.find((c) => c.id === event.channelId);
            const program = liveProgram(next, event.channelId, state.nowMs);
            effects.push(
                Effects.announce(
                    program ? `${channel.name}. ${program.scene.title || 'Untitled'}` : `${channel.name}. No programming`
                )
            );
            effects.push(...tuneEffects(next, event.channelId, state.nowMs));
            return { state: next, effects };
        }

        case Events.EXPAND: {
            const program = liveProgram(state, event.channelId, state.nowMs);
            if (!program) return { state, effects };
            return {
                state,
                effects: [Effects.navigateToScene(program.scene.id, Math.floor(program.elapsedMs / 1000))]
            };
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
                state: { ...state, focus: { channelId: event.channelId, timeMs: event.timeMs } },
                effects
            };

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
                    sort: event.sort || state.sort,
                    lineup: event.lineup || state.lineup
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
            // pinnedAt doubles as the pin order, so pinning stamps the clock
            // and unpinning clears it.
            const pinned = Boolean(state.prefs[event.channelId]?.pinnedAt);
            const prefs = setPref(state.prefs, event.channelId, {
                pinnedAt: pinned ? null : event.nowMs || state.nowMs || 1
            });
            return {
                state: withVisibleChannels({ ...state, prefs }),
                effects: [Effects.persist(STORAGE_KEYS.prefs, JSON.stringify(prefs))]
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

        case Events.SET_SORT:
            if (event.sort === state.sort) return { state, effects };
            return {
                state: withVisibleChannels({ ...state, sort: event.sort }),
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
            // The catalogue is thousands of rows on a large library, so it is
            // fetched once, the first time the manager is actually opened.
            if (state.catalogStatus === PoolStatus.IDLE) {
                next.catalogStatus = PoolStatus.LOADING;
                effects.push(Effects.loadCatalog());
            }
            return { state: next, effects };
        }

        case Events.MANAGER_CLOSE:
            return { state: { ...state, managerOpen: false }, effects };

        case Events.MANAGER_SEARCH:
            return { state: { ...state, managerSearch: event.query }, effects };

        case Events.CATALOG_LOADED:
            return {
                state: {
                    ...state,
                    catalog: event.catalog,
                    catalogStatus: PoolStatus.READY,
                    catalogError: null
                },
                effects
            };

        case Events.CATALOG_FAILED:
            return {
                state: { ...state, catalogStatus: PoolStatus.ERROR, catalogError: event.message },
                effects
            };

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
            state: { ...state, focus: { channelId: state.channels[nextIndex].id, timeMs } },
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

    const next = { ...state, focus: { channelId, timeMs: neighbour.startMs } };

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
