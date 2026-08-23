/**
 * The desktop time-grid: rows are channels, the x axis is the clock.
 *
 * Blocks are positioned by percentage, so the grid needs no pixel measurement
 * and stays correct through any resize. Rows render as skeletons until their
 * pool arrives; an IntersectionObserver asks for it, so a long lineup only
 * fetches what you actually look at.
 *
 * Two things here are easy to get wrong and are worth stating:
 *
 * - **The now-line and gridlines live in a track overlay**, not in the scroll
 *   container. Their `left: %` has to be a percentage of the track *after* the
 *   channel column; positioning them against the full container and adding a
 *   margin (as this used to) puts the line progressively further right the later
 *   in the window it falls.
 * - **Channels are always grouped**, and collapsed groups render no rows, so the
 *   flattened `state.channels` the reducer walks matches the DOM exactly.
 */

import { el, replaceChildren } from './dom.js';
import { formatClock } from '../domain/format.js';
import { sceneTitle } from '../api/scenes.js';
import { condenseRow, shouldCondense } from '../domain/schedule.js';
import { PINNED_GROUP } from '../domain/channelPrefs.js';
import { SOURCE_LABELS } from '../domain/lineup.js';
import { Events } from '../state/actions.js';
import { PoolStatus } from '../state/initialState.js';
import * as sel from '../state/selectors.js';
import { logoBadge } from './logoBadge.js';
import { openSource } from './sourceLink.js';
import { createChannelRail } from './channelRail.js';

const GROUP_LABELS = { ...SOURCE_LABELS, [PINNED_GROUP]: 'Pinned' };

