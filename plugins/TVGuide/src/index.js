/**
 * Composition root.
 *
 * Builds the object graph and starts the clock. Everything interesting lives in
 * the layers below; this file only wires them together and owns the lifecycle.
 */

import './styles/index.css';

import { createClient } from './api/client.js';
import { loadSettings } from './api/settings.js';
import { createPoolCache } from './api/cache.js';
import { parseLineup, serializeLineup, DEFAULT_LINEUP } from './domain/lineup.js';
import {
    parsePrefs,
    parsePinOrder,
    migratePinOrder,
    migrateSort,
    DEFAULT_SORT
} from './domain/channelPrefs.js';
import { createStore } from './state/store.js';
import { createEffectRunner } from './state/effects.js';
import { createAnnouncer } from './ui/a11y.js';
import { createViewer } from './ui/viewer.js';
import { createOverlay, HASH } from './ui/overlay.js';
import { createNavbarButton } from './ui/navbarButton.js';
import { createTouchGuard } from './ui/gestures.js';
import { watchLayout } from './ui/layoutWatcher.js';
import { createKeyboardHandler } from './ui/keyboard.js';
import { navigateToScene } from './ui/navigate.js';
import { Events, STORAGE_KEYS } from './state/actions.js';

/** The now-line and progress bars are only honest if they move every second. */
const TICK_MS = 1000;

function readLineup() {
    try {
        return parseLineup(window.localStorage.getItem(STORAGE_KEYS.lineup));
    } catch (e) {
        return DEFAULT_LINEUP;
    }
}

function seedLineup(settings) {
    // Phase 1 has no channel manager, so the lineup is seeded from the settings
    // the first time and then owned by localStorage -- which is exactly the
    // structure the Phase 2 manager will write.
    try {
        if (window.localStorage.getItem(STORAGE_KEYS.lineup)) return;
        window.localStorage.setItem(
            STORAGE_KEYS.lineup,
            serializeLineup([{ source: 'studio', minScenes: settings.guide_min_scenes }])
        );
    } catch (e) {
        /* storage unavailable; readLineup falls back to the default */
    }
}

function parseJsonArray(json) {
    try {
        const parsed = JSON.parse(json);
        return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : undefined;
    } catch (e) {
        return undefined;
    }
}

/**
 * Fullscreen is never restored.
 *
 * Nothing re-enters the Fullscreen API on load -- it needs a user gesture -- so
 * remembering 'fullscreen' would leave the state claiming a mode the browser is
 * not in, after which the button toggles the wrong way on its first press.
 */
function readPlayerMode() {
    const stored = readStored(STORAGE_KEYS.playerMode);
    return stored === 'theater' ? 'theater' : 'corner';
}

function readStored(key, fallback = null) {
    try {
        const value = window.localStorage.getItem(key);
        return value === null ? fallback : value;
    } catch (e) {
        return fallback;
    }
}

export function start() {
    const gql = createClient();
    const cache = createPoolCache();
    const announcer = createAnnouncer();
    const viewer = createViewer();
    const touchGuard = createTouchGuard();

    const runEffect = createEffectRunner({
        gql,
        cache,
        viewer,
        player: { setMode: (mode) => overlayRef?.player.setMode(mode) },
        storage: window.localStorage,
        announce: (message) => announcer.announce(message),
        navigate: navigateToScene,
        getLineup: () => store.getState().lineup
    });

    // `player` is created by the overlay, so the runner reaches it lazily.
    let overlayRef = null;
    const store = createStore({ runEffect });

    const overlay = createOverlay({
        store,
        viewer,
        announcer,
        touchGuard,
        onRowVisible: (channelId) => store.dispatch({ type: Events.POOL_REQUESTED, channelId })
    });

    overlayRef = overlay;
    store.subscribe((state) => overlay.render(state));

    const navbar = createNavbarButton({ onActivate: () => overlay.open() });

    const stopLayoutWatch = watchLayout({
        store,
        matchMediaFn: window.matchMedia ? (query) => window.matchMedia(query) : null
    });

    const onKeydown = createKeyboardHandler({
        store,
        onClose: () => overlay.close(),
        onHelp: () => overlay.toggleHelp()
    });
    document.addEventListener('keydown', onKeydown, true);

    // Back/forward: the hash is the guide's whole routing story.
    const onPopState = () => {
        if (window.location.hash === HASH) overlay.open();
        else store.dispatch({ type: Events.CLOSE });
    };
    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', onPopState);

    // Coming back from another app leaves the element paused on iOS with no
    // event drift correction can act on -- it deliberately ignores a paused
    // element, so playback has to be re-established explicitly.
    const onVisibility = () => {
        if (document.visibilityState !== 'visible') return;
        store.dispatch({ type: Events.TICK, nowMs: Date.now() });
        store.dispatch({ type: Events.RESUME_AFTER_HIDDEN });
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onVisibility);

    const ticker = setInterval(() => {
        if (store.getState().open) store.dispatch({ type: Events.TICK, nowMs: Date.now() });
    }, TICK_MS);

    loadSettings(gql).then((settings) => {
        store.dispatch({ type: Events.SETTINGS_LOADED, settings });
        seedLineup(settings);

        if (settings.guide_navbar_button) navbar.start();

        const prefs = parsePrefs(readStored(STORAGE_KEYS.prefs));

        // Pins used to be a timestamp on each pref, which could not express a
        // manual order. Recover them into the ordered array on first run.
        const storedPins = readStored(STORAGE_KEYS.pinOrder);
        const pinOrder = storedPins ? parsePinOrder(storedPins) : migratePinOrder(prefs);
        if (!storedPins && pinOrder.length > 0) {
            try {
                window.localStorage.setItem(STORAGE_KEYS.pinOrder, JSON.stringify(pinOrder));
            } catch (e) {
                /* storage unavailable; the migration simply repeats next time */
            }
        }

        store.dispatch({
            type: Events.PREFS_LOADED,
            prefs,
            pinOrder,
            sort: migrateSort(readStored(STORAGE_KEYS.sort, DEFAULT_SORT)),
            lineup: readLineup(),
            collapsedGroups: parseJsonArray(readStored(STORAGE_KEYS.collapsed)),
            headWidthPx: Number(readStored(STORAGE_KEYS.headWidth)) || undefined,
            playerWidthPx: Number(readStored(STORAGE_KEYS.playerWidth)) || undefined,
            playerMode: readPlayerMode()
        });

        store.dispatch({
            type: Events.RESTORE,
            tunedChannelId: readStored(STORAGE_KEYS.tunedChannel),
            muted: readStored(STORAGE_KEYS.muted, String(settings.guide_start_muted)) !== 'false'
        });

        // Deep link: arriving with #tvguide already set opens the guide.
        if (window.location.hash === HASH) overlay.open();
    });

    return function stop() {
        clearInterval(ticker);
        stopLayoutWatch();
        document.removeEventListener('keydown', onKeydown, true);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pageshow', onVisibility);
        window.removeEventListener('popstate', onPopState);
        window.removeEventListener('hashchange', onPopState);
        navbar.stop();
        overlay.destroy();
        viewer.stop();
        store.destroy();
    };
}

// Stash injects this into an already-running page, so there is no load event
// left to wait for in most cases.
if (typeof window !== 'undefined' && !window.__tvguideStarted) {
    window.__tvguideStarted = true;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
}
