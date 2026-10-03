/**
 * Composition root.
 *
 * Builds the object graph and starts the clock. Everything interesting lives in
 * the layers below; this file only wires them together and owns the lifecycle.
 */

import './styles/index.css';
import './styles/sfwSwitch.css';
import './styles/demo.css';

import { createClient } from './api/client.js';
import { fetchSceneStreams } from './api/scenes.js';
import { loadPluginConfiguration, normalizeSettings } from './api/settings.js';
import { createPluginStorage } from './api/pluginStorage.js';
import { createPoolCache } from './api/cache.js';
import { parseLineup, DEFAULT_LINEUP } from './domain/lineup.js';
import {
    parsePrefs,
    parsePinOrder,
    migratePinOrder,
    migrateSort,
    DEFAULT_SORT
} from './domain/channelPrefs.js';
import { createStore } from './state/store.js';
import { createLazySceneDetails } from './state/lazySceneDetails.js';
import { createEffectRunner } from './state/effects.js';
import { createAnnouncer } from './ui/a11y.js';
import { createViewer } from './ui/viewer.js';
import { createOverlay, HASH } from './ui/overlay.js';
import { createNavbarButton } from './ui/navbarButton.js';
import { watchSfwSwitch } from './ui/sfwSwitch.js';
import { createSfwText } from './ui/sfwText.js';
import { withDemoPlayback } from './ui/demoContent.js';
import { createTouchGuard } from './ui/gestures.js';
import { watchLayout } from './ui/layoutWatcher.js';
import { createKeyboardHandler } from './ui/keyboard.js';
import { navigateToScene } from './ui/navigate.js';
import { Events, STORAGE_KEYS } from './state/actions.js';

/** The now-line and progress bars are only honest if they move every second. */
const TICK_MS = 1000;

function readLineup(storage, settings) {
    try {
        const stored = storage.getItem(STORAGE_KEYS.lineup);
        if (stored !== null) return parseLineup(stored);

        const lineup = [
            { source: 'special', minScenes: 0, ids: ['new-releases', 'recently-added', 'movies', 'shorts'] },
            { source: 'studio', minScenes: settings.guide_min_scenes }
        ];
        storage.setItem(STORAGE_KEYS.lineup, JSON.stringify(lineup));
        return lineup;
    } catch (e) {
        return DEFAULT_LINEUP;
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
function readPlayerMode(storage) {
    const stored = readStored(storage, STORAGE_KEYS.playerMode);
    return stored === 'theater' ? 'theater' : 'corner';
}

function readStored(storage, key, fallback = null) {
    try {
        const value = storage.getItem(key);
        return value === null ? fallback : value;
    } catch (e) {
        return fallback;
    }
}

export function start() {
    const gql = createClient();
    const cache = createPoolCache();
    const announcer = createAnnouncer();
    const viewer = withDemoPlayback(
        createViewer({ getStreams: (id) => fetchSceneStreams(gql, id) }),
        () => store.getState()
    );
    const touchGuard = createTouchGuard();
    let storage = null;

    const runEffect = createEffectRunner({
        gql,
        cache,
        viewer,
        player: { setMode: (mode) => overlayRef?.player.setMode(mode) },
        storage: {
            getItem: (...args) => storage?.getItem(...args),
            setItem: (...args) => storage?.setItem(...args)
        },
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
    const stopSfwSwitch = watchSfwSwitch({ root: overlay.element, video: viewer.element, store });
    const sfwText = createSfwText({ root: overlay.element, getState: store.getState });
    store.subscribe((state) => {
        overlay.render(state);
        sfwText.refresh();
    });
    const stopLazySceneDetails = createLazySceneDetails({ store, gql });

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
    let wasHidden = document.visibilityState === 'hidden';
    const onVisibility = (event) => {
        if (document.visibilityState !== 'visible') {
            wasHidden = true;
            return;
        }
        if (!wasHidden && !event?.persisted) return;
        wasHidden = false;
        store.dispatch({ type: Events.TICK, nowMs: Date.now() });
        store.dispatch({ type: Events.RESUME_AFTER_HIDDEN });
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onVisibility);

    const ticker = setInterval(() => {
        if (store.getState().open) store.dispatch({ type: Events.TICK, nowMs: Date.now() });
    }, TICK_MS);

    loadPluginConfiguration(gql).then((configuration) => {
        const settings = normalizeSettings(configuration);
        storage = createPluginStorage({ gql, initialConfiguration: configuration });
        store.dispatch({ type: Events.SETTINGS_LOADED, settings });

        if (settings.guide_navbar_button) navbar.start();

        const prefs = parsePrefs(readStored(storage, STORAGE_KEYS.prefs));

        // Pins used to be a timestamp on each pref, which could not express a
        // manual order. Recover them into the ordered array on first run.
        const storedPins = readStored(storage, STORAGE_KEYS.pinOrder);
        const pinOrder = storedPins ? parsePinOrder(storedPins) : migratePinOrder(prefs);

        store.dispatch({
            type: Events.PREFS_LOADED,
            prefs,
            pinOrder,
            sort: migrateSort(readStored(storage, STORAGE_KEYS.sort, DEFAULT_SORT)),
            lineup: readLineup(storage, settings),
            collapsedGroups: parseJsonArray(readStored(storage, STORAGE_KEYS.collapsed)),
            playerWidthPx: Number(readStored(storage, STORAGE_KEYS.playerWidth)) || undefined,
            channelInfoMinimized: readStored(storage, STORAGE_KEYS.channelInfoMinimized) === 'true',
            playerMode: readPlayerMode(storage)
            ,recentChannelIds: parseJsonArray(readStored(storage, STORAGE_KEYS.recentChannels))
        });

        store.dispatch({
            type: Events.RESTORE,
            tunedChannelId: readStored(storage, STORAGE_KEYS.tunedChannel),
            muted: readStored(storage, STORAGE_KEYS.muted, String(settings.guide_start_muted)) !== 'false'
        });

        // Deep link: arriving with #tvguide already set opens the guide.
        if (window.location.hash === HASH) overlay.open();
    });

    return function stop() {
        stopSfwSwitch();
        sfwText.destroy();
        stopLazySceneDetails();
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