export function createGrid({ store, onRowVisible, touchGuard }) {
    const typeBar = el('div', {
        class: 'tvguide-typebar',
        role: 'toolbar',
        'aria-label': 'Filter channels by type'
    });

    const ticksRow = el('div', { class: 'tvguide-ticks', 'aria-hidden': 'true' });
    const gridlines = el('div', { class: 'tvguide-gridlines', 'aria-hidden': 'true' });
    const nowLine = el('div', { class: 'tvguide-nowline', 'aria-hidden': 'true' });

    // Percentages inside this element are percentages of the track, which is
    // what makes the now-line land on the right minute.
    const trackOverlay = el(
        'div',
        { class: 'tvguide-track-overlay', 'aria-hidden': 'true' },
        gridlines,
        nowLine
    );

    const body = el('div', {
        class: 'tvguide-grid-body',
        role: 'grid',
        'aria-label': 'Channel guide',
        'aria-readonly': 'true'
    });

    const inner = el('div', { class: 'tvguide-grid-inner' }, trackOverlay, body);
    const scroll = el('div', { class: 'tvguide-grid-scroll' }, inner);

    const rail = createChannelRail({
        store,
        onJump: (channelId) => scrollChannelIntoView(channelId)
    });

    const resizer = el('div', {
        class: 'tvguide-resizer',
        role: 'separator',
        tabindex: '0',
        'aria-label': 'Resize channel column',
        'aria-orientation': 'vertical',
        onkeydown: onResizerKey
    });

    const root = el(
        'div',
        { class: 'tvguide-grid' },
        typeBar,
        el(
            'div',
            { class: 'tvguide-grid-head' },
            el('div', { class: 'tvguide-grid-corner' }, rail.element),
            resizer,
            ticksRow
        ),
        scroll
    );

    // Hovering previews; leaving the grid puts the banner back on what is live.
    // Only a hover-sourced focus is reset -- a clicked preview or keyboard focus
    // must survive the mouse leaving.
    body.addEventListener('mouseleave', () => {
        const state = store.getState();
        if (state.focus?.source !== 'hover') return;
        store.dispatch({ type: Events.FOCUS_LIVE });
    });

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

    let renderedRowSignature = '';
    let dragChannelId = null;

    return {
        element: root,

        render(state) {
            root.style.setProperty('--tvguide-head-width', `${state.headWidthPx}px`);

            renderTypeBar(state);
            renderTicks(state);
            renderGridlines(state);
            renderNowLine(state);
            rail.render(state);

            const signature = rowsSignature(state);
            if (signature !== renderedRowSignature) {
                renderedRowSignature = signature;
                buildRows(state);
            } else {
                updateRows(state);
            }
        },

        scrollChannelIntoView,

        destroy() {
            if (observer) observer.disconnect();
        }
    };

    // ---- chrome -------------------------------------------------------------

    function renderTypeBar(state) {
        const types = sel.availableTypes(state);
        typeBar.hidden = types.length === 0;
        if (types.length === 0) return;

        const active = state.typeFilter;
        replaceChildren(
            typeBar,
            [['all', 'All'], ...types.map((t) => [t, SOURCE_LABELS[t] || t])].map(([value, label]) =>
                el(
                    'button',
                    {
                        class: 'tvguide-typebutton',
                        type: 'button',
                        'aria-pressed': active === value ? 'true' : 'false',
                        onclick: () => store.dispatch({ type: Events.SET_TYPE_FILTER, typeFilter: value })
                    },
                    label
                )
            )
        );
    }

    function renderTicks(state) {
        replaceChildren(
            ticksRow,
            sel.ticks(state).map((tick) =>
                el('span', { class: 'tvguide-tick', style: { left: `${tick.leftPct}%` } }, tick.label)
            )
        );
    }

    /** Vertical rules at each half hour, so a block's edges can be read. */
    function renderGridlines(state) {
        replaceChildren(
            gridlines,
            sel.ticks(state).map((tick) =>
                el('span', { class: 'tvguide-gridline', style: { left: `${tick.leftPct}%` } })
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

    // ---- rows ---------------------------------------------------------------

    function rowsSignature(state) {
        return state.channelGroups
            .map(
                (group) =>
                    `${group.key}:${group.collapsed ? 'c' : 'o'}:` +
                    group.channels.map((c) => `${c.id}~${c.name}~${c.logo?.url || c.logo?.initials || ''}`).join(',')
            )
            .join('|');
    }

    function buildRows(state) {
        const nodes = [];
        for (const group of state.channelGroups) {
            nodes.push(groupHeader(group));
            if (group.collapsed) continue;
            for (const channel of group.channels) {
                nodes.push(channelRow(state, group, channel));
            }
        }
        replaceChildren(body, nodes);
        updateRows(state);
    }

    function groupHeader(group) {
        return el(
            'div',
            { class: 'tvguide-group', role: 'row' },
            el(
                'button',
                {
                    class: 'tvguide-group-toggle',
                    type: 'button',
                    'aria-expanded': group.collapsed ? 'false' : 'true',
                    onclick: () => store.dispatch({ type: Events.TOGGLE_GROUP, key: group.key })
                },
                el('span', { class: 'tvguide-group-caret' }, group.collapsed ? '▸' : '▾'),
                el('span', { class: 'tvguide-group-label' }, GROUP_LABELS[group.key] || group.key),
                el('span', { class: 'tvguide-group-count' }, `(${group.count})`)
            )
        );
    }

    function channelRow(state, group, channel) {
        const pinned = state.pinOrder.includes(channel.id);
        const inPinnedGroup = group.key === PINNED_GROUP;

        const row = el(
            'div',
            {
                class: `tvguide-row${inPinnedGroup ? ' tvguide-row-pinned' : ''}`,
                role: 'row',
                'data-channel-id': channel.id,
                // Enumerated, not boolean: it needs the literal string.
                draggable: inPinnedGroup ? 'true' : false
            },
            el(
                'div',
                { class: 'tvguide-row-head', role: 'rowheader' },
                el(
                    'button',
                    {
                        class: 'tvguide-pin',
                        type: 'button',
                        'aria-label': pinned ? `Unpin ${channel.name}` : `Pin ${channel.name}`,
                        'aria-pressed': pinned ? 'true' : 'false',
                        onclick: () => store.dispatch({ type: Events.TOGGLE_PIN, channelId: channel.id })
                    },
                    pinned ? '★' : '☆'
                ),
                el(
                    'button',
                    {
                        class: 'tvguide-logo-button',
                        type: 'button',
                        'aria-label': `Open ${channel.name}`,
                        onclick: () => openSource(channel)
                    },
                    logoBadge(channel)
                ),
                el('span', { class: 'tvguide-row-name' }, channel.name)
            ),
            el('div', { class: 'tvguide-row-track' })
        );

        if (inPinnedGroup) attachDrag(row, channel.id);
        if (observer) observer.observe(row);
        return row;
    }

    /** Drag to reorder pinned channels; arrow keys do the same from the pin button. */
    function attachDrag(row, channelId) {
        row.addEventListener('dragstart', (event) => {
            dragChannelId = channelId;
            if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        });
        row.addEventListener('dragover', (event) => event.preventDefault());
        row.addEventListener('drop', (event) => {
            event.preventDefault();
            if (!dragChannelId || dragChannelId === channelId) return;
            const order = store.getState().pinOrder;
            store.dispatch({
                type: Events.MOVE_PIN,
                channelId: dragChannelId,
                toIndex: order.indexOf(channelId)
            });
            dragChannelId = null;
        });
    }

    function updateRows(state) {
        for (const row of body.querySelectorAll('.tvguide-row')) {
            const channelId = row.dataset.channelId;
            const track = row.querySelector('.tvguide-row-track');
            const status = sel.poolStatus(state, channelId);

            row.classList.toggle('tvguide-row-tuned', channelId === state.tunedChannelId);

            const signature = [status, state.windowStartMs, sel.windowMs(state), state.dayKey].join('|');
            if (track.dataset.signature === signature) {
                restyleBlocks(state, channelId, track);
                continue;
            }
            track.dataset.signature = signature;

            if (status === PoolStatus.READY) renderTrack(state, channelId, track);
            else if (status === PoolStatus.ERROR) {
                replaceChildren(track, el('div', { class: 'tvguide-row-empty' }, 'Could not load'));
            } else {
                replaceChildren(track, el('div', { class: 'tvguide-row-skeleton' }));
            }
        }
    }

    function renderTrack(state, channelId, track) {
        const blocks = sel.rowBlocks(state, channelId);
        if (blocks.length === 0) {
            replaceChildren(track, el('div', { class: 'tvguide-row-empty' }, 'No programming'));
            return;
        }

        // Measured, not guessed: whether blocks are legible depends on the real
        // track width, which changes with the window and the column resize.
        // A zero width means we have not been laid out yet -- do not condense on
        // no information.
        const trackWidth = track.clientWidth;
        const programs = blocks.map((b) => b.program);

        if (trackWidth > 0 && shouldCondense(programs, trackWidth)) {
            renderCondensed(state, channelId, track, programs);
            return;
        }

        track.classList.remove('is-condensed');
        replaceChildren(track, blocks.map((block) => renderBlock(channelId, block)));
    }

    /**
     * A channel of two-minute scenes is unreadable as thirty slivers, so the row
     * collapses to counts either side of a labelled few. These segments are laid
     * out for readability rather than to scale, so this row no longer lines up
     * with the clock -- the live highlight identifies what is on.
     */
    function renderCondensed(state, channelId, track, programs) {
        const anchorMs =
            state.nowMs >= state.windowStartMs && state.nowMs < sel.windowEndMs(state)
                ? state.nowMs
                : state.windowStartMs;

        track.classList.add('is-condensed');
        replaceChildren(
            track,
            condenseRow(programs, anchorMs).map((segment) =>
                segment.kind === 'count'
                    ? el('div', { class: 'tvguide-condensed-count' }, `${segment.n} scenes`)
                    : condensedBlock(state, channelId, segment.program)
            )
        );
    }

    function condensedBlock(state, channelId, program) {
        const isLive = program.startMs <= state.nowMs && program.endMs > state.nowMs;
        return el(
            'div',
            {
                class: `tvguide-block tvguide-condensed-block${isLive ? ' tvguide-block-live' : ''}`,
                role: 'gridcell',
                tabindex: '-1',
                'data-start-ms': String(program.startMs),
                'data-end-ms': String(program.endMs),
                'aria-label': `${sceneTitle(program.scene)}, ${formatClock(program.startMs)}`,
                onclick: () => activate(channelId, program)
            },
            el('span', { class: 'tvguide-block-title' }, sceneTitle(program.scene)),
            el('span', { class: 'tvguide-block-time' }, formatClock(program.startMs))
        );
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
                tabindex: isFocused ? '0' : '-1',
                'aria-label': label,
                'aria-selected': isFocused ? 'true' : 'false',
                'data-start-ms': String(program.startMs),
                'data-end-ms': String(program.endMs),
                style: { left: `${rect.leftPct}%`, width: `${rect.widthPct}%` },
                onclick: () => activate(channelId, program),
                onfocus: () =>
                    store.dispatch({
                        type: Events.FOCUS_CELL,
                        channelId,
                        timeMs: program.startMs,
                        source: 'keyboard'
                    }),
                onmouseenter: () => {
                    if (touchGuard && touchGuard.isSyntheticMouse()) return;
                    store.dispatch({
                        type: Events.FOCUS_CELL,
                        channelId,
                        timeMs: program.startMs,
                        source: 'hover'
                    });
                }
            },
            el('span', { class: 'tvguide-block-title' }, sceneTitle(program.scene)),
            el('span', { class: 'tvguide-block-time' }, formatClock(program.startMs))
        );

        if (isFocused) adoptFocus(block);
        return block;
    }

    /**
     * Clicking a live block tunes; clicking anything else previews it as a still.
     * PREVIEW itself decides which, so the two paths cannot disagree.
     */
    function activate(channelId, program) {
        store.dispatch({ type: Events.PREVIEW, channelId, timeMs: program.startMs });
    }

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

    function adoptFocus(block) {
        const active = document.activeElement;
        const focusIsInGrid = active && (body.contains(active) || active === document.body);
        if (!focusIsInGrid || active === block) return;

        queueMicrotask(() => {
            if (block.isConnected && document.activeElement !== block) block.focus();
        });
    }

    // ---- navigation ---------------------------------------------------------

    function scrollChannelIntoView(channelId) {
        const row = body.querySelector(`.tvguide-row[data-channel-id="${cssEscape(channelId)}"]`);
        if (row && row.scrollIntoView) row.scrollIntoView({ block: 'center' });
    }

    function cssEscape(value) {
        return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"');
    }

    function onResizerKey(event) {
        const step = event.shiftKey ? 40 : 10;
        const current = store.getState().headWidthPx;
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            store.dispatch({ type: Events.SET_HEAD_WIDTH, px: current - step });
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            store.dispatch({ type: Events.SET_HEAD_WIDTH, px: current + step });
        }
    }

    // Pointer drag on the divider. Pointer events cover mouse and touch in one.
    resizer.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = store.getState().headWidthPx;

        const onMove = (move) =>
            store.dispatch({ type: Events.SET_HEAD_WIDTH, px: startWidth + (move.clientX - startX) });
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    });
}
