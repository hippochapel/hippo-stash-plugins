/**
 * The desktop time-grid: rows are channels, the x axis is the clock.
 *
 * Blocks are positioned by percentage, so the grid needs no pixel measurement
 * and stays correct through any resize. Rows render as skeletons until their
 * pool arrives; an IntersectionObserver is what asks for it, so a long lineup
 * only fetches what you actually look at.
 *
 * Roles follow the ARIA grid pattern, with a roving tabindex driven by
 * `state.focus` -- exactly one cell is tabbable at a time.
 */

import { el, replaceChildren } from './dom.js';
import { formatClock } from '../domain/format.js';
import { sceneTitle } from '../api/scenes.js';
import { Events } from '../state/actions.js';
import { PoolStatus } from '../state/initialState.js';
import * as sel from '../state/selectors.js';
import { logoBadge } from './logoBadge.js';

export function createGrid({ store, onRowVisible, touchGuard }) {
    const ticksRow = el('div', { class: 'tvguide-ticks', 'aria-hidden': 'true' });
    const nowLine = el('div', { class: 'tvguide-nowline', 'aria-hidden': 'true' });

    const body = el('div', {
        class: 'tvguide-grid-body',
        role: 'grid',
        'aria-label': 'Channel guide',
        'aria-readonly': 'true'
    });

    const root = el(
        'div',
        { class: 'tvguide-grid' },
        el('div', { class: 'tvguide-grid-head' }, el('div', { class: 'tvguide-grid-corner' }), ticksRow),
        el('div', { class: 'tvguide-grid-scroll' }, nowLine, body)
    );

    // Rows are observed once and asked for their pool the first time they are
    // seen; the reducer ignores repeat requests.
    const observer =
        typeof IntersectionObserver === 'function'
            ? new IntersectionObserver(
                  (entries) => {
                      for (const entry of entries) {
                          if (entry.isIntersecting && entry.target.dataset.channelId) {
                              onRowVisible(entry.target.dataset.channelId);
                          }
                      }
                  },
                  { root: null, rootMargin: '200px' }
              )
            : null;

    let renderedChannelIds = '';

    return {
        element: root,

        render(state) {
            renderTicks(state);
            renderNowLine(state);

            const ids = state.channels.map((c) => c.id).join(',');
            if (ids !== renderedChannelIds) {
                renderedChannelIds = ids;
                buildRows(state);
            } else {
                updateRows(state);
            }
        },

        destroy() {
            if (observer) observer.disconnect();
        }
    };

    function renderTicks(state) {
        replaceChildren(
            ticksRow,
            sel.ticks(state).map((tick) =>
                el('span', { class: 'tvguide-tick', style: { left: `${tick.leftPct}%` } }, tick.label)
            )
        );
    }

    function renderNowLine(state) {
        const pct = sel.nowMarkerPct(state);
        if (pct == null) {
            nowLine.style.display = 'none';
            return;
        }
        nowLine.style.display = '';
        nowLine.style.left = `${pct}%`;
    }

    function buildRows(state) {
        replaceChildren(
            body,
            state.channels.map((channel) => {
                const row = el(
                    'div',
                    { class: 'tvguide-row', role: 'row', 'data-channel-id': channel.id },
                    el(
                        'div',
                        { class: 'tvguide-row-head', role: 'rowheader' },
                        logoBadge(channel),
                        el('span', { class: 'tvguide-row-name' }, channel.name)
                    ),
                    el('div', { class: 'tvguide-row-track' })
                );
                if (observer) observer.observe(row);
                return row;
            })
        );
        updateRows(state);
    }

    /**
     * The block set only changes when the window pans, a pool arrives, or the
     * broadcast day rolls over -- not on every tick. Rebuilding regardless
     * would churn the DOM once a second and throw away keyboard focus, so
     * ticks take the cheap path and only restyle what is already there.
     */
    function rowSignature(state, channelId, status) {
        return [status, state.windowStartMs, sel.windowMs(state), state.dayKey].join('|');
    }

    function updateRows(state) {
        for (const row of body.querySelectorAll('.tvguide-row')) {
            const channelId = row.dataset.channelId;
            const track = row.querySelector('.tvguide-row-track');
            const status = sel.poolStatus(state, channelId);

            row.classList.toggle('tvguide-row-tuned', channelId === state.tunedChannelId);

            const signature = rowSignature(state, channelId, status);
            if (track.dataset.signature === signature) {
                restyleBlocks(state, channelId, track);
                continue;
            }
            track.dataset.signature = signature;

            if (status === PoolStatus.READY) {
                const blocks = sel.rowBlocks(state, channelId);
                replaceChildren(
                    track,
                    blocks.length > 0
                        ? blocks.map((block) => renderBlock(channelId, block))
                        : el('div', { class: 'tvguide-row-empty' }, 'No programming')
                );
            } else if (status === PoolStatus.ERROR) {
                replaceChildren(track, el('div', { class: 'tvguide-row-empty' }, 'Could not load'));
            } else {
                replaceChildren(track, el('div', { class: 'tvguide-row-skeleton' }));
            }
        }
    }

    /** Update only what time and focus change: the live badge and the roving tabindex. */
    function restyleBlocks(state, channelId, track) {
        for (const block of track.querySelectorAll('.tvguide-block')) {
            const startMs = Number(block.dataset.startMs);
            const endMs = Number(block.dataset.endMs);

            block.classList.toggle('tvguide-block-live', startMs <= state.nowMs && endMs > state.nowMs);

            const isFocused =
                state.focus?.channelId === channelId &&
                startMs <= state.focus.timeMs &&
                endMs > state.focus.timeMs;

            block.classList.toggle('tvguide-block-focused', isFocused);
            block.tabIndex = isFocused ? 0 : -1;
            block.setAttribute('aria-selected', isFocused ? 'true' : 'false');

            if (isFocused) adoptFocus(block);
        }
    }

    /**
     * Move DOM focus to the focused cell -- but only when focus already lives
     * in the grid. Otherwise a background re-render would yank focus away from
     * whatever control the user was actually using.
     */
    function adoptFocus(block) {
        const active = document.activeElement;
        const focusIsInGrid = active && (body.contains(active) || active === document.body);
        if (!focusIsInGrid || active === block) return;

        queueMicrotask(() => {
            if (block.isConnected && document.activeElement !== block) block.focus();
        });
    }

    function renderBlock(channelId, { program, rect, isLive, isFocused }) {
        const label = `${sceneTitle(program.scene)}, ${formatClock(program.startMs)} to ${formatClock(program.endMs)}`;

        const block = el(
            'div',
            {
                class: [
                    'tvguide-block',
                    isLive && 'tvguide-block-live',
                    isFocused && 'tvguide-block-focused',
                    rect.clippedStart && 'tvguide-block-clip-start',
                    rect.clippedEnd && 'tvguide-block-clip-end'
                ]
                    .filter(Boolean)
                    .join(' '),
                role: 'gridcell',
                // Roving tabindex: only the focused cell is reachable by Tab.
                tabindex: isFocused ? '0' : '-1',
                'aria-label': label,
                'aria-selected': isFocused ? 'true' : 'false',
                'data-start-ms': String(program.startMs),
                'data-end-ms': String(program.endMs),
                style: { left: `${rect.leftPct}%`, width: `${rect.widthPct}%` },
                onclick: () => {
                    store.dispatch({
                        type: Events.FOCUS_CELL,
                        channelId,
                        timeMs: program.startMs
                    });
                    store.dispatch({ type: Events.TUNE, channelId });
                },
                onfocus: () => {
                    store.dispatch({ type: Events.FOCUS_CELL, channelId, timeMs: program.startMs });
                },
                onmouseenter: () => {
                    // Ignore the synthetic mouseenter that follows a tap.
                    if (touchGuard && touchGuard.isSyntheticMouse()) return;
                    store.dispatch({ type: Events.FOCUS_CELL, channelId, timeMs: program.startMs });
                }
            },
            el('span', { class: 'tvguide-block-title' }, sceneTitle(program.scene)),
            el('span', { class: 'tvguide-block-time' }, formatClock(program.startMs))
        );

        if (isFocused) adoptFocus(block);

        return block;
    }
}
