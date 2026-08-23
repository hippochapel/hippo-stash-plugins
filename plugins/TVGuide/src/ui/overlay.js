/**
 * The overlay shell: chrome, layout switching, and hash routing.
 *
 * Deliberately a DOM overlay rather than a PluginApi route -- the other plugins
 * in this repo avoid coupling to Stash's React internals, which shift between
 * releases. The `#tvguide` hash gives back the parts of a real route that
 * matter: Back closes the guide, and the URL can be shared.
 */

import { el, replaceChildren } from './dom.js';
import { Events } from '../state/actions.js';
import * as sel from '../state/selectors.js';
import { createBanner } from './banner.js';
import { createGrid } from './grid.js';
import { createList } from './list.js';
import { trapFocus } from './a11y.js';
import { createManager } from './manager.js';
import { createPlayer } from './player.js';

export const HASH = '#tvguide';
export const BODY_CLASS = 'stash-tvguide-active';

const SHORTCUTS = [
    ['← →', 'Previous / next programme'],
    ['↑ ↓', 'Previous / next channel'],
    ['Page Up / Down', 'Pan by one screen'],
    ['Home / End', 'Jump to window edges'],
    ['N', 'Back to now'],
    ['Enter', 'Watch in the corner viewer'],
    ['E', 'Open the scene at its live position'],
    ['M', 'Mute or unmute'],
    ['C', 'Manage channels'],
    ['?', 'This help'],
    ['Esc', 'Close the guide']
];

export function createOverlay({ store, viewer, announcer, touchGuard, onRowVisible }) {
    const banner = createBanner();
    const manager = createManager({ store });
    const grid = createGrid({ store, onRowVisible, touchGuard });
    const list = createList({ store, onRowVisible });

    const player = createPlayer({ store, viewer });

    const status = el('div', { class: 'tvguide-status' });

    // Panning has no meaning in the list layout -- there is no time window --
    // so these are hidden there rather than shown as dead buttons.
    const timeControls = el(
        'div',
        { class: 'tvguide-time-controls' },
        panButton('‹‹', 'Pan back', () => pan(-1)),
        el('button', {
            class: 'tvguide-now',
            type: 'button',
            text: 'Now',
            onclick: () => store.dispatch({ type: Events.GO_TO_NOW })
        }),
        panButton('››', 'Pan forward', () => pan(1))
    );

    const guideSearch = el('input', {
        type: 'search',
        class: 'tvguide-search',
        'aria-label': 'Filter channels',
        placeholder: 'Filter channels…',
        oninput: (e) => store.dispatch({ type: Events.GUIDE_SEARCH, query: e.target.value })
    });
    const stage = el('div', { class: 'tvguide-stage' });

    const helpPanel = el(
        'div',
        { class: 'tvguide-help', hidden: true, role: 'dialog', 'aria-label': 'Keyboard shortcuts' },
        el('h2', {}, 'Keyboard shortcuts'),
        el(
            'dl',
            {},
            SHORTCUTS.flatMap(([keys, description]) => [
                el('dt', {}, keys),
                el('dd', {}, description)
            ])
        )
    );

    const root = el(
        'div',
        {
            class: 'tvguide-overlay',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': 'TV Guide'
        },
        el(
            'header',
            { class: 'tvguide-header' },
            banner.element,
            player.element,
            // Its own slot rather than absolute positioning: overlaid, it sat on
            // top of the banner text.
            el(
                'div',
                { class: 'tvguide-close-slot' },
                el('button', {
                    class: 'tvguide-close',
                    type: 'button',
                    'aria-label': 'Close TV Guide',
                    text: '×',
                    onclick: () => close()
                })
            )
        ),
        el(
            'div',
            { class: 'tvguide-toolbar' },
            timeControls,
            guideSearch,
            el('button', {
                class: 'tvguide-jump',
                type: 'button',
                text: '⊙ Current',
                'aria-label': 'Jump to the channel playing now',
                onclick: () => {
                    const { tunedChannelId } = store.getState();
                    if (tunedChannelId) grid.scrollChannelIntoView(tunedChannelId);
                }
            }),
            el('button', {
                class: 'tvguide-manage',
                type: 'button',
                text: 'Channels',
                onclick: () => store.dispatch({ type: Events.MANAGER_OPEN })
            }),
            status
        ),
        stage,
        manager.element,
        helpPanel,
        announcer.element
    );

    let releaseFocus = null;
    let detachTouch = null;
    let mountedLayout = null;
    let lockedScrollY = 0;

    function panButton(label, ariaLabel, onclick) {
        return el('button', { class: 'tvguide-pan', type: 'button', 'aria-label': ariaLabel, onclick }, label);
    }

    function pan(direction) {
        store.dispatch({ type: Events.PAN, deltaMs: direction * sel.windowMs(store.getState()) });
    }

    function open() {
        if (store.getState().open) return;
        if (window.location.hash !== HASH) {
            window.history.pushState({ tvguide: true }, '', HASH);
        }
        store.dispatch({ type: Events.OPEN, nowMs: Date.now() });
    }

    function close() {
        if (!store.getState().open) return;
        store.dispatch({ type: Events.CLOSE });
        if (window.location.hash === HASH) window.history.back();
    }

    function mount() {
        if (root.isConnected) return;
        document.body.appendChild(root);

        // `overflow: hidden` alone does not lock scrolling in iOS Safari, which
        // is why the page behind the guide could still be panned sideways on an
        // iPad. Pinning the body is what actually holds it.
        lockedScrollY = window.scrollY || 0;
        document.body.style.top = `-${lockedScrollY}px`;
        document.body.classList.add(BODY_CLASS);
        releaseFocus = trapFocus(root);
        detachTouch = touchGuard.attach(root);
    }

    function unmount() {
        if (!root.isConnected) return;
        if (detachTouch) detachTouch();
        if (releaseFocus) releaseFocus();
        detachTouch = null;
        releaseFocus = null;
        document.body.classList.remove(BODY_CLASS);
        document.body.style.top = '';
        window.scrollTo(0, lockedScrollY);
        root.remove();
    }

    return {
        element: root,
        open,
        close,
        toggleHelp() {
            helpPanel.hidden = !helpPanel.hidden;
        },

        render(state) {
            if (!state.open) {
                unmount();
                return;
            }
            mount();

            // Grid and list are two renderers over one state; only the one in
            // use is in the DOM, so neither pays for the other.
            const view = sel.isGridLayout(state) ? grid : list;
            if (mountedLayout !== state.layout) {
                mountedLayout = state.layout;
                replaceChildren(stage, view.element);
            }

            timeControls.hidden = !sel.isGridLayout(state);
            if (guideSearch.value !== state.guideSearch) guideSearch.value = state.guideSearch;

            banner.render(state);
            view.render(state);
            manager.render(state);
            player.render(state);
            renderStatus(state);
        },

        player,

        destroy() {
            grid.destroy();
            list.destroy();
            unmount();
        }
    };

    function renderStatus(state) {
        if (sel.isLoading(state)) {
            replaceChildren(status, 'Loading channels…');
            return;
        }
        if (sel.loadError(state)) {
            replaceChildren(status, `Could not load channels: ${sel.loadError(state)}`);
            return;
        }
        if (!sel.hasChannels(state)) {
            replaceChildren(
                status,
                'No channels. Lower the minimum scene count in the plugin settings.'
            );
            return;
        }

        const errors = sel.sourceErrors(state);
        replaceChildren(
            status,
            errors.length > 0 ? `${errors.length} source(s) failed to load` : ''
        );
    }
}
