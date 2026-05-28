(function () {
    'use strict';

    // --- SESSION STORE (state-machine architecture) ---
    // New modules are loaded in CJS/test environments.
    // In the browser IIFE, they are not yet bundled — the store runs
    // as a parallel state tracker alongside the existing imperative code.
    let _sessionStore = null;
    let _SessionState = null;
    let _SessionEvents = null;
    let _SessionEffects = null;
    let _SessionSelectors = null;
    let _SessionRenderer = null;

    if (typeof require === 'function') {
        try {
            _SessionState = require('./src/gallerySessionState');
            _SessionEvents = require('./src/gallerySessionEvents');
            _SessionEffects = require('./src/gallerySessionEffects');
            _SessionSelectors = require('./src/gallerySessionSelectors');
            _SessionRenderer = require('./src/gallerySessionRenderer');
            const { createStore } = require('./src/gallerySessionStore');
            _sessionStore = createStore({ runEffect: null, ctx: null });
        } catch (_) {
            // Modules not available — store features disabled.
        }
    }

    /**
     * Dispatch an event to the session store (no-op if store unavailable).
     * This keeps the store's state in sync with the imperative globals
     * without changing any existing behavior.
     */
    function _dispatchStoreEvent(event) {
        if (_sessionStore && event) {
            try { _sessionStore.dispatch(event); } catch (_) { /* swallow */ }
        }
    }

    /**
     * Sync the session store's environment/session substates from current globals.
     * Called after settings loads and state changes that affect the store.
     */
    function _syncStoreFromGlobals() {
        if (!_sessionStore || !_SessionEvents) return;
        _dispatchStoreEvent(_SessionEvents.settingsLoaded(pluginSettings));
        if (currentSceneData) {
            _dispatchStoreEvent(_SessionEvents.sceneDataLoaded(currentSceneData));
        }
    }

    // --- CONFIGURATION ---
    const STORAGE_KEY = 'stash_plugin_gallery_settings';
    const GALLERY_STATE_STORAGE_KEY = 'gallery_mode_state';
    const VALID_DEFAULT_MODES = ['remember', 'always_on', 'always_off'];
    const PLUGIN_ID = 'GalleryMode';
    const DEFAULT_PREVIEW_WIDTH = 300;
    const SEEK_TIMEOUT_MS = 25000;
    const GALLERY_TIME_EPSILON = 0.05;
    const SPRITE_INDEX_EPSILON = 0.05;
    const GALLERY_SYNC_INTERVAL_MS = 200;
    const EXTERNAL_SCRUBBER_SYNC_DELAY_MS = 60;
    const DEFAULT_GALLERY_PREFETCH_STEP_SECONDS = 5;
    const DEFAULT_GALLERY_PREFETCH_OFFSETS_SECONDS = '5';
    const DEFAULT_GALLERY_PREFETCH_WINDOW_SECONDS = 30;
    const MIN_GALLERY_CACHE_ENTRIES = 24;
    const GALLERY_PREFETCH_BATCH_SIZE = 8;
    const GALLERY_PREFETCH_BATCH_TIMEOUT_MIN_MS = 60000;
    const GALLERY_PREFETCH_BATCH_TIMEOUT_PER_FRAME_MS = 1500;
    const GALLERY_DEBUG_QUEUE_PREVIEW_LIMIT = 18;
    const GALLERY_DEBUG_CACHE_PREVIEW_LIMIT = 12;
    const GALLERY_LAYOUT_REFRESH_LATE_MS = 500;
    const GALLERY_MIN_ZOOM_SCALE = 1;
    const GALLERY_MAX_ZOOM_SCALE = 4;
    const GALLERY_PAN_GESTURE_THRESHOLD_PX = 6;
    const GALLERY_PINCH_SCALE_THRESHOLD = 0.02;
    const GALLERY_TAP_SUPPRESSION_MS = 400;
    const GALLERY_JUMP_BUTTONS = [
        { id: 'sprite-gallery-back-30', label: '<30s', delta: -30 },
        { id: 'sprite-gallery-back-5', label: '<5s', delta: -5 },
        { id: 'sprite-gallery-back-1', label: '<1s', delta: -1 },
        { id: 'sprite-gallery-back-0_5', label: '<0.5s', delta: -0.5 },
        { id: 'sprite-gallery-forward-0_5', label: '0.5s>', delta: 0.5 },
        { id: 'sprite-gallery-forward-1', label: '1s>', delta: 1 },
        { id: 'sprite-gallery-forward-5', label: '5s>', delta: 5 },
        { id: 'sprite-gallery-forward-30', label: '30s', delta: 30 }
    ];
    const GALLERY_FORWARD_CONTROL_PREFETCH_OFFSETS = [0.5, 1, 5, 30];
    const GALLERY_BACKWARD_CONTROL_PREFETCH_OFFSETS = [0.5, 1, 5, 30];
    const GALLERY_HB_SEEK_TIMEOUT_MS = 8000;
    const GALLERY_HB_NATIVE_SCALE = 'native';

    // Plugin settings cache
    let pluginSettings = {
        lb_prefetch_enabled: true,
        lb_prefetch_offsets_seconds: DEFAULT_GALLERY_PREFETCH_OFFSETS_SECONDS,
        lb_prefetch_window_seconds: DEFAULT_GALLERY_PREFETCH_WINDOW_SECONDS,
        lb_frame_server_port: 9876,
        lb_frame_server_host: '',
        lb_enabled: false,
        general_show_debug_panel: false
    };

    // Store scene data for duration lookups
    let currentSceneData = null;

    // Scene ID of the currently initialised gallery session
    let galleryInitialized = false;
    let spritetabListenerBound = false;
    let galleryUnloadListenersBound = false;
    let galleryActivitySaveTimeoutId = null;
    let galleryActivitySavePendingTime = null;

    // Gallery overlay element (shared, reused across sprite clicks)
    let galleryOverlay = null;
    let galleryRequestSeq = 0;
    let galleryActiveRequestId = 0;
    let galleryActiveSocket = null;
    let gallerySocketReadyPromise = null;
    let gallerySocketRequestSeq = 0;
    let gallerySocketRequests = new Map();
    let galleryLastRequestedTime = null;
    let galleryIgnoredPlayerTime = null;
    let galleryPendingExplicitTargetTime = null;
    let galleryPendingExplicitSourceTime = null;
    let galleryControlledSeekTargetTime = null;
    let galleryBoundTargets = [];
    let galleryControlsVisible = false;
    let galleryLastImageSrc = '';
    let galleryLastImageScale = null;
    let galleryHasVisibleFrame = false;
    let galleryFullResolutionPending = false;
    let galleryFullscreenEventsBound = false;
    let galleryPseudoFullscreen = false;
    let gallerySyncIntervalId = null;
    let galleryLastObservedPlayerTime = null;
    let galleryFrameCache = new Map();
    let galleryPrefetchQueue = [];
    let galleryPrefetchGeneration = 0;
    let galleryPrefetchRunning = false;
    let galleryPrefetchCenterTime = null;
    let galleryPrefetchContextKey = null;
    let externalScrubberBound = false;
    let externalScrubberSyncTimeoutId = null;
    let galleryLayoutRefreshTimeoutId = null;
    let galleryLayoutRefreshDelayedTimeoutId = null;
    let galleryLayoutRefreshLateTimeoutId = null;
    let nativeScrubberPreviewTrack = null;
    let nativeScrubberPreviewTouchId = null;
    let nativeScrubberPreviewClearTimeoutId = null;
    let galleryImageZoomScale = GALLERY_MIN_ZOOM_SCALE;
    let galleryImagePanX = 0;
    let galleryImagePanY = 0;
    let galleryActiveGesture = null;
    let galleryGestureTouchId = null;
    let galleryGestureStartX = 0;
    let galleryGestureStartY = 0;
    let galleryGestureStartPanX = 0;
    let galleryGestureStartPanY = 0;
    let galleryGestureStartScale = GALLERY_MIN_ZOOM_SCALE;
    let galleryGestureStartDistance = 0;
    let galleryGestureAnchorContentX = 0;
    let galleryGestureAnchorContentY = 0;
    let gallerySuppressTapUntil = 0;

    // Scene ID of the currently viewed scene (set in init, cleared on navigation)
    let currentSceneId = null;

    // Single in-memory source of truth for whether the gallery overlay is open.
    // Reset on every page load — gallery mode never persists across navigation.
    let galleryActive = false;

    // Authoritative copy of the Default Mode plugin setting (overwritten by
    // loadPluginSettings). Governs whether the overlay auto-opens on scene
    // load and whether user toggles persist to localStorage.
    let defaultMode = 'remember';

    // --- HELPERS ---
    function getSettings() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
        } catch (e) { return {}; }
    }

    function saveSettings(newSettings) {
        const merged = { ...getSettings(), ...newSettings };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        return merged;
    }

    function getDefaultMode(pluginConfig) {
        const mode = pluginConfig?.general_default_mode;
        return VALID_DEFAULT_MODES.includes(mode) ? mode : 'remember';
    }

    function getSavedGalleryState() {
        try {
            return localStorage.getItem(GALLERY_STATE_STORAGE_KEY) === 'true';
        } catch (e) {
            return false;
        }
    }

    function setSavedGalleryState(enabled) {
        try {
            localStorage.setItem(GALLERY_STATE_STORAGE_KEY, enabled ? 'true' : 'false');
        } catch (e) {
            // Storage unavailable
        }
    }

    function persistGalleryStateIfRemember() {
        if (defaultMode === 'remember') {
            setSavedGalleryState(galleryActive);
        }
    }

    function formatTime(seconds) {
        if (!seconds) return "0:00";
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return h > 0
            ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
            : `${m}:${s.toString().padStart(2, '0')}`;
    }

    // Returns the DOM <video> element — needed for canvas drawImage, videoWidth/
    // Height, and requestVideoFrameCallback. Do NOT use this for reading or
    // setting playback time; under transcoding <video>.currentTime diverges
    // from the user-facing timeline. Use getPlaybackController() instead, which
    // routes time through the videojs Player when available.
    function getMediaEl() {
        return document.querySelector('video.vjs-tech') || document.querySelector('video');
    }

    function getGalleryMediaMode() {
        return isLowBandwidthMode() ? 'image' : 'video';
    }

    function getGalleryImageElement() {
        return galleryOverlay?.querySelector('#sprite-gallery-img') || null;
    }

    function getGalleryVideoElement() {
        return getMediaEl();
    }

    function getActiveGalleryMediaElement() {
        return getGalleryMediaMode() === 'video'
            ? getGalleryVideoElement()
            : getGalleryImageElement();
    }

    function hasGalleryRenderableFrame() {
        return galleryHasVisibleFrame;
    }

    function getSpritePreviewMountNode() {
        const fullscreenElement = getGalleryFullscreenElement();
        if (fullscreenElement) {
            if (galleryOverlay?.contains(fullscreenElement)) {
                return fullscreenElement;
            }
            // Fullscreen element is an ancestor of the overlay (e.g., video container)
            if (fullscreenElement.contains(galleryOverlay)) {
                return galleryOverlay;
            }
        }
        if (galleryOverlay && (galleryPseudoFullscreen || galleryOverlay.classList.contains('gallery-overlay-fullscreen'))) {
            return galleryOverlay;
        }
        return document.body;
    }

    function getSpritePreviewBox() {
        let previewBox = document.getElementById('stash-sprite-preview');
        if (!previewBox) {
            previewBox = document.createElement('div');
            previewBox.id = 'stash-sprite-preview';
            const timeDisplay = document.createElement('div');
            timeDisplay.className = 'preview-time';
            previewBox.appendChild(timeDisplay);
        }
        const mountNode = getSpritePreviewMountNode();
        if (previewBox.parentElement !== mountNode) {
            mountNode.appendChild(previewBox);
        }
        return previewBox;
    }

    function hideSpritePreview() {
        const previewBox = document.getElementById('stash-sprite-preview');
        if (previewBox) {
            previewBox.style.display = 'none';
        }
    }

    function getSpritePreviewDimensions() {
        const maxWidth = Math.max(180, (window.innerWidth || DEFAULT_PREVIEW_WIDTH) - 24);
        const width = Math.min(DEFAULT_PREVIEW_WIDTH, maxWidth);
        return {
            width,
            height: width * (9 / 16)
        };
    }

    function getSpritePreviewDataForTime(time) {
        if (!currentSceneData?.paths?.sprite) return null;

        const cells = Array.from(document.querySelectorAll('#stash-sprite-grid .sprite-cell'));
        const duration = currentSceneData?.duration || getGalleryDuration();
        if (cells.length === 0 || !(duration > 0)) return null;

        const alignedTime = getGallerySpriteAlignedTime(time, cells, duration);
        const spriteIndex = getSpriteIndexAtTime(alignedTime, duration, cells.length);
        const cell = cells[spriteIndex];
        if (!cell) return null;

        return {
            backgroundImage: cell.style.backgroundImage || `url('${currentSceneData.paths.sprite}')`,
            backgroundSize: cell.style.backgroundSize || '',
            backgroundPosition: cell.style.backgroundPosition || '0% 0%',
            timeText: formatTime(alignedTime)
        };
    }

    function showSpritePreview(previewData, { left, top } = {}) {
        if (!previewData) {
            hideSpritePreview();
            return;
        }

        const previewBox = getSpritePreviewBox();
        const previewTimeDisplay = previewBox.querySelector('.preview-time');

        previewBox.style.backgroundImage = previewData.backgroundImage;
        previewBox.style.backgroundSize = previewData.backgroundSize;
        previewBox.style.backgroundPosition = previewData.backgroundPosition;
        previewTimeDisplay.innerText = previewData.timeText;
        previewBox.style.left = `${left}px`;
        previewBox.style.top = `${top}px`;
        previewBox.style.display = 'block';
    }

    function isMobileLayout() {
        return window.matchMedia('(max-width: 767px)').matches;
    }

    function isTouchCapableDevice() {
        const hasTouchPoints = Number.isFinite(navigator.maxTouchPoints) && navigator.maxTouchPoints > 0;
        const coarsePointer = typeof window.matchMedia === 'function'
            && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
        return hasTouchPoints || coarsePointer;
    }

    function isPhoneSizedTouchLayout() {
        if (isMobileLayout()) return true;
        if (!isTouchCapableDevice()) return false;

        const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || 0;
        const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0;
        const shortestViewportEdge = Math.min(viewportWidth, viewportHeight);
        return shortestViewportEdge > 0 && shortestViewportEdge <= 500;
    }

    function isGalleryModeOn() {
        return galleryActive;
    }

    function normalizeGalleryTime(time) {
        return Number.isFinite(time) ? Math.max(0, time) : 0;
    }

    function hasPendingExplicitGalleryTarget() {
        return galleryPendingExplicitTargetTime !== null;
    }

    function shouldHoldPendingExplicitGalleryTarget(time) {
        if (!hasPendingExplicitGalleryTarget()) return false;

        const observedTime = normalizeGalleryTime(time);
        if (isSameGalleryTime(observedTime, galleryPendingExplicitTargetTime)) return false;
        if (galleryPendingExplicitSourceTime === null) return true;

        const minTime = Math.min(galleryPendingExplicitSourceTime, galleryPendingExplicitTargetTime) - GALLERY_TIME_EPSILON;
        const maxTime = Math.max(galleryPendingExplicitSourceTime, galleryPendingExplicitTargetTime) + GALLERY_TIME_EPSILON;
        return observedTime >= minTime && observedTime <= maxTime;
    }

    function clearPendingExplicitGalleryTarget(time = null) {
        if (galleryPendingExplicitTargetTime === null) return;
        if (time !== null && !isSameGalleryTime(normalizeGalleryTime(time), galleryPendingExplicitTargetTime)) return;
        galleryPendingExplicitTargetTime = null;
        galleryPendingExplicitSourceTime = null;
    }

    function getGalleryDuration() {
        const sceneDuration = currentSceneData?.duration;
        if (Number.isFinite(sceneDuration) && sceneDuration > 0) {
            return sceneDuration;
        }

        const controller = getPlaybackController();
        const playerDuration = controller?.mediaEl?.duration;
        return Number.isFinite(playerDuration) && playerDuration > 0 ? playerDuration : 0;
    }

    function clampGalleryTime(time) {
        const nextTime = normalizeGalleryTime(time);
        const duration = getGalleryDuration();
        return duration > 0 ? Math.min(nextTime, duration) : nextTime;
    }

    function getGalleryResolutionScale() {
        const scale = parseFloat(getSettings().gallery_resolution ?? 1);
        return Number.isFinite(scale) && scale > 0 ? scale : 1;
    }

    function parseGalleryPrefetchOffsets(value) {
        const raw = Array.isArray(value)
            ? value
            : String(value ?? '').split(/[,\s]+/);
        const offsets = raw
            .map((entry) => parseFloat(entry))
            .filter((entry) => Number.isFinite(entry) && entry > 0)
            .map((entry) => Math.round(entry * 1000) / 1000);
        const uniqueOffsets = Array.from(new Set(offsets)).sort((a, b) => a - b);
        return uniqueOffsets.length > 0 ? uniqueOffsets : [DEFAULT_GALLERY_PREFETCH_STEP_SECONDS];
    }

    function getGalleryPrefetchOffsetsSeconds() {
        return parseGalleryPrefetchOffsets(pluginSettings.lb_prefetch_offsets_seconds);
    }

    function getGalleryPrefetchWindowSeconds() {
        const windowSeconds = parseFloat(pluginSettings.lb_prefetch_window_seconds ?? DEFAULT_GALLERY_PREFETCH_WINDOW_SECONDS);
        return Number.isFinite(windowSeconds) && windowSeconds > 0 ? windowSeconds : DEFAULT_GALLERY_PREFETCH_WINDOW_SECONDS;
    }

    function isGalleryPrefetchEnabled() {
        return pluginSettings.lb_prefetch_enabled !== false;
    }

    function isLowBandwidthMode() {
        return pluginSettings.lb_enabled === true;
    }

    function isGalleryDebugPanelEnabled() {
        return pluginSettings.general_show_debug_panel === true;
    }

    function shouldShowGalleryScrubber() {
        return isPhoneSizedTouchLayout() || isGalleryFullscreenActive();
    }

    function shouldShowGalleryScrubberPreview() {
        return isGalleryModeOn() && shouldShowGalleryScrubber();
    }

    function getEffectiveGalleryScale() {
        return isLowBandwidthMode() ? getGalleryResolutionScale() : GALLERY_HB_NATIVE_SCALE;
    }

    function getGalleryCacheEntryLimit() {
        const offsets = Array.from(new Set([
            ...getGalleryPrefetchOffsetsSeconds(),
            ...GALLERY_FORWARD_CONTROL_PREFETCH_OFFSETS,
            ...GALLERY_BACKWARD_CONTROL_PREFETCH_OFFSETS
        ]));
        const windowSeconds = getGalleryPrefetchWindowSeconds();
        const windowEntries = offsets.reduce((total, offset) => {
            return total + (Math.floor(windowSeconds / offset) * 2);
        }, 0);
        return Math.max(MIN_GALLERY_CACHE_ENTRIES, windowEntries * 3);
    }

    function normalizeGalleryCacheTime(time) {
        return Math.round(normalizeGalleryTime(time) * 1000) / 1000;
    }

    function getGalleryCacheKey(time, sceneId = currentSceneId, scale = getGalleryResolutionScale()) {
        if (!sceneId) return null;
        return `${sceneId}::${scale}::${normalizeGalleryCacheTime(time).toFixed(3)}`;
    }

    function getGalleryCachedFrame(time, sceneId = currentSceneId, scale = getGalleryResolutionScale()) {
        const key = getGalleryCacheKey(time, sceneId, scale);
        if (!key || !galleryFrameCache.has(key)) return null;
        const cached = galleryFrameCache.get(key);
        galleryFrameCache.delete(key);
        galleryFrameCache.set(key, cached);
        return cached;
    }

    function hasGalleryCachedFrame(time, sceneId = currentSceneId, scale = getGalleryResolutionScale()) {
        return Boolean(getGalleryCacheKey(time, sceneId, scale) && galleryFrameCache.has(getGalleryCacheKey(time, sceneId, scale)));
    }

    function getGalleryPrefetchPriorityIndex(delta, offsets) {
        const absDelta = Math.abs(delta);
        const matchIndex = offsets.findIndex((offset) => isSameGalleryTime(offset, absDelta));
        return matchIndex >= 0 ? matchIndex : offsets.length;
    }

    function trimGalleryFrameCache() {
        while (galleryFrameCache.size > getGalleryCacheEntryLimit()) {
            const oldestKey = galleryFrameCache.keys().next().value;
            galleryFrameCache.delete(oldestKey);
        }
    }

    function storeGalleryCachedFrame(time, src, sceneId = currentSceneId, scale = getGalleryResolutionScale()) {
        const key = getGalleryCacheKey(time, sceneId, scale);
        if (!key || !src) return;
        if (galleryFrameCache.has(key)) {
            galleryFrameCache.delete(key);
        }
        galleryFrameCache.set(key, src);
        trimGalleryFrameCache();
    }

    function clearGalleryFrameCache(sceneId = null) {
        if (!sceneId) {
            galleryFrameCache.clear();
        } else {
            Array.from(galleryFrameCache.keys())
                .filter((key) => key.startsWith(`${sceneId}::`))
                .forEach((key) => galleryFrameCache.delete(key));
        }
        updateGalleryJumpButtons();
    }

    function getSpriteInterval(duration, totalSpritesCount) {
        return totalSpritesCount > 0 && duration > 0 ? duration / totalSpritesCount : 0;
    }

    function getSpriteSelectionTime(index, totalSpritesCount, duration) {
        const interval = getSpriteInterval(duration, totalSpritesCount);
        if (!(interval > 0)) return 0;

        return Math.max(0, Math.min(duration, interval * index));
    }

    function getSpriteIndexAtTime(time, duration, totalSpritesCount) {
        const interval = getSpriteInterval(duration, totalSpritesCount);
        if (!(interval > 0)) return 0;

        return Math.max(
            0,
            Math.min(totalSpritesCount - 1, Math.floor((normalizeGalleryTime(time) + SPRITE_INDEX_EPSILON) / interval))
        );
    }

    function getGallerySpriteAlignedTime(time, cells = Array.from(document.querySelectorAll('#stash-sprite-grid .sprite-cell')), duration = currentSceneData?.duration || getGalleryDuration()) {
        if (cells.length === 0 || !(duration > 0)) return clampGalleryTime(time);
        const spriteIndex = getSpriteIndexAtTime(time, duration, cells.length);
        return getSpriteSelectionTime(spriteIndex, cells.length, duration);
    }

    function getGallerySpriteIntervalSeconds(cells = Array.from(document.querySelectorAll('#stash-sprite-grid .sprite-cell')), duration = currentSceneData?.duration || getGalleryDuration()) {
        return getSpriteInterval(duration, cells.length);
    }

    function isSameGalleryTime(a, b) {
        return a !== null && b !== null && Math.abs(a - b) <= GALLERY_TIME_EPSILON;
    }

    function getVideoContainer() {
        const video = getMediaEl();
        return video ? (video.closest('.video-js') || video.parentElement) : null;
    }

    function getGalleryPlayerControlsInset() {
        const videoContainer = galleryOverlay?.parentElement || getVideoContainer();
        if (!videoContainer) return 0;

        const containerRect = videoContainer.getBoundingClientRect?.();
        if (!containerRect || containerRect.height <= 0) return 0;

        const controlRects = [
            videoContainer.querySelector('.vjs-progress-control'),
            videoContainer.querySelector('.vjs-control-bar')
        ].filter(Boolean)
            .map((element) => element.getBoundingClientRect?.())
            .filter((rect) => rect && rect.height > 0);

        if (controlRects.length === 0) return 0;

        const topMostControl = Math.min(...controlRects.map((rect) => rect.top));
        return Math.max(0, Math.ceil(containerRect.bottom - topMostControl));
    }

    function getGalleryControlsOffset() {
        const fullInset = getGalleryPlayerControlsInset();
        return Math.max(0, fullInset - 36);
    }

    function cancelNativeScrubberPreviewClear() {
        if (nativeScrubberPreviewClearTimeoutId === null) return;
        clearTimeout(nativeScrubberPreviewClearTimeoutId);
        nativeScrubberPreviewClearTimeoutId = null;
    }

    function scheduleNativeScrubberPreviewClear(delayMs = 120) {
        cancelNativeScrubberPreviewClear();
        nativeScrubberPreviewClearTimeoutId = setTimeout(() => {
            nativeScrubberPreviewClearTimeoutId = null;
            clearNativeScrubberPreviewState();
        }, delayMs);
    }

    function clearNativeScrubberPreviewState() {
        cancelNativeScrubberPreviewClear();
        nativeScrubberPreviewTrack = null;
        nativeScrubberPreviewTouchId = null;
        hideSpritePreview();
    }

    function getTrackedTouch(touches, identifier) {
        if (!touches?.length) return null;
        if (identifier === null || identifier === undefined) return touches[0] || null;
        return Array.from(touches).find((touch) => touch.identifier === identifier) || null;
    }

    function clampGalleryZoomScale(scale) {
        if (!Number.isFinite(scale)) return GALLERY_MIN_ZOOM_SCALE;
        return Math.max(GALLERY_MIN_ZOOM_SCALE, Math.min(GALLERY_MAX_ZOOM_SCALE, scale));
    }

    function getGalleryGestureMetrics() {
        if (!galleryOverlay) return null;

        const frame = galleryOverlay.querySelector('#sprite-gallery-frame');
        const viewport = galleryOverlay.querySelector('#sprite-gallery-viewport');
        const media = getActiveGalleryMediaElement();
        if (!frame || !viewport || !media) return null;

        const frameRect = frame.getBoundingClientRect?.();
        const mediaRect = media.getBoundingClientRect?.();
        if (!frameRect || !(frameRect.width > 0) || !(frameRect.height > 0)) return null;

        const baseWidth = media.clientWidth
            || (mediaRect?.width > 0 ? mediaRect.width / Math.max(galleryImageZoomScale, GALLERY_MIN_ZOOM_SCALE) : 0)
            || frameRect.width;
        const baseHeight = media.clientHeight
            || (mediaRect?.height > 0 ? mediaRect.height / Math.max(galleryImageZoomScale, GALLERY_MIN_ZOOM_SCALE) : 0)
            || frameRect.height;

        return {
            frame,
            viewport,
            media,
            frameRect,
            baseWidth,
            baseHeight
        };
    }

    function clampGalleryPan(panX, panY, scale = galleryImageZoomScale) {
        const metrics = getGalleryGestureMetrics();
        if (!metrics) {
            return { x: 0, y: 0 };
        }

        const nextScale = clampGalleryZoomScale(scale);
        const maxPanX = Math.max(0, ((metrics.baseWidth * nextScale) - metrics.frameRect.width) / 2);
        const maxPanY = Math.max(0, ((metrics.baseHeight * nextScale) - metrics.frameRect.height) / 2);

        return {
            x: Math.max(-maxPanX, Math.min(maxPanX, Number.isFinite(panX) ? panX : 0)),
            y: Math.max(-maxPanY, Math.min(maxPanY, Number.isFinite(panY) ? panY : 0))
        };
    }

    function applyGalleryImageTransform() {
        const metrics = getGalleryGestureMetrics();
        if (!metrics) return;

        const nextScale = clampGalleryZoomScale(galleryImageZoomScale);
        const nextPan = nextScale <= GALLERY_MIN_ZOOM_SCALE
            ? { x: 0, y: 0 }
            : clampGalleryPan(galleryImagePanX, galleryImagePanY, nextScale);

        galleryImageZoomScale = nextScale;
        galleryImagePanX = nextPan.x;
        galleryImagePanY = nextPan.y;

        metrics.media.style.transform = nextScale <= GALLERY_MIN_ZOOM_SCALE
            ? ''
            : `translate(${galleryImagePanX}px, ${galleryImagePanY}px) scale(${galleryImageZoomScale})`;
        metrics.media.dataset.zoomScale = galleryImageZoomScale.toFixed(3);
        metrics.media.dataset.panX = galleryImagePanX.toFixed(1);
        metrics.media.dataset.panY = galleryImagePanY.toFixed(1);
        metrics.viewport.dataset.zoomed = galleryImageZoomScale > GALLERY_MIN_ZOOM_SCALE ? 'true' : 'false';
    }

    function resetGalleryImageTransform() {
        galleryImageZoomScale = GALLERY_MIN_ZOOM_SCALE;
        galleryImagePanX = 0;
        galleryImagePanY = 0;
        galleryActiveGesture = null;
        galleryGestureTouchId = null;
        galleryGestureStartX = 0;
        galleryGestureStartY = 0;
        galleryGestureStartPanX = 0;
        galleryGestureStartPanY = 0;
        galleryGestureStartScale = GALLERY_MIN_ZOOM_SCALE;
        galleryGestureStartDistance = 0;
        galleryGestureAnchorContentX = 0;
        galleryGestureAnchorContentY = 0;
        gallerySuppressTapUntil = 0;
        applyGalleryImageTransform();
    }

    function suppressGalleryTap() {
        gallerySuppressTapUntil = Date.now() + GALLERY_TAP_SUPPRESSION_MS;
    }

    function shouldSuppressGalleryTap() {
        return gallerySuppressTapUntil > Date.now();
    }

    function getGalleryTouchDistance(touches) {
        if (!touches || touches.length < 2) return 0;
        const [firstTouch, secondTouch] = [touches[0], touches[1]];
        return Math.hypot(secondTouch.clientX - firstTouch.clientX, secondTouch.clientY - firstTouch.clientY);
    }

    function getGalleryTouchMidpoint(touches) {
        if (!touches || touches.length < 2) return null;
        const [firstTouch, secondTouch] = [touches[0], touches[1]];
        return {
            x: (firstTouch.clientX + secondTouch.clientX) / 2,
            y: (firstTouch.clientY + secondTouch.clientY) / 2
        };
    }

    function beginGalleryPanGesture(touch) {
        if (!touch) return;

        galleryActiveGesture = 'pan';
        galleryGestureTouchId = touch.identifier ?? null;
        galleryGestureStartX = touch.clientX;
        galleryGestureStartY = touch.clientY;
        galleryGestureStartPanX = galleryImagePanX;
        galleryGestureStartPanY = galleryImagePanY;
    }

    function beginGalleryPendingPanGesture(touch) {
        if (!touch) return;

        galleryActiveGesture = 'pending_pan';
        galleryGestureTouchId = touch.identifier ?? null;
        galleryGestureStartX = touch.clientX;
        galleryGestureStartY = touch.clientY;
        galleryGestureStartPanX = galleryImagePanX;
        galleryGestureStartPanY = galleryImagePanY;
    }

    function beginGalleryPinchGesture(touches) {
        const metrics = getGalleryGestureMetrics();
        const midpoint = getGalleryTouchMidpoint(touches);
        const distance = getGalleryTouchDistance(touches);
        if (!metrics || !midpoint || !(distance > 0)) return;

        galleryActiveGesture = 'pinch';
        galleryGestureTouchId = null;
        galleryGestureStartDistance = distance;
        galleryGestureStartScale = galleryImageZoomScale;

        const offsetX = midpoint.x - (metrics.frameRect.left + (metrics.frameRect.width / 2));
        const offsetY = midpoint.y - (metrics.frameRect.top + (metrics.frameRect.height / 2));
        galleryGestureAnchorContentX = (offsetX - galleryImagePanX) / Math.max(galleryImageZoomScale, GALLERY_MIN_ZOOM_SCALE);
        galleryGestureAnchorContentY = (offsetY - galleryImagePanY) / Math.max(galleryImageZoomScale, GALLERY_MIN_ZOOM_SCALE);
    }

    function updateGalleryPanGesture(touch) {
        if (!touch) return;

        const deltaX = touch.clientX - galleryGestureStartX;
        const deltaY = touch.clientY - galleryGestureStartY;
        if (Math.abs(deltaX) > GALLERY_PAN_GESTURE_THRESHOLD_PX || Math.abs(deltaY) > GALLERY_PAN_GESTURE_THRESHOLD_PX) {
            suppressGalleryTap();
        }

        const nextPan = clampGalleryPan(
            galleryGestureStartPanX + deltaX,
            galleryGestureStartPanY + deltaY,
            galleryImageZoomScale
        );
        galleryImagePanX = nextPan.x;
        galleryImagePanY = nextPan.y;
        applyGalleryImageTransform();
    }

    function updateGalleryPinchGesture(touches) {
        const metrics = getGalleryGestureMetrics();
        const midpoint = getGalleryTouchMidpoint(touches);
        const distance = getGalleryTouchDistance(touches);
        if (!metrics || !midpoint || !(distance > 0) || !(galleryGestureStartDistance > 0)) return;

        const rawScale = galleryGestureStartScale * (distance / galleryGestureStartDistance);
        const nextScale = clampGalleryZoomScale(rawScale);
        if (Math.abs(nextScale - galleryGestureStartScale) > GALLERY_PINCH_SCALE_THRESHOLD) {
            suppressGalleryTap();
        }

        const offsetX = midpoint.x - (metrics.frameRect.left + (metrics.frameRect.width / 2));
        const offsetY = midpoint.y - (metrics.frameRect.top + (metrics.frameRect.height / 2));
        const nextPan = clampGalleryPan(
            offsetX - (galleryGestureAnchorContentX * nextScale),
            offsetY - (galleryGestureAnchorContentY * nextScale),
            nextScale
        );

        galleryImageZoomScale = nextScale;
        galleryImagePanX = nextPan.x;
        galleryImagePanY = nextPan.y;
        applyGalleryImageTransform();
    }

    function bindGalleryImageGestures(viewport) {
        if (!viewport || viewport.dataset.gesturesBound === 'true') return;

        viewport.ontouchstart = (event) => {
            if (!isTouchCapableDevice() || !hasGalleryRenderableFrame()) return;

            if (event.touches.length >= 2) {
                beginGalleryPinchGesture(event.touches);
                suppressGalleryTap();
                event.preventDefault();
                event.stopPropagation();
                return;
            }

            if (event.touches.length === 1 && galleryImageZoomScale > GALLERY_MIN_ZOOM_SCALE) {
                gallerySuppressTapUntil = 0;
                beginGalleryPendingPanGesture(event.touches[0]);
            }
        };

        viewport.ontouchmove = (event) => {
            if (!isTouchCapableDevice() || !hasGalleryRenderableFrame()) return;

            if (galleryActiveGesture === 'pinch' && event.touches.length >= 2) {
                updateGalleryPinchGesture(event.touches);
                event.preventDefault();
                event.stopPropagation();
                return;
            }

            const touch = getTrackedTouch(event.touches, galleryGestureTouchId)
                || getTrackedTouch(event.changedTouches, galleryGestureTouchId);
            if (!touch) return;

            if (galleryActiveGesture === 'pending_pan') {
                const deltaX = touch.clientX - galleryGestureStartX;
                const deltaY = touch.clientY - galleryGestureStartY;
                if (Math.abs(deltaX) <= GALLERY_PAN_GESTURE_THRESHOLD_PX && Math.abs(deltaY) <= GALLERY_PAN_GESTURE_THRESHOLD_PX) {
                    return;
                }
                galleryActiveGesture = 'pan';
                suppressGalleryTap();
            }

            if (galleryActiveGesture !== 'pan') return;

            updateGalleryPanGesture(touch);
            event.preventDefault();
            event.stopPropagation();
        };

        viewport.ontouchend = (event) => {
            if (!isTouchCapableDevice()) return;

            if (galleryActiveGesture === 'pending_pan') {
                galleryActiveGesture = null;
                galleryGestureTouchId = null;
                return;
            }

            if (galleryActiveGesture === 'pinch' && event.touches.length === 1 && galleryImageZoomScale > GALLERY_MIN_ZOOM_SCALE) {
                beginGalleryPanGesture(event.touches[0]);
                event.preventDefault();
                event.stopPropagation();
                return;
            }

            if (galleryActiveGesture === 'pan' && event.touches.length === 1) {
                const touch = getTrackedTouch(event.touches, galleryGestureTouchId) || event.touches[0];
                if (touch && galleryImageZoomScale > GALLERY_MIN_ZOOM_SCALE) {
                    beginGalleryPanGesture(touch);
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
            }

            if (galleryActiveGesture) {
                galleryActiveGesture = null;
                galleryGestureTouchId = null;
                event.preventDefault();
                event.stopPropagation();
            }
        };

        viewport.ontouchcancel = (event) => {
            galleryActiveGesture = null;
            galleryGestureTouchId = null;
            if (galleryImageZoomScale <= GALLERY_MIN_ZOOM_SCALE) {
                galleryImagePanX = 0;
                galleryImagePanY = 0;
                applyGalleryImageTransform();
            }
            event.preventDefault();
            event.stopPropagation();
        };

        ['gesturestart', 'gesturechange', 'gestureend'].forEach((eventName) => {
            viewport.addEventListener(eventName, (event) => {
                event.preventDefault();
            });
        });

        viewport.dataset.gesturesBound = 'true';
    }

    function updateNativeScrubberPreview(clientX = null) {
        if (!nativeScrubberPreviewTrack || !shouldShowGalleryScrubberPreview()) {
            clearNativeScrubberPreviewState();
            return;
        }

        const rect = nativeScrubberPreviewTrack.getBoundingClientRect?.();
        const duration = currentSceneData?.duration || getGalleryDuration();
        if (!rect || !(rect.width > 0) || !(duration > 0)) {
            hideSpritePreview();
            return;
        }

        const rawValue = parseFloat(nativeScrubberPreviewTrack.value ?? '0');
        const percentFromValue = duration > 0 ? clampGalleryTime(rawValue) / duration : 0;
        const resolvedClientX = Number.isFinite(clientX)
            ? clientX
            : rect.left + (percentFromValue * rect.width);
        const percent = Math.max(0, Math.min(1, (resolvedClientX - rect.left) / rect.width));
        const previewTime = clampGalleryTime(percent * duration);
        const previewData = getSpritePreviewDataForTime(previewTime);
        if (!previewData) {
            hideSpritePreview();
            return;
        }

        const { width, height } = getSpritePreviewDimensions();
        const edgePadding = 12;
        const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || width;
        const left = Math.max(
            edgePadding,
            Math.min(resolvedClientX - (width / 2), viewportWidth - width - edgePadding)
        );
        const top = Math.max(edgePadding, rect.top - height - 12);

        const previewBox = getSpritePreviewBox();
        previewBox.style.width = `${width}px`;
        showSpritePreview(previewData, { left, top });
    }

    function getExternalScrubberTime() {
        const indicator = document.querySelector('#scrubber-position-indicator');
        if (!indicator) return null;

        const duration = currentSceneData?.duration || getGalleryDuration();
        if (!(duration > 0)) return null;

        const transform = indicator.style.transform || getComputedStyle(indicator).transform || '';
        const percentMatch = transform.match(/translateX\(([-\d.]+)%\)/);
        if (percentMatch) {
            const percent = parseFloat(percentMatch[1]);
            if (Number.isFinite(percent)) {
                return clampGalleryTime((percent / 100) * duration);
            }
        }

        return null;
    }

    function parseScrubberPercentTransform(transform) {
        const match = (transform || '').match(/translateX\(([-\d.]+)%\)/);
        return match ? parseFloat(match[1]) : null;
    }

    function parseScrubberPixelTransform(transform) {
        const match = (transform || '').match(/translateX\(([-\d.]+)px\)/);
        return match ? parseFloat(match[1]) : null;
    }

    function syncNativeSpriteScrubber(time) {
        if (isPhoneSizedTouchLayout()) return;

        const indicator = document.querySelector('#scrubber-position-indicator');
        const slider = document.querySelector('.scrubber-slider');
        if (!indicator || !slider) return;

        const duration = currentSceneData?.duration || getGalleryDuration();
        if (!(duration > 0)) return;

        const items = Array.from(document.querySelectorAll('.scrubber-item'));
        const totalWidth = slider.scrollWidth
            || items.reduce((max, item) => Math.max(max, item.offsetLeft + item.offsetWidth), 0);
        if (!(totalWidth > 0)) return;

        const currentPercent = parseScrubberPercentTransform(indicator.style.transform);
        const currentTranslate = parseScrubberPixelTransform(slider.style.transform);
        if (!Number.isFinite(currentPercent) || !Number.isFinite(currentTranslate)) return;

        const offset = currentTranslate + (currentPercent / 100) * totalWidth;
        const nextPercent = (clampGalleryTime(time) / duration) * 100;

        indicator.style.transform = `translateX(${nextPercent}%)`;
        slider.style.transform = `translateX(${offset - (nextPercent / 100) * totalWidth}px)`;
    }

    function syncFromExternalScrubber() {
        const nextTime = getExternalScrubberTime();
        if (nextTime === null) return;

        if (galleryOverlay && isGalleryModeOn()) {
            showGalleryAtTime(nextTime);
            return;
        }

        const controller = getPlaybackController();
        if (!controller) return;

        const wasPaused = isControllerPaused(controller);
        setControllerTime(controller, nextTime);
        if (!wasPaused) {
            playController(controller);
        }
    }

    function scheduleExternalScrubberSync() {
        if (externalScrubberSyncTimeoutId !== null) {
            clearTimeout(externalScrubberSyncTimeoutId);
        }

        externalScrubberSyncTimeoutId = setTimeout(() => {
            externalScrubberSyncTimeoutId = null;
            syncFromExternalScrubber();
        }, EXTERNAL_SCRUBBER_SYNC_DELAY_MS);
    }

    function updateGalleryOverlayLayout() {
        if (!galleryOverlay) return;

        const isFullscreen = isGalleryFullscreenActive();
        const controlsInset = isFullscreen ? 0 : getGalleryControlsOffset();

        galleryOverlay.style.bottom = '0px';
        galleryOverlay.style.setProperty('--gallery-controls-offset', `${controlsInset}px`);
    }

    function clearGalleryOverlayLayoutRefresh() {
        if (galleryLayoutRefreshTimeoutId !== null) {
            clearTimeout(galleryLayoutRefreshTimeoutId);
            galleryLayoutRefreshTimeoutId = null;
        }
        if (galleryLayoutRefreshDelayedTimeoutId !== null) {
            clearTimeout(galleryLayoutRefreshDelayedTimeoutId);
            galleryLayoutRefreshDelayedTimeoutId = null;
        }
        if (galleryLayoutRefreshLateTimeoutId !== null) {
            clearTimeout(galleryLayoutRefreshLateTimeoutId);
            galleryLayoutRefreshLateTimeoutId = null;
        }
    }

    function scheduleGalleryOverlayLayoutRefresh() {
        updateGalleryOverlayLayout();
        clearGalleryOverlayLayoutRefresh();

        galleryLayoutRefreshTimeoutId = setTimeout(() => {
            galleryLayoutRefreshTimeoutId = null;
            updateGalleryOverlayLayout();
        }, 0);

        galleryLayoutRefreshDelayedTimeoutId = setTimeout(() => {
            galleryLayoutRefreshDelayedTimeoutId = null;
            updateGalleryOverlayLayout();
        }, 150);

        galleryLayoutRefreshLateTimeoutId = setTimeout(() => {
            galleryLayoutRefreshLateTimeoutId = null;
            updateGalleryOverlayLayout();
        }, GALLERY_LAYOUT_REFRESH_LATE_MS);
    }

    function bindExternalScrubberCompatibility() {
        if (externalScrubberBound) return;

        const handleExternalScrubberInteraction = (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (!target.closest('.scrubber-wrapper')) return;
            scheduleExternalScrubberSync();
        };

        document.addEventListener('click', handleExternalScrubberInteraction, true);
        document.addEventListener('pointerup', handleExternalScrubberInteraction, true);
        externalScrubberBound = true;
    }

    function bindGalleryScrubberPreview(scrubber) {
        if (!scrubber || scrubber.dataset.previewBound === 'true') return;

        const beginPreview = (clientX, identifier = null) => {
            if (!shouldShowGalleryScrubberPreview()) return;
            cancelNativeScrubberPreviewClear();
            nativeScrubberPreviewTrack = scrubber;
            nativeScrubberPreviewTouchId = identifier;
            updateNativeScrubberPreview(clientX);
        };

        scrubber.onpointerdown = (event) => {
            event.stopPropagation();
            beginPreview(event.clientX, event.pointerId);
        };
        scrubber.onpointermove = (event) => {
            event.stopPropagation();
            if (nativeScrubberPreviewTrack !== scrubber) return;
            updateNativeScrubberPreview(event.clientX);
        };
        scrubber.onpointerup = (event) => {
            event.stopPropagation();
            scheduleNativeScrubberPreviewClear();
        };
        scrubber.onpointercancel = () => {
            clearNativeScrubberPreviewState();
        };
        scrubber.ontouchstart = (event) => {
            event.stopPropagation();
            const touch = event.touches?.[0] || event.changedTouches?.[0];
            if (!touch) return;
            beginPreview(touch.clientX, touch.identifier);
        };
        scrubber.ontouchmove = (event) => {
            event.stopPropagation();
            const touch = getTrackedTouch(event.touches, nativeScrubberPreviewTouchId)
                || getTrackedTouch(event.changedTouches, nativeScrubberPreviewTouchId);
            if (!touch) return;
            if (nativeScrubberPreviewTrack !== scrubber) {
                beginPreview(touch.clientX, touch.identifier);
                return;
            }
            updateNativeScrubberPreview(touch.clientX);
        };
        scrubber.ontouchend = (event) => {
            event.stopPropagation();
            scheduleNativeScrubberPreviewClear();
        };
        scrubber.ontouchcancel = () => {
            clearNativeScrubberPreviewState();
        };
        scrubber.onchange = () => {
            scheduleNativeScrubberPreviewClear();
        };
        scrubber.onblur = () => {
            scheduleNativeScrubberPreviewClear(0);
        };

        scrubber.dataset.previewBound = 'true';
    }

    function getPlaybackController() {
        const mediaEl = getMediaEl();
        if (!mediaEl) return null;

        const videoJsContainer = mediaEl.closest('.video-js');
        const apiCandidates = [
            mediaEl.player,
            mediaEl.__videojsPlayer,
            videoJsContainer?.player,
            videoJsContainer?.__videojsPlayer
        ].filter(Boolean);

        const api = apiCandidates.find((candidate) =>
            typeof candidate.currentTime === 'function' ||
            typeof candidate.pause === 'function' ||
            typeof candidate.play === 'function'
        ) || null;

        const eventTarget = api && (typeof api.addEventListener === 'function' || typeof api.on === 'function')
            ? api
            : mediaEl;

        return { mediaEl, api, eventTarget };
    }

    function getControllerTime(controller) {
        if (!controller) return 0;

        if (controller.api && typeof controller.api.currentTime === 'function') {
            const apiTime = controller.api.currentTime();
            if (Number.isFinite(apiTime)) return apiTime;
        }

        return normalizeGalleryTime(controller.mediaEl?.currentTime ?? 0);
    }

    function setControllerTime(controller, time) {
        if (!controller) return;
        const previousTime = getControllerTime(controller);
        const nextTime = normalizeGalleryTime(time);
        let apiUpdated = false;

        if (controller.api && typeof controller.api.currentTime === 'function') {
            controller.api.currentTime(nextTime);
            apiUpdated = true;
        }

        if (controller.mediaEl) {
            try {
                if (!isSameGalleryTime(controller.mediaEl.currentTime, nextTime) || !apiUpdated) {
                    controller.mediaEl.currentTime = nextTime;
                }
            } catch (_) {
                // Some players reject currentTime updates until metadata is ready.
            }
        }

        if (!isSameGalleryTime(getControllerTime(controller), previousTime)) {
            notifyControllerTimeUpdate(controller);
        }
    }

    function setControllerTimeSilently(controller, time) {
        if (!controller) return;
        const nextTime = normalizeGalleryTime(time);
        let apiUpdated = false;

        if (controller.api && typeof controller.api.currentTime === 'function') {
            try {
                controller.api.currentTime(nextTime);
                apiUpdated = true;
            } catch (_) {
                // Fall back to the media element assignment below.
            }
        }

        if (controller.mediaEl) {
            try {
                if (!isSameGalleryTime(controller.mediaEl.currentTime, nextTime) || !apiUpdated) {
                    controller.mediaEl.currentTime = nextTime;
                }
            } catch (_) {
                // Some players reject currentTime updates until metadata is ready.
            }
        }
    }

    function isControllerPaused(controller) {
        if (!controller) return true;

        if (controller.api && typeof controller.api.paused === 'function') {
            return controller.api.paused();
        }

        return controller.mediaEl?.paused ?? true;
    }

    function pauseController(controller) {
        if (!controller) return;

        if (controller.api && typeof controller.api.pause === 'function') {
            controller.api.pause();
            return;
        }

        if (typeof controller.mediaEl?.pause === 'function') {
            controller.mediaEl.pause();
        }
    }

    function playController(controller) {
        if (!controller) return;

        if (controller.api && typeof controller.api.play === 'function') {
            controller.api.play();
            return;
        }

        if (typeof controller.mediaEl?.play === 'function') {
            controller.mediaEl.play();
        }
    }

    function notifyControllerTimeUpdate(controller) {
        if (!controller) return;

        syncNativeSpriteScrubber(getControllerTime(controller));

        if (typeof controller.mediaEl?.dispatchEvent === 'function') {
            try {
                controller.mediaEl.dispatchEvent(new Event('timeupdate', { bubbles: true }));
            } catch (_) {
                // Ignore synthetic event failures on non-DOM media shims.
            }
        }

        if (controller.api && typeof controller.api.trigger === 'function') {
            // Stash's ScenePlayer ignores timeupdate while paused() is truthy,
            // so React's `time` state never advances during gallery navigation
            // and the sprite scrubber snaps back to the last-played time on
            // the next rerender (e.g. mid-drag). Briefly pretend the player
            // is playing during the synchronous broadcast so the handler runs
            // setTime(currentTime).
            const origPaused = controller.api.paused;
            const patched = typeof origPaused === 'function';
            if (patched) controller.api.paused = () => false;
            try {
                controller.api.trigger('timeupdate');
            } catch (_) {
                // Ignore trigger failures on non-Video.js players.
            } finally {
                if (patched) controller.api.paused = origPaused;
            }
        }
    }

    function addControllerListener(target, eventName, handler) {
        if (!target) return;

        if (typeof target.addEventListener === 'function') {
            target.addEventListener(eventName, handler);
            return;
        }

        if (typeof target.on === 'function') {
            target.on(eventName, handler);
        }
    }

    function removeControllerListener(target, eventName, handler) {
        if (!target) return;

        if (typeof target.removeEventListener === 'function') {
            target.removeEventListener(eventName, handler);
            return;
        }

        if (typeof target.off === 'function') {
            target.off(eventName, handler);
        }
    }

    async function stashGQL(query, variables) {
        const response = await fetch('/graphql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, variables })
        });
        const json = await response.json();
        return json.data;
    }

    const GALLERY_ACTIVITY_SAVE_DEBOUNCE_MS = 500;
    const GALLERY_ACTIVITY_SAVE_MUTATION =
        'mutation($id: ID!, $t: Float) { sceneSaveActivity(id: $id, resume_time: $t, playDuration: 0) }';

    function scheduleGalleryActivitySave(time) {
        if (!currentSceneId) return;
        galleryActivitySavePendingTime = normalizeGalleryTime(time);
        if (galleryActivitySaveTimeoutId !== null) clearTimeout(galleryActivitySaveTimeoutId);
        galleryActivitySaveTimeoutId = setTimeout(() => {
            galleryActivitySaveTimeoutId = null;
            flushGalleryActivitySave();
        }, GALLERY_ACTIVITY_SAVE_DEBOUNCE_MS);
    }

    function flushGalleryActivitySave() {
        if (galleryActivitySaveTimeoutId !== null) {
            clearTimeout(galleryActivitySaveTimeoutId);
            galleryActivitySaveTimeoutId = null;
        }
        const time = galleryActivitySavePendingTime;
        const sceneId = currentSceneId;
        if (time === null || !sceneId) return;
        galleryActivitySavePendingTime = null;
        stashGQL(GALLERY_ACTIVITY_SAVE_MUTATION, { id: sceneId, t: time })
            .catch((e) => console.warn('GalleryMode: failed to save resume time', e));
    }

    function flushGalleryActivitySaveBeacon() {
        if (galleryActivitySaveTimeoutId !== null) {
            clearTimeout(galleryActivitySaveTimeoutId);
            galleryActivitySaveTimeoutId = null;
        }
        const time = galleryActivitySavePendingTime;
        const sceneId = currentSceneId;
        if (time === null || !sceneId) return;
        galleryActivitySavePendingTime = null;
        const payload = JSON.stringify({
            query: GALLERY_ACTIVITY_SAVE_MUTATION,
            variables: { id: sceneId, t: time }
        });
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
            try {
                navigator.sendBeacon('/graphql', new Blob([payload], { type: 'application/json' }));
                return;
            } catch (_) {
                // Fall through to keepalive fetch.
            }
        }
        try {
            fetch('/graphql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload,
                keepalive: true
            });
        } catch (_) {
            // Swallow — best-effort on unload.
        }
    }

    async function loadPluginSettings() {
        const query = `query Configuration { configuration { plugins } }`;
        try {
            const data = await stashGQL(query);
            const allPlugins = data?.configuration?.plugins;
            if (allPlugins && allPlugins[PLUGIN_ID]) {
                const settings = allPlugins[PLUGIN_ID];
                pluginSettings.lb_prefetch_enabled = settings.lb_prefetch_enabled ?? true;
                pluginSettings.lb_prefetch_offsets_seconds = settings.lb_prefetch_offsets_seconds
                    ?? DEFAULT_GALLERY_PREFETCH_OFFSETS_SECONDS;
                pluginSettings.lb_prefetch_window_seconds = settings.lb_prefetch_window_seconds ?? DEFAULT_GALLERY_PREFETCH_WINDOW_SECONDS;
                pluginSettings.lb_frame_server_port = settings.lb_frame_server_port ?? 9876;
                pluginSettings.lb_frame_server_host = settings.lb_frame_server_host ?? '';
                pluginSettings.lb_enabled = settings.lb_enabled ?? false;
                pluginSettings.general_show_debug_panel = settings.general_show_debug_panel ?? false;
                defaultMode = getDefaultMode(settings);
            }
        } catch (e) {
            console.warn('GalleryMode: Could not load plugin settings, using defaults', e);
        }
        if (_SessionEvents) _dispatchStoreEvent(_SessionEvents.settingsLoaded(pluginSettings));
        return pluginSettings;
    }

    async function getSceneData(sceneId) {
        const query = `query FindScene($id: ID!) { findScene(id: $id) { id files { duration } paths { sprite } } }`;
        try {
            const data = await stashGQL(query, { id: sceneId });
            const scene = data.findScene;
            if (!scene) return null;
            scene.duration = (scene.files?.[0]?.duration) || 0;
            if (_SessionEvents) _dispatchStoreEvent(_SessionEvents.sceneDataLoaded(scene));
            return scene;
        } catch (e) { return null; }
    }

    // --- GALLERY UI HELPERS ---
    function isGalleryUsingVideoSurface() {
        return getGalleryMediaMode() === 'video';
    }

    function syncGalleryVideoSurfaceSizing() {
        const video = getGalleryVideoElement();
        if (!video) return;

        const shouldManageMobileSizing = isGalleryUsingVideoSurface() && isPhoneSizedTouchLayout();
        if (!shouldManageMobileSizing || !video.classList.contains('stash-gallery-video-active')) {
            video.style.width = '';
            video.style.height = '';
            video.style.maxWidth = '';
            video.style.maxHeight = '';
            return;
        }

        const useViewportBounds = isGalleryFullscreenActive();
        const fullHeight = (typeof CSS !== 'undefined' && CSS.supports?.('height', '100dvh')) ? '100dvh' : '100vh';
        video.style.width = useViewportBounds ? '100vw' : '100%';
        video.style.height = useViewportBounds ? fullHeight : '100%';
        video.style.maxWidth = useViewportBounds ? '100vw' : '100%';
        video.style.maxHeight = useViewportBounds ? fullHeight : '100%';
    }

    function syncGalleryRenderSurfaceState() {
        const frame = galleryOverlay?.querySelector('#sprite-gallery-frame');
        const viewport = galleryOverlay?.querySelector('#sprite-gallery-viewport');
        const img = getGalleryImageElement();
        const video = getGalleryVideoElement();
        const videoContainer = getVideoContainer();
        const videoMode = galleryOverlay && isGalleryUsingVideoSurface();

        galleryOverlay?.classList.toggle('gallery-overlay-video-mode', Boolean(videoMode));
        frame?.classList.toggle('gallery-frame-video-mode', Boolean(videoMode));
        viewport?.classList.toggle('gallery-viewport-video-mode', Boolean(videoMode));
        if (frame) frame.dataset.mediaMode = videoMode ? 'video' : 'image';
        if (viewport) viewport.dataset.mediaMode = videoMode ? 'video' : 'image';

        if (img) {
            img.style.display = videoMode
                ? 'none'
                : (galleryHasVisibleFrame && galleryLastImageSrc ? 'block' : 'none');
        }

        videoContainer?.classList.toggle('stash-gallery-player-gallery-active', Boolean(videoMode));
        video?.classList.toggle('stash-gallery-video-active', Boolean(videoMode));
        syncGalleryVideoSurfaceSizing();
    }

    function clearGalleryRenderSurfaceState() {
        const video = getGalleryVideoElement();
        const videoContainer = getVideoContainer();
        videoContainer?.classList.remove('stash-gallery-player-gallery-active');
        videoContainer?.classList.remove('stash-gallery-container-fullscreen');
        if (video) {
            video.classList.remove('stash-gallery-video-active');
            video.style.transform = '';
            video.style.width = '';
            video.style.height = '';
            video.style.maxWidth = '';
            video.style.maxHeight = '';
            delete video.dataset.zoomScale;
            delete video.dataset.panX;
            delete video.dataset.panY;
        }
    }

    function setGalleryLoadingState(time, message = 'Loading\u2026') {
        if (!galleryOverlay) return;

        const img = getGalleryImageElement();
        const loading = galleryOverlay.querySelector('#sprite-gallery-loading');
        if (!loading) return;
        const keepVisibleFrame = isGalleryUsingVideoSurface() && galleryHasVisibleFrame;

        galleryHasVisibleFrame = keepVisibleFrame;
        if (!isGalleryUsingVideoSurface()) {
            galleryLastImageSrc = '';
            if (img) img.style.display = 'none';
        }
        loading.style.display = 'block';
        if (keepVisibleFrame) {
            loading.classList.add('sprite-gallery-loading-corner');
            loading.textContent = '';
            loading.setAttribute('aria-label', 'Loading...');
        } else {
            loading.classList.remove('sprite-gallery-loading-corner');
            loading.textContent = message;
            loading.setAttribute('aria-label', message);
        }
        syncGalleryRenderSurfaceState();
        updateGalleryUi(normalizeGalleryTime(time));
        galleryOverlay.style.display = 'flex';
    }

    function setGalleryControlsVisible(visible) {
        galleryControlsVisible = !!visible;
        if (_SessionEvents) _dispatchStoreEvent(_SessionEvents.controlsToggle(!!visible));
        if (!galleryOverlay) return;

        const controls = galleryOverlay.querySelector('#sprite-gallery-controls');
        if (!controls) return;
        controls.dataset.visible = String(galleryControlsVisible);
        controls.classList.toggle('gallery-controls-visible', galleryControlsVisible);
    }

    function updateGalleryActionButtons() {
        if (!galleryOverlay) return;

        const hasFrame = hasGalleryRenderableFrame();
        const isFullscreen = isGalleryFullscreenActive();

        const fullscreenBtn = galleryOverlay.querySelector('#sprite-gallery-fullscreen');
        if (fullscreenBtn) {
            fullscreenBtn.disabled = !hasFrame && !isFullscreen;
            fullscreenBtn.textContent = isFullscreen ? 'Exit fullscreen' : 'Fullscreen';
        }

        const fullResolutionBtn = galleryOverlay.querySelector('#sprite-gallery-full-resolution');
        if (fullResolutionBtn) {
            if (!isLowBandwidthMode()) {
                fullResolutionBtn.style.display = 'none';
            } else {
                fullResolutionBtn.style.display = '';
                const hasFullResolutionImage = galleryLastImageScale !== null && galleryLastImageScale >= 1;
                fullResolutionBtn.disabled = !galleryLastImageSrc || galleryFullResolutionPending || hasFullResolutionImage;
                fullResolutionBtn.textContent = galleryFullResolutionPending
                    ? 'Requesting full resolution...'
                    : 'Request full resolution';
            }
        }

        updateGalleryJumpButtons();
    }

    function updateGalleryJumpButtons(time = galleryLastRequestedTime ?? 0) {
        if (!galleryOverlay) return;

        const nextTime = normalizeGalleryTime(time);
        const duration = getGalleryDuration();
        galleryOverlay.querySelectorAll('.sprite-gallery-jump-btn').forEach((button) => {
            const delta = parseFloat(button.dataset.delta ?? '0');
            const targetTime = clampGalleryTime(nextTime + delta);
            const disabled = isSameGalleryTime(targetTime, nextTime)
                || (duration > 0 && (targetTime < 0 || targetTime > duration));
            const cached = !disabled && hasGalleryCachedFrame(targetTime, currentSceneId, getEffectiveGalleryScale());

            button.disabled = disabled;
            button.dataset.cached = cached ? 'true' : 'false';
            button.classList.toggle('sprite-gallery-jump-btn-cached', cached);
        });
        updateGalleryDebugPanel(nextTime);
    }

    function updateGalleryUi(time = galleryLastRequestedTime ?? 0) {
        if (!galleryOverlay) return;

        const nextTime = normalizeGalleryTime(time);
        const timeEl = galleryOverlay.querySelector('#sprite-gallery-time');
        const scrubber = galleryOverlay.querySelector('#sprite-gallery-scrubber');

        if (timeEl) timeEl.textContent = formatTime(nextTime);
        if (scrubber) {
            const spriteInterval = getGallerySpriteIntervalSeconds();
            scrubber.max = String(getGalleryDuration());
            scrubber.value = String(nextTime);
            scrubber.disabled = getGalleryDuration() <= 0;
            scrubber.step = String(spriteInterval > 0 ? spriteInterval : 0.1);
            scrubber.style.display = shouldShowGalleryScrubber() ? 'block' : 'none';
        }

        updateGalleryActionButtons();
        syncGalleryDebugPanelVisibility();
        updateGalleryDebugPanel(nextTime);
    }

    function seekGalleryToTime(time) {
        const nextTime = getGallerySpriteAlignedTime(time);
        if (isSameGalleryTime(nextTime, galleryLastRequestedTime)) return Promise.resolve();
        if (_SessionEvents) _dispatchStoreEvent(_SessionEvents.scrubInput(nextTime));
        return showGalleryAtTime(nextTime);
    }

    function shiftGalleryTime(delta) {
        const baseTime = galleryLastRequestedTime ?? getControllerTime(getPlaybackController());
        const nextTime = clampGalleryTime(normalizeGalleryTime(baseTime + delta));
        if (isSameGalleryTime(nextTime, galleryLastRequestedTime)) return Promise.resolve();
        if (_SessionEvents) _dispatchStoreEvent(_SessionEvents.jumpBy(delta));
        return showGalleryAtTime(nextTime);
    }

    async function requestGalleryFullResolution() {
        if (!galleryOverlay || !currentSceneId || galleryLastRequestedTime === null || galleryFullResolutionPending) return;
        if (galleryLastImageScale !== null && galleryLastImageScale >= 1 && galleryLastImageSrc) return;

        const img = getGalleryImageElement();
        const loading = galleryOverlay.querySelector('#sprite-gallery-loading');
        if (!img || !loading) return;

        const nextTime = normalizeGalleryTime(galleryLastRequestedTime);
        const cachedSrc = getGalleryCachedFrame(nextTime, currentSceneId, 1);
        if (cachedSrc) {
            img.src = cachedSrc;
            img.style.display = 'block';
            loading.style.display = 'none';
            galleryLastImageSrc = cachedSrc;
            galleryLastImageScale = 1;
            galleryHasVisibleFrame = true;
            galleryFullResolutionPending = false;
            syncGalleryRenderSurfaceState();
            updateGalleryActionButtons();
            return;
        }

        const requestId = ++galleryRequestSeq;
        cancelActiveGalleryRequest();
        galleryActiveRequestId = requestId;
        galleryFullResolutionPending = true;
        loading.style.display = 'block';
        loading.classList.add('sprite-gallery-loading-corner');
        loading.textContent = '';
        loading.setAttribute('aria-label', 'Loading full resolution...');
        updateGalleryActionButtons();

        const result = await fetchGalleryFrameData(nextTime, { requestId, scale: 1 });
        if (galleryActiveRequestId !== requestId) return;

        galleryFullResolutionPending = false;
        if (result.status === 'ok') {
            storeGalleryCachedFrame(nextTime, result.src, currentSceneId, 1);
            img.src = result.src;
            img.style.display = 'block';
            loading.style.display = 'none';
            loading.classList.remove('sprite-gallery-loading-corner');
            galleryLastImageSrc = result.src;
            galleryLastImageScale = 1;
            galleryHasVisibleFrame = true;
            syncGalleryRenderSurfaceState();
        } else if (result.status !== 'cancelled') {
            if (galleryLastImageSrc) {
                loading.style.display = 'none';
                loading.classList.remove('sprite-gallery-loading-corner');
            } else {
                loading.classList.remove('sprite-gallery-loading-corner');
                loading.textContent = result.message || 'Frame unavailable';
                loading.setAttribute('aria-label', result.message || 'Frame unavailable');
            }
        }
        updateGalleryActionButtons();
    }

    // --- FULLSCREEN & SCROLL LOCK ---
    function getGalleryFullscreenElement() {
        return document.fullscreenElement || null;
    }

    function isGalleryFullscreenActive() {
        const fullscreenElement = getGalleryFullscreenElement();
        const frame = galleryOverlay?.querySelector('#sprite-gallery-frame');
        const overlay = galleryOverlay;
        const videoContainer = getVideoContainer();
        const media = getActiveGalleryMediaElement();
        return Boolean(galleryPseudoFullscreen || (
            fullscreenElement
            && [frame, overlay, videoContainer, media].filter(Boolean).includes(fullscreenElement)
        ));
    }

    function shouldUseSoftGalleryScrollLock() {
        const userAgent = navigator.userAgent || '';
        const platform = navigator.platform || '';
        const isAppleTouchDevice = /iP(hone|od|ad)/.test(userAgent)
            || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        return isAppleTouchDevice;
    }

    function setGalleryScrollLockClasses({ hard = false, soft = false } = {}) {
        [document.documentElement, document.body].filter(Boolean).forEach((element) => {
            element.classList.toggle('stash-gallery-scroll-lock', hard);
            element.classList.toggle('stash-gallery-scroll-soft-lock', soft);
        });
    }

    function syncGalleryScrollLock(isLocked) {
        if (!isLocked) {
            setGalleryScrollLockClasses();
            return;
        }
        if (!shouldUseSoftGalleryScrollLock()) {
            setGalleryScrollLockClasses({ hard: true });
            return;
        }
        setGalleryScrollLockClasses({ soft: true });
    }

    function syncGalleryFullscreenState() {
        const frame = galleryOverlay?.querySelector('#sprite-gallery-frame');
        const overlay = galleryOverlay;
        if (!frame || !overlay) return;

        const isFullscreen = isGalleryFullscreenActive();
        if (_SessionEvents) {
            _dispatchStoreEvent(isFullscreen
                ? _SessionEvents.fullscreenEntered()
                : _SessionEvents.fullscreenExited());
        }
        const videoContainer = getVideoContainer();
        const videoModePseudoFs = galleryPseudoFullscreen && isGalleryUsingVideoSurface() && !!videoContainer;

        overlay.dataset.overlayFullscreen = galleryPseudoFullscreen ? 'true' : 'false';
        frame.dataset.pseudoFullscreen = galleryPseudoFullscreen ? 'true' : 'false';
        frame.dataset.mobileFullscreen = isFullscreen && isPhoneSizedTouchLayout() ? 'true' : 'false';
        // In video-mode pseudo-fullscreen, promote the video container instead of the overlay
        // so the video element stays visible behind the transparent overlay.
        if (videoContainer) {
            videoContainer.classList.toggle('stash-gallery-container-fullscreen', videoModePseudoFs);
        }
        overlay.classList.toggle('gallery-overlay-fullscreen', galleryPseudoFullscreen && !videoModePseudoFs);
        frame.classList.toggle('gallery-pseudo-fullscreen', galleryPseudoFullscreen);
        frame.classList.toggle('gallery-mobile-fullscreen', isFullscreen && isPhoneSizedTouchLayout());
        frame.dataset.mobileRotated = 'false';
        syncGalleryScrollLock(isFullscreen);
        syncGalleryVideoSurfaceSizing();
        if (!isFullscreen) {
            unlockGalleryOrientation();
        }
        const scrubber = galleryOverlay.querySelector('#sprite-gallery-scrubber');
        if (scrubber) {
            scrubber.style.display = shouldShowGalleryScrubber() ? 'block' : 'none';
        }
        if (nativeScrubberPreviewTrack && !shouldShowGalleryScrubberPreview()) {
            clearNativeScrubberPreviewState();
        }
        updateGalleryOverlayLayout();
        updateGalleryActionButtons();
        syncGalleryDebugPanelVisibility();
    }

    function unlockGalleryOrientation() {
        if (typeof screen.orientation?.unlock === 'function') {
            screen.orientation.unlock();
        }
    }

    async function lockGalleryOrientation() {
        if (typeof screen.orientation?.lock === 'function') {
            await screen.orientation.lock('landscape');
        }
    }

    async function openGalleryFullscreen() {
        if (!galleryOverlay || !hasGalleryRenderableFrame()) return;

        const frame = galleryOverlay.querySelector('#sprite-gallery-frame');
        const fullscreenCandidates = isGalleryUsingVideoSurface()
            ? [getVideoContainer(), frame, galleryOverlay, getActiveGalleryMediaElement()].filter(Boolean)
            : [frame, galleryOverlay, getGalleryImageElement()].filter(Boolean);

        for (const target of fullscreenCandidates) {
            const requestFullscreen = target?.requestFullscreen;
            if (typeof requestFullscreen !== 'function') continue;
            try {
                await Promise.resolve(requestFullscreen.call(target));
                syncGalleryFullscreenState();
                if (isPhoneSizedTouchLayout()) {
                    await lockGalleryOrientation();
                    syncGalleryFullscreenState();
                }
                return;
            } catch (_) {
                // Try next candidate.
            }
        }

        galleryPseudoFullscreen = true;
        syncGalleryFullscreenState();
        if (isPhoneSizedTouchLayout()) {
            await lockGalleryOrientation();
            syncGalleryFullscreenState();
        }
    }

    function exitGalleryFullscreen() {
        galleryPseudoFullscreen = false;
        if (typeof document.exitFullscreen !== 'function') {
            syncGalleryFullscreenState();
            return Promise.resolve();
        }
        let result;
        try {
            result = document.exitFullscreen();
        } catch (_) {
            syncGalleryFullscreenState();
            return Promise.resolve();
        }
        return Promise.resolve(result).finally(() => {
            syncGalleryFullscreenState();
        });
    }

    async function toggleGalleryFullscreen() {
        if (getGalleryFullscreenElement() || galleryPseudoFullscreen) {
            await exitGalleryFullscreen();
            return;
        }
        await openGalleryFullscreen();
    }

    // --- REQUEST MANAGEMENT ---
    function cancelActiveGalleryRequest() {
        galleryControlledSeekTargetTime = null;
        galleryActiveRequestId = ++galleryRequestSeq;
        Array.from(gallerySocketRequests.entries())
            .filter(([, request]) => request.kind === 'frame')
            .forEach(([requestId, request]) => {
                if (galleryActiveSocket?.readyState === WebSocket.OPEN) {
                    galleryActiveSocket.send(JSON.stringify({ type: 'cancel', request_id: requestId }));
                }
                clearTimeout(request.timeoutId);
                gallerySocketRequests.delete(requestId);
                request.resolve({ status: 'cancelled' });
            });
        updateGalleryDebugPanel();
    }

    function cancelGalleryPrefetch() {
        galleryPrefetchGeneration += 1;
        galleryPrefetchQueue = [];
        galleryPrefetchRunning = false;
        galleryPrefetchCenterTime = null;
        galleryPrefetchContextKey = null;
        Array.from(gallerySocketRequests.entries())
            .filter(([, request]) => request.kind === 'prefetch_batch')
            .forEach(([requestId, request]) => {
                if (galleryActiveSocket?.readyState === WebSocket.OPEN) {
                    galleryActiveSocket.send(JSON.stringify({ type: 'cancel', request_id: requestId }));
                }
                clearTimeout(request.timeoutId);
                gallerySocketRequests.delete(requestId);
                request.resolve({ status: 'cancelled', results: [] });
            });
        updateGalleryDebugPanel();
    }

    function closeGallerySocket() {
        if (galleryActiveSocket) {
            galleryActiveSocket.close();
        }
        galleryActiveSocket = null;
        gallerySocketReadyPromise = null;
    }

    function getGalleryTimeRequestKey(time) {
        return normalizeGalleryCacheTime(time).toFixed(3);
    }

    function getGalleryRequestDataUrl(imageBase64) {
        return `data:image/jpeg;base64,${imageBase64}`;
    }

    // --- DEBUG PANEL ---
    function formatGalleryDebugNumber(value) {
        return normalizeGalleryCacheTime(value).toFixed(3);
    }

    function formatGalleryDebugOffsets(offsets) {
        return offsets.map((offset) => String(offset)).join(', ');
    }

    function getGallerySceneCacheTimes(centerTime = galleryLastRequestedTime ?? 0) {
        const scale = getEffectiveGalleryScale();
        const prefix = `${currentSceneId}::${scale}::`;
        return Array.from(galleryFrameCache.keys())
            .filter((key) => key.startsWith(prefix))
            .map((key) => parseFloat(key.split('::')[2]))
            .filter((time) => Number.isFinite(time))
            .sort((a, b) => Math.abs(a - centerTime) - Math.abs(b - centerTime) || a - b);
    }

    function getGalleryPendingRequestSummary() {
        const frameRequests = [];
        const batchRequests = [];
        gallerySocketRequests.forEach((request, requestId) => {
            if (request.kind === 'frame') {
                frameRequests.push(requestId);
                return;
            }
            batchRequests.push(
                `${requestId}[pending=${request.pendingKeys?.size ?? 0},received=${request.results?.length ?? 0}]`
            );
        });
        return { frameRequests, batchRequests };
    }

    function syncGalleryDebugPanelVisibility() {
        if (!galleryOverlay) return;

        const debugPanel = galleryOverlay.querySelector('#sprite-gallery-debug');
        if (!debugPanel) return;
        debugPanel.hidden = !isGalleryDebugPanelEnabled();
    }

    function updateGalleryDebugPanel(time = galleryLastRequestedTime ?? 0) {
        if (!galleryOverlay) return;
        syncGalleryDebugPanelVisibility();

        const debugOutput = galleryOverlay.querySelector('#sprite-gallery-debug-output');
        if (!debugOutput || !isGalleryDebugPanelEnabled()) return;

        const nextTime = normalizeGalleryTime(time);
        const offsets = getGalleryPrefetchOffsetsSeconds();
        const cacheTimes = getGallerySceneCacheTimes(nextTime);
        const queuePreview = galleryPrefetchQueue
            .slice(0, GALLERY_DEBUG_QUEUE_PREVIEW_LIMIT)
            .map((entry) => formatGalleryDebugNumber(entry))
            .join(', ');
        const cachePreview = cacheTimes
            .slice(0, GALLERY_DEBUG_CACHE_PREVIEW_LIMIT)
            .map((entry) => formatGalleryDebugNumber(entry))
            .join(', ');
        const { frameRequests, batchRequests } = getGalleryPendingRequestSummary();

        debugOutput.textContent = [
            `center: ${formatTime(nextTime)} (${formatGalleryDebugNumber(nextTime)}s) scene=${currentSceneId} scale=${getEffectiveGalleryScale()}`,
            `ui request: ${galleryActiveRequestId} prefetch generation: ${galleryPrefetchGeneration} running=${galleryPrefetchRunning}`,
            `prefetch: enabled=${isGalleryPrefetchEnabled()} offsets=[${formatGalleryDebugOffsets(offsets)}] window=${getGalleryPrefetchWindowSeconds()}s`,
            `cache: current=${hasGalleryCachedFrame(nextTime)} scene-scale=${cacheTimes.length}/${getGalleryCacheEntryLimit()} total=${galleryFrameCache.size}`,
            `pending frame requests: ${frameRequests.join(', ') || 'none'}`,
            `pending prefetch batches: ${batchRequests.join(' | ') || 'none'}`,
            `queue(${galleryPrefetchQueue.length}): ${queuePreview || 'empty'}`,
            `cached near center: ${cachePreview || 'none'}`
        ].join('\n');
    }

    // --- FRAME FETCH (HIGH-BANDWIDTH) ---
    function fetchGalleryFrameFromStream(time) {
        return new Promise((resolve) => {
            const controller = getPlaybackController();
            const video = controller?.mediaEl;
            if (!video) {
                resolve({ status: 'error', message: 'Frame unavailable' });
                return;
            }

            const timeoutId = setTimeout(() => {
                removeControllerListener(controller.eventTarget, 'seeked', onSeeked);
                removeControllerListener(controller.eventTarget, 'error', onError);
                resolve({ status: 'timeout', message: 'Loading timed out' });
            }, GALLERY_HB_SEEK_TIMEOUT_MS);

            function cleanup() {
                clearTimeout(timeoutId);
                removeControllerListener(controller.eventTarget, 'seeked', onSeeked);
                removeControllerListener(controller.eventTarget, 'error', onError);
            }

            function onSeeked() {
                cleanup();
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = video.videoWidth || 1280;
                    canvas.height = video.videoHeight || 720;
                    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
                    resolve({ status: 'ok', src: canvas.toDataURL('image/jpeg', 0.92) });
                } catch (e) {
                    resolve({ status: 'error', message: 'Frame unavailable' });
                }
            }

            function onError() {
                cleanup();
                resolve({ status: 'error', message: 'Frame unavailable' });
            }

            addControllerListener(controller.eventTarget, 'seeked', onSeeked);
            addControllerListener(controller.eventTarget, 'error', onError);
            // Seek via the videojs Player when available — its currentTime()
            // tracks the user-facing timeline. Fall back to the DOM <video>
            // element only when no Player exists (e.g., in older Stash builds
            // or tests without a videojs mock). Doing both would double-seek
            // under transcoding.
            if (controller.api && typeof controller.api.currentTime === 'function') {
                controller.api.currentTime(time);
            } else {
                video.currentTime = time;
            }
        });
    }

    function waitForGalleryVideoFrame(time, { requestId = null, controller = getPlaybackController() } = {}) {
        return new Promise((resolve) => {
            const video = controller?.mediaEl;
            if (!video) {
                resolve({ status: 'error', message: 'Frame unavailable' });
                return;
            }

            const targetTime = normalizeGalleryTime(time);
            let frameCallbackId = null;
            let frameTimerId = null;
            let settlePollTimerId = null;

            const finish = (payload) => {
                if (isSameGalleryTime(galleryControlledSeekTargetTime, targetTime)) {
                    galleryControlledSeekTargetTime = null;
                }
                clearTimeout(timeoutId);
                video.removeEventListener('loadedmetadata', onMetadata);
                video.removeEventListener('loadeddata', onReady);
                video.removeEventListener('canplay', onReady);
                video.removeEventListener('seeked', onReady);
                video.removeEventListener('timeupdate', onReady);
                video.removeEventListener('error', onError);
                if (frameCallbackId !== null && typeof video.cancelVideoFrameCallback === 'function') {
                    video.cancelVideoFrameCallback(frameCallbackId);
                }
                if (frameTimerId !== null) {
                    clearTimeout(frameTimerId);
                }
                if (settlePollTimerId !== null) {
                    clearTimeout(settlePollTimerId);
                }
                resolve(payload);
            };

            const isCancelled = () => requestId !== null && galleryActiveRequestId !== requestId;
            const hasReadyFrame = () => {
                const readyState = Number.isFinite(video.readyState)
                    ? video.readyState
                    : HTMLMediaElement.HAVE_ENOUGH_DATA;
                return !video.seeking
                    && readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
                    && isSameGalleryTime(normalizeGalleryTime(video.currentTime), targetTime);
            };

            const finalizeOnNextPaint = () => {
                if (!hasReadyFrame()) return false;
                if (typeof video.requestVideoFrameCallback === 'function') {
                    frameCallbackId = video.requestVideoFrameCallback(() => {
                        frameCallbackId = null;
                        if (frameTimerId !== null) {
                            clearTimeout(frameTimerId);
                            frameTimerId = null;
                        }
                        finish(isCancelled() ? { status: 'cancelled' } : { status: 'ok' });
                    });
                    frameTimerId = setTimeout(() => {
                        if (frameCallbackId !== null && typeof video.cancelVideoFrameCallback === 'function') {
                            video.cancelVideoFrameCallback(frameCallbackId);
                        }
                        frameCallbackId = null;
                        frameTimerId = null;
                        finish(isCancelled() ? { status: 'cancelled' } : { status: 'ok' });
                    }, 150);
                    return true;
                }

                frameTimerId = setTimeout(() => {
                    frameTimerId = null;
                    finish(isCancelled() ? { status: 'cancelled' } : { status: 'ok' });
                }, 0);
                return true;
            };

            const scheduleSettlePoll = () => {
                if (settlePollTimerId !== null) return;
                settlePollTimerId = setTimeout(() => {
                    settlePollTimerId = null;
                    if (isCancelled()) {
                        finish({ status: 'cancelled' });
                        return;
                    }
                    if (finalizeOnNextPaint()) return;
                    scheduleSettlePoll();
                }, 50);
            };

            const requestTargetSeek = () => {
                galleryControlledSeekTargetTime = targetTime;
                setControllerTimeSilently(controller, targetTime);
            };

            const ensureVideoLoaded = () => {
                const readyState = Number.isFinite(video.readyState)
                    ? video.readyState
                    : HTMLMediaElement.HAVE_ENOUGH_DATA;
                if (readyState >= HTMLMediaElement.HAVE_METADATA) return;
                if (typeof video.load === 'function') {
                    try {
                        video.load();
                    } catch (_) {
                        // Ignore load() failures and fall back to the normal timeout path.
                    }
                }
            };

            const onReady = () => {
                if (isCancelled()) {
                    finish({ status: 'cancelled' });
                    return;
                }
                if (finalizeOnNextPaint()) return;
                requestTargetSeek();
                scheduleSettlePoll();
            };

            const onMetadata = () => {
                if (isCancelled()) {
                    finish({ status: 'cancelled' });
                    return;
                }
                requestTargetSeek();
                if (finalizeOnNextPaint()) return;
                scheduleSettlePoll();
            };

            const onError = () => {
                finish({ status: 'error', message: 'Frame unavailable' });
            };

            const timeoutId = setTimeout(() => {
                finish({ status: 'timeout', message: 'Loading timed out' });
            }, GALLERY_HB_SEEK_TIMEOUT_MS);

            video.addEventListener('loadedmetadata', onMetadata);
            video.addEventListener('loadeddata', onReady);
            video.addEventListener('canplay', onReady);
            video.addEventListener('seeked', onReady);
            video.addEventListener('timeupdate', onReady);
            video.addEventListener('error', onError);

            const readyState = Number.isFinite(video.readyState)
                ? video.readyState
                : HTMLMediaElement.HAVE_ENOUGH_DATA;
            if (readyState >= HTMLMediaElement.HAVE_METADATA) {
                requestTargetSeek();
                if (!finalizeOnNextPaint()) {
                    scheduleSettlePoll();
                }
                return;
            }

            ensureVideoLoaded();
            if (!finalizeOnNextPaint() && readyState < HTMLMediaElement.HAVE_METADATA) {
                return;
            }
        });
    }

    // --- SOCKET & FRAME FETCH ---
    function getGalleryPrefetchBatchTimeoutMs(times) {
        const frameCount = Array.isArray(times) ? times.length : 0;
        return Math.max(
            GALLERY_PREFETCH_BATCH_TIMEOUT_MIN_MS,
            SEEK_TIMEOUT_MS + (frameCount * GALLERY_PREFETCH_BATCH_TIMEOUT_PER_FRAME_MS)
        );
    }

    function resolveGallerySocketRequest(requestId, payload) {
        const request = gallerySocketRequests.get(requestId);
        if (!request) return;
        clearTimeout(request.timeoutId);
        gallerySocketRequests.delete(requestId);
        updateGalleryDebugPanel();
        request.resolve(payload);
    }

    function failGallerySocketRequests(message = 'Frame unavailable') {
        const pending = Array.from(gallerySocketRequests.entries());
        gallerySocketRequests.clear();
        pending.forEach(([, request]) => {
            clearTimeout(request.timeoutId);
            if (request.kind === 'prefetch_batch') {
                request.resolve({ status: 'error', results: [], message });
                return;
            }
            request.resolve({ status: 'error', message });
        });
        updateGalleryDebugPanel();
    }

    function handleGallerySocketMessage(data) {
        if (data instanceof Blob) {
            const reader = new FileReader();
            reader.onload = () => {
                const frameRequestEntry = Array.from(gallerySocketRequests.entries())
                    .find(([, request]) => request.kind === 'frame');
                if (!frameRequestEntry) return;
                resolveGallerySocketRequest(frameRequestEntry[0], { status: 'ok', src: reader.result });
            };
            reader.onerror = () => {
                const frameRequestEntry = Array.from(gallerySocketRequests.entries())
                    .find(([, request]) => request.kind === 'frame');
                if (!frameRequestEntry) return;
                resolveGallerySocketRequest(frameRequestEntry[0], { status: 'error', message: 'Frame unavailable' });
            };
            reader.readAsDataURL(data);
            return;
        }

        let payload;
        try {
            payload = JSON.parse(data);
        } catch (_) {
            failGallerySocketRequests('Frame unavailable');
            return;
        }

        if (payload.type === 'frame_result') {
            const request = gallerySocketRequests.get(payload.request_id);
            if (!request) return;

            if (request.kind === 'prefetch_batch') {
                const timeKey = getGalleryTimeRequestKey(payload.t);
                request.pendingKeys.delete(timeKey);
                if (payload.ok && payload.image) {
                    const src = getGalleryRequestDataUrl(payload.image);
                    if (!request.resultKeys.has(timeKey)) {
                        request.resultKeys.add(timeKey);
                        request.results.push({ time: payload.t, src });
                    }
                    storeGalleryCachedFrame(payload.t, src);
                    updateGalleryJumpButtons();
                }
                updateGalleryDebugPanel();
                if (request.pendingKeys.size === 0) {
                    resolveGallerySocketRequest(payload.request_id, { status: 'ok', results: request.results });
                }
                return;
            }

            resolveGallerySocketRequest(payload.request_id, payload.ok && payload.image
                ? { status: 'ok', src: getGalleryRequestDataUrl(payload.image) }
                : { status: 'error', message: payload.error || 'Frame unavailable' });
            return;
        }

        if (payload.type === 'batch_done') {
            const request = gallerySocketRequests.get(payload.request_id);
            if (!request || request.kind !== 'prefetch_batch') return;
            resolveGallerySocketRequest(payload.request_id, { status: 'ok', results: request.results });
            return;
        }

        if (payload.type === 'frame_error') {
            resolveGallerySocketRequest(payload.request_id, {
                status: 'error',
                message: payload.error || 'Frame unavailable'
            });
            return;
        }

        if (payload.error) {
            const frameRequestEntry = Array.from(gallerySocketRequests.entries())
                .find(([, request]) => request.kind === 'frame');
            if (!frameRequestEntry) return;
            resolveGallerySocketRequest(frameRequestEntry[0], {
                status: 'error',
                message: payload.error || 'Frame unavailable'
            });
        }
    }

    function getGallerySocketUrl() {
        const port = pluginSettings.lb_frame_server_port;
        const host = pluginSettings.lb_frame_server_host;
        const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsHost = host || `${location.hostname}:${port}`;
        return `${wsProto}//${wsHost}`;
    }

    function ensureGallerySocket() {
        if (galleryActiveSocket?.readyState === WebSocket.OPEN) {
            return Promise.resolve(galleryActiveSocket);
        }
        if (gallerySocketReadyPromise) {
            return gallerySocketReadyPromise;
        }

        gallerySocketReadyPromise = new Promise((resolve, reject) => {
            const ws = new WebSocket(getGallerySocketUrl());
            galleryActiveSocket = ws;

            ws.onopen = () => {
                gallerySocketReadyPromise = null;
                resolve(ws);
            };

            ws.onmessage = (event) => {
                handleGallerySocketMessage(event.data);
            };

            ws.onerror = () => {
                // Let onclose normalize the failure path.
            };

            ws.onclose = () => {
                const wasConnecting = gallerySocketReadyPromise !== null;
                galleryActiveSocket = null;
                gallerySocketReadyPromise = null;
                failGallerySocketRequests('Frame unavailable');
                if (wasConnecting) {
                    reject(new Error('Gallery socket closed'));
                }
            };
        });

        return gallerySocketReadyPromise;
    }

    function fetchGalleryFrameData(time, {
        requestId = null,
        scale = getGalleryResolutionScale()
    } = {}) {
        if (!isLowBandwidthMode()) {
            return fetchGalleryFrameFromStream(normalizeGalleryTime(time))
                .then((result) => {
                    if (requestId !== null && galleryActiveRequestId !== requestId) {
                        return { status: 'cancelled' };
                    }
                    return result;
                });
        }

        const nextTime = normalizeGalleryTime(time);
        const socketRequestId = `frame-${++gallerySocketRequestSeq}`;

        return new Promise((resolve) => {
            const timeoutId = setTimeout(() => {
                resolveGallerySocketRequest(socketRequestId, {
                    status: 'timeout',
                    message: 'Loading timed out'
                });
            }, SEEK_TIMEOUT_MS);

            gallerySocketRequests.set(socketRequestId, {
                kind: 'frame',
                timeoutId,
                resolve
            });
            updateGalleryDebugPanel(nextTime);

            ensureGallerySocket()
                .then((ws) => {
                    if (galleryActiveRequestId !== requestId) {
                        resolveGallerySocketRequest(socketRequestId, { status: 'cancelled' });
                        return;
                    }
                    ws.send(JSON.stringify({
                        type: 'frame',
                        request_id: socketRequestId,
                        scene_id: currentSceneId,
                        t: nextTime,
                        scale
                    }));
                })
                .catch(() => {
                    resolveGallerySocketRequest(socketRequestId, {
                        status: 'error',
                        message: 'Frame unavailable'
                    });
                });
        });
    }

    // --- PREFETCH ---
    function buildGalleryPrefetchQueue(centerTime) {
        if (!isGalleryPrefetchEnabled()) return [];

        const offsets = Array.from(new Set([
            ...getGalleryPrefetchOffsetsSeconds(),
            ...GALLERY_FORWARD_CONTROL_PREFETCH_OFFSETS,
            ...GALLERY_BACKWARD_CONTROL_PREFETCH_OFFSETS
        ])).sort((a, b) => a - b);
        const candidates = new Map();

        offsets.forEach((offset) => {
            const maxDistance = Math.floor(getGalleryPrefetchWindowSeconds() / offset);
            for (let distance = 1; distance <= maxDistance; distance += 1) {
                [-1, 1].forEach((direction) => {
                    const targetTime = clampGalleryTime(centerTime + (distance * offset * direction));
                    const key = getGalleryCacheKey(targetTime);
                    if (!key || candidates.has(key) || hasGalleryCachedFrame(targetTime) || isSameGalleryTime(targetTime, centerTime)) {
                        return;
                    }
                    const delta = targetTime - centerTime;
                    const isForwardControl = delta > 0
                        && GALLERY_FORWARD_CONTROL_PREFETCH_OFFSETS.some((controlOffset) => isSameGalleryTime(controlOffset, delta));
                    const isBackwardControl = delta < 0
                        && GALLERY_BACKWARD_CONTROL_PREFETCH_OFFSETS.some((controlOffset) => isSameGalleryTime(controlOffset, Math.abs(delta)));
                    candidates.set(key, {
                        time: targetTime,
                        delta,
                        distance: Math.abs(targetTime - centerTime),
                        phase: isForwardControl ? 0 : (isBackwardControl ? 1 : 2),
                        priorityIndex: isForwardControl
                            ? getGalleryPrefetchPriorityIndex(delta, GALLERY_FORWARD_CONTROL_PREFETCH_OFFSETS)
                            : (isBackwardControl
                                ? getGalleryPrefetchPriorityIndex(delta, GALLERY_BACKWARD_CONTROL_PREFETCH_OFFSETS)
                                : getGalleryPrefetchPriorityIndex(delta, offsets))
                    });
                });
            }
        });

        return Array.from(candidates.values())
            .sort((a, b) => {
                if (a.phase !== b.phase) return a.phase - b.phase;
                if (a.phase !== 2) {
                    return a.priorityIndex - b.priorityIndex || a.time - b.time;
                }
                const aForward = a.delta > 0 ? 0 : 1;
                const bForward = b.delta > 0 ? 0 : 1;
                return a.distance - b.distance || aForward - bForward || a.priorityIndex - b.priorityIndex || a.time - b.time;
            })
            .map((candidate) => candidate.time);
    }

    async function runGalleryPrefetchQueue(generation) {
        if (galleryPrefetchRunning) return;
        galleryPrefetchRunning = true;

        try {
            while (generation === galleryPrefetchGeneration && galleryOverlay && galleryPrefetchQueue.length > 0) {
                const batchTimes = [];
                while (galleryPrefetchQueue.length > 0 && batchTimes.length < GALLERY_PREFETCH_BATCH_SIZE) {
                    const nextTime = galleryPrefetchQueue.shift();
                    if (hasGalleryCachedFrame(nextTime)) continue;
                    batchTimes.push(nextTime);
                }
                if (batchTimes.length === 0) continue;

                const result = await fetchGalleryPrefetchBatch(batchTimes, generation);
                if (generation !== galleryPrefetchGeneration) break;
                if (result.status === 'ok') {
                    result.results.forEach(({ time, src }) => {
                        storeGalleryCachedFrame(time, src);
                    });
                    updateGalleryJumpButtons();
                }
            }
        } finally {
            if (generation === galleryPrefetchGeneration) {
                galleryPrefetchRunning = false;
            }
        }
    }

    function getGalleryPrefetchContextKey() {
        return `${currentSceneId}::${getEffectiveGalleryScale()}`;
    }

    function hasActiveGalleryPrefetchRequests() {
        return Array.from(gallerySocketRequests.values())
            .some((request) => request.kind === 'prefetch_batch');
    }

    function getGalleryImmediateForwardPrefetchTimes(centerTime) {
        const nextTime = normalizeGalleryTime(centerTime);
        const uniqueTimes = new Map();
        GALLERY_FORWARD_CONTROL_PREFETCH_OFFSETS.forEach((offset) => {
            const targetTime = clampGalleryTime(nextTime + offset);
            if (isSameGalleryTime(targetTime, nextTime)) return;
            const key = getGalleryTimeRequestKey(targetTime);
            if (!uniqueTimes.has(key)) uniqueTimes.set(key, targetTime);
        });
        return Array.from(uniqueTimes.values());
    }

    function hasGalleryQueuedOrPendingPrefetchFrame(time) {
        const requestKey = getGalleryTimeRequestKey(time);
        if (galleryPrefetchQueue.some((queuedTime) => isSameGalleryTime(queuedTime, time))) return true;
        return Array.from(gallerySocketRequests.values())
            .filter((request) => request.kind === 'prefetch_batch')
            .some((request) => request.pendingKeys?.has(requestKey));
    }

    function canReuseGalleryPrefetch(centerTime) {
        if (!galleryOverlay || !isGalleryPrefetchEnabled()) return false;
        if (galleryPrefetchCenterTime === null || galleryPrefetchContextKey === null) return false;
        if (galleryPrefetchContextKey !== getGalleryPrefetchContextKey()) return false;
        if (galleryPrefetchQueue.length === 0 && !galleryPrefetchRunning && !hasActiveGalleryPrefetchRequests()) {
            return false;
        }
        const nextTime = normalizeGalleryTime(centerTime);
        if (Math.abs(nextTime - galleryPrefetchCenterTime) > getGalleryPrefetchWindowSeconds()) return false;
        return getGalleryImmediateForwardPrefetchTimes(nextTime).every((targetTime) => (
            hasGalleryCachedFrame(targetTime) || hasGalleryQueuedOrPendingPrefetchFrame(targetTime)
        ));
    }

    function scheduleGalleryPrefetch(centerTime, { preserveInFlight = false } = {}) {
        if (!galleryOverlay || !isGalleryPrefetchEnabled() || !isLowBandwidthMode()) {
            cancelGalleryPrefetch();
            updateGalleryJumpButtons(centerTime);
            return;
        }

        const nextTime = normalizeGalleryTime(centerTime);
        const shouldReusePrefetch = preserveInFlight && canReuseGalleryPrefetch(nextTime);
        if (!shouldReusePrefetch) cancelGalleryPrefetch();

        galleryPrefetchCenterTime = nextTime;
        galleryPrefetchContextKey = getGalleryPrefetchContextKey();
        galleryPrefetchQueue = buildGalleryPrefetchQueue(nextTime);
        updateGalleryJumpButtons(nextTime);
        if (galleryPrefetchQueue.length === 0) return;

        const generation = galleryPrefetchGeneration;
        setTimeout(() => {
            if (generation !== galleryPrefetchGeneration) return;
            runGalleryPrefetchQueue(generation);
        }, 0);
    }

    function fetchGalleryPrefetchBatch(times, generation, timeoutMs = getGalleryPrefetchBatchTimeoutMs(times)) {
        if (times.length === 0) return Promise.resolve({ status: 'cancelled', results: [] });

        const scale = getGalleryResolutionScale();
        const socketRequestId = `prefetch-${++gallerySocketRequestSeq}`;
        const pendingKeys = new Set(times.map((time) => getGalleryTimeRequestKey(time)));

        return new Promise((resolve) => {
            const timeoutId = setTimeout(() => {
                resolveGallerySocketRequest(socketRequestId, { status: 'timeout', results: [] });
            }, timeoutMs);

            gallerySocketRequests.set(socketRequestId, {
                kind: 'prefetch_batch',
                generation,
                pendingKeys,
                resultKeys: new Set(),
                results: [],
                timeoutId,
                resolve
            });
            updateGalleryDebugPanel();

            ensureGallerySocket()
                .then((ws) => {
                    if (generation !== galleryPrefetchGeneration) {
                        resolveGallerySocketRequest(socketRequestId, { status: 'cancelled', results: [] });
                        return;
                    }
                    ws.send(JSON.stringify({
                        type: 'prefetch_batch',
                        request_id: socketRequestId,
                        scene_id: currentSceneId,
                        times,
                        scale
                    }));
                })
                .catch(() => {
                    resolveGallerySocketRequest(socketRequestId, { status: 'error', results: [] });
                });
        });
    }

    // --- PLAYER SYNC ---
    function unbindGalleryPlayerEvents() {
        if (galleryBoundTargets.length === 0) return;
        galleryBoundTargets.forEach(({ target, eventName, handler }) => {
            removeControllerListener(target, eventName, handler);
        });
        galleryBoundTargets = [];
    }

    function stopGallerySyncLoop() {
        if (gallerySyncIntervalId !== null) {
            clearInterval(gallerySyncIntervalId);
            gallerySyncIntervalId = null;
        }
        galleryLastObservedPlayerTime = null;
    }

    function syncGalleryToPlayerTime(controller, force = false) {
        if (!galleryOverlay || !controller) return;

        const nextTime = getControllerTime(controller);
        galleryLastObservedPlayerTime = nextTime;
        if (_SessionEvents) _dispatchStoreEvent(_SessionEvents.controllerTimeUpdate(nextTime));
        if (shouldHoldPendingExplicitGalleryTarget(nextTime)) return;
        if (isSameGalleryTime(nextTime, galleryIgnoredPlayerTime)) {
            galleryIgnoredPlayerTime = null;
            galleryLastRequestedTime = nextTime;
            return;
        }

        if (!force && isSameGalleryTime(nextTime, galleryLastRequestedTime)) return;

        if (!isControllerPaused(controller)) {
            pauseController(controller);
        }
        showGalleryFrame(nextTime, formatTime(nextTime));
    }

    function markGallerySeeking(controller) {
        if (!galleryOverlay || !controller) return;
        if (galleryControlledSeekTargetTime !== null) return;
        const nextTime = getControllerTime(controller);
        if (_SessionEvents) _dispatchStoreEvent(_SessionEvents.controllerSeeking(nextTime));
        if (shouldHoldPendingExplicitGalleryTarget(nextTime)) return;
        if (isSameGalleryTime(nextTime, galleryIgnoredPlayerTime)) return;
        cancelActiveGalleryRequest();
        cancelGalleryPrefetch();
        setGalleryLoadingState(nextTime);
    }

    function syncGalleryFromControllerState(controller) {
        if (!galleryOverlay || !controller) return;

        const nextTime = getControllerTime(controller);
        if (
            galleryControlledSeekTargetTime !== null
            && isSameGalleryTime(nextTime, galleryControlledSeekTargetTime)
        ) {
            galleryLastObservedPlayerTime = nextTime;
            galleryControlledSeekTargetTime = null;
            return;
        }
        if (isSameGalleryTime(nextTime, galleryLastObservedPlayerTime)) return;
        galleryLastObservedPlayerTime = nextTime;

        if (shouldHoldPendingExplicitGalleryTarget(nextTime)) return;

        if (isSameGalleryTime(nextTime, galleryIgnoredPlayerTime)) {
            galleryIgnoredPlayerTime = null;
            galleryLastRequestedTime = nextTime;
            return;
        }

        if (controller.mediaEl?.seeking) {
            markGallerySeeking(controller);
            return;
        }

        syncGalleryToPlayerTime(controller);
    }

    function startGallerySyncLoop(controller) {
        stopGallerySyncLoop();
        if (!controller) return;

        galleryLastObservedPlayerTime = getControllerTime(controller);
        gallerySyncIntervalId = setInterval(() => {
            syncGalleryFromControllerState(controller);
        }, GALLERY_SYNC_INTERVAL_MS);
    }

    function bindGalleryPlayerEvents(controller) {
        if (!controller) return;
        const targets = [controller.eventTarget, controller.mediaEl].filter(Boolean)
            .filter((target, index, array) => array.indexOf(target) === index);
        if (targets.length === 0) return;

        const boundTargetSet = new Set(galleryBoundTargets.map((binding) => binding.target));
        const sameTargets = boundTargetSet.size === targets.length &&
            targets.every((target) => boundTargetSet.has(target));
        if (sameTargets) {
            if (gallerySyncIntervalId === null) startGallerySyncLoop(controller);
            return;
        }

        unbindGalleryPlayerEvents();
        startGallerySyncLoop(controller);

        const onSeeked = () => syncGalleryToPlayerTime(controller);
        const onTimeUpdate = () => {
            if (controller.mediaEl?.seeking) return;
            syncGalleryToPlayerTime(controller);
        };
        const onSeeking = () => markGallerySeeking(controller);
        const onPlay = () => { pauseController(controller); };

        [
            ['seeking', onSeeking],
            ['seeked', onSeeked],
            ['timeupdate', onTimeUpdate],
            ['play', onPlay]
        ].forEach(([eventName, handler]) => {
            targets.forEach((target) => {
                addControllerListener(target, eventName, handler);
                galleryBoundTargets.push({ target, eventName, handler });
            });
        });
    }

    // --- CORE ENTRY POINTS ---
    function showGalleryAtTime(time) {
        galleryActive = true;
        document.getElementById(GALLERY_BUTTON_ID)?.classList.add('active');
        const controller = getPlaybackController();
        const nextTime = normalizeGalleryTime(time);

        if (controller) {
            bindGalleryPlayerEvents(controller);
            pauseController(controller);
            const currentControllerTime = getControllerTime(controller);
            if (!isSameGalleryTime(currentControllerTime, nextTime)) {
                galleryIgnoredPlayerTime = nextTime;
                galleryPendingExplicitSourceTime = currentControllerTime;
                galleryPendingExplicitTargetTime = nextTime;
                galleryControlledSeekTargetTime = nextTime;
                setControllerTime(controller, nextTime);
            } else {
                galleryIgnoredPlayerTime = null;
                clearPendingExplicitGalleryTarget(nextTime);
                galleryControlledSeekTargetTime = null;
            }
        }

        if (_SessionEvents) _dispatchStoreEvent(_SessionEvents.seekTo(nextTime));
        return showGalleryFrame(nextTime, formatTime(nextTime));
    }

    async function showGalleryFrame(time, timeStr) {
        const videoContainer = getVideoContainer();
        if (!galleryOverlay) {
            galleryOverlay = document.createElement('div');
            galleryOverlay.id = 'sprite-gallery-overlay';

            const frame = document.createElement('div');
            frame.id = 'sprite-gallery-frame';
            frame.dataset.mobileFullscreen = 'false';
            frame.dataset.mobileRotated = 'false';
            frame.dataset.pseudoFullscreen = 'false';
            frame.onmouseenter = () => {
                if (!isPhoneSizedTouchLayout()) setGalleryControlsVisible(true);
            };
            frame.onmouseleave = () => {
                if (!isPhoneSizedTouchLayout()) setGalleryControlsVisible(false);
            };
            frame.onclick = (event) => {
                if (!isPhoneSizedTouchLayout()) return;
                if (shouldSuppressGalleryTap()) {
                    gallerySuppressTapUntil = 0;
                    return;
                }
                if (event.target instanceof Element && event.target.closest('.sprite-gallery-action-btn, .sprite-gallery-jump-btn, #sprite-gallery-scrubber, #sprite-gallery-debug')) return;
                setGalleryControlsVisible(!galleryControlsVisible);
            };

            const viewport = document.createElement('div');
            viewport.id = 'sprite-gallery-viewport';
            bindGalleryImageGestures(viewport);

            const img = document.createElement('img');
            img.id = 'sprite-gallery-img';
            img.alt = 'Gallery frame';
            img.draggable = false;
            img.onload = () => {
                applyGalleryImageTransform();
                scheduleGalleryOverlayLayoutRefresh();
            };
            viewport.appendChild(img);

            const loading = document.createElement('div');
            loading.id = 'sprite-gallery-loading';
            loading.textContent = 'Loading\u2026';
            viewport.appendChild(loading);

            const controls = document.createElement('div');
            controls.id = 'sprite-gallery-controls';

            const topRow = document.createElement('div');
            topRow.className = 'sprite-gallery-controls-row top';

            const timeEl = document.createElement('div');
            timeEl.id = 'sprite-gallery-time';
            topRow.appendChild(timeEl);

            const actions = document.createElement('div');
            actions.className = 'sprite-gallery-actions';

            const fullResolutionBtn = document.createElement('button');
            fullResolutionBtn.id = 'sprite-gallery-full-resolution';
            fullResolutionBtn.className = 'sprite-gallery-action-btn';
            fullResolutionBtn.textContent = 'Request full resolution';
            fullResolutionBtn.onclick = async (event) => {
                event.stopPropagation();
                await requestGalleryFullResolution();
            };
            actions.appendChild(fullResolutionBtn);

            const fullscreenBtn = document.createElement('button');
            fullscreenBtn.id = 'sprite-gallery-fullscreen';
            fullscreenBtn.className = 'sprite-gallery-action-btn';
            fullscreenBtn.textContent = 'Fullscreen';
            fullscreenBtn.onclick = async (event) => {
                event.stopPropagation();
                await toggleGalleryFullscreen();
            };
            actions.appendChild(fullscreenBtn);

            const closeBtn = document.createElement('button');
            closeBtn.id = 'sprite-gallery-close';
            closeBtn.className = 'sprite-gallery-action-btn';
            closeBtn.textContent = 'X';
            closeBtn.onclick = (event) => {
                event.stopPropagation();
                exitGallery();
                persistGalleryStateIfRemember();
            };
            actions.appendChild(closeBtn);
            topRow.appendChild(actions);
            controls.appendChild(topRow);

            const bottomRow = document.createElement('div');
            bottomRow.className = 'sprite-gallery-controls-row bottom';

            const jumps = document.createElement('div');
            jumps.className = 'sprite-gallery-jumps';
            GALLERY_JUMP_BUTTONS.forEach(({ id, label, delta }) => {
                const button = document.createElement('button');
                button.id = id;
                button.className = 'sprite-gallery-jump-btn';
                button.textContent = label;
                button.dataset.delta = String(delta);
                button.dataset.cached = 'false';
                button.onclick = (event) => {
                    event.stopPropagation();
                    shiftGalleryTime(delta);
                };
                jumps.appendChild(button);
            });
            bottomRow.appendChild(jumps);

            const scrubber = document.createElement('input');
            scrubber.id = 'sprite-gallery-scrubber';
            scrubber.type = 'range';
            scrubber.min = '0';
            scrubber.onselectstart = () => false;
            scrubber.ondragstart = () => false;
            scrubber.oncontextmenu = (event) => event.preventDefault();
            scrubber.oninput = (event) => {
                event.stopPropagation();
                const snappedTime = getGallerySpriteAlignedTime(parseFloat(event.target.value));
                event.target.value = String(snappedTime);
                nativeScrubberPreviewTrack = scrubber;
                updateNativeScrubberPreview();
                seekGalleryToTime(snappedTime);
            };
            scrubber.onclick = (event) => event.stopPropagation();
            bindGalleryScrubberPreview(scrubber);
            bottomRow.appendChild(scrubber);

            const debugPanel = document.createElement('details');
            debugPanel.id = 'sprite-gallery-debug';
            debugPanel.open = true;
            debugPanel.hidden = !isGalleryDebugPanelEnabled();
            const debugSummary = document.createElement('summary');
            debugSummary.textContent = 'Debug';
            debugPanel.appendChild(debugSummary);
            const debugOutput = document.createElement('pre');
            debugOutput.id = 'sprite-gallery-debug-output';
            debugPanel.appendChild(debugOutput);
            bottomRow.appendChild(debugPanel);
            controls.appendChild(bottomRow);

            frame.appendChild(viewport);
            frame.appendChild(controls);
            galleryOverlay.appendChild(frame);

            if (videoContainer) {
                videoContainer.classList.add('stash-gallery-overlay-active');
                videoContainer.appendChild(galleryOverlay);
            }
            else document.body.appendChild(galleryOverlay);

            setGalleryControlsVisible(isPhoneSizedTouchLayout());
        }

        const img = getGalleryImageElement();
        const loading = galleryOverlay.querySelector('#sprite-gallery-loading');
        const nextTime = normalizeGalleryTime(time);
        const requestId = ++galleryRequestSeq;
        const videoMode = isGalleryUsingVideoSurface();
        const controller = getPlaybackController();
        const hadVisibleFrame = galleryHasVisibleFrame;
        galleryLastRequestedTime = nextTime;
        scheduleGalleryActivitySave(nextTime);
        const preservePrefetch = canReuseGalleryPrefetch(nextTime);
        cancelActiveGalleryRequest();
        if (!preservePrefetch) cancelGalleryPrefetch();
        galleryActiveRequestId = requestId;

        galleryLastImageSrc = '';
        galleryLastImageScale = null;
        galleryHasVisibleFrame = videoMode ? hadVisibleFrame : false;
        galleryFullResolutionPending = false;
        resetGalleryImageTransform();
        if (img) img.style.display = 'none';
        loading.style.display = 'block';
        if (videoMode && hadVisibleFrame) {
            loading.classList.add('sprite-gallery-loading-corner');
            loading.textContent = '';
            loading.setAttribute('aria-label', 'Loading...');
        } else {
            loading.classList.remove('sprite-gallery-loading-corner');
            loading.textContent = 'Loading\u2026';
            loading.setAttribute('aria-label', 'Loading...');
        }
        syncGalleryRenderSurfaceState();
        updateGalleryUi(nextTime);
        scheduleGalleryOverlayLayoutRefresh();
        galleryOverlay.style.display = 'flex';

        if (videoMode) {
            const result = await waitForGalleryVideoFrame(nextTime, { requestId, controller });
            if (galleryActiveRequestId !== requestId) return;

            if (result.status === 'ok') {
                galleryHasVisibleFrame = true;
                loading.style.display = 'none';
                syncGalleryRenderSurfaceState();
                applyGalleryImageTransform();
                scheduleGalleryOverlayLayoutRefresh();
                notifyControllerTimeUpdate(controller);
            } else if (result.status !== 'cancelled') {
                loading.textContent = result.message || 'Frame unavailable';
            }

            clearPendingExplicitGalleryTarget(nextTime);
            updateGalleryActionButtons();
            scheduleGalleryPrefetch(nextTime, { preserveInFlight: true });
            return;
        }

        const cachedSrc = getGalleryCachedFrame(nextTime, currentSceneId, getEffectiveGalleryScale());
        if (cachedSrc) {
            img.src = cachedSrc;
            galleryLastImageSrc = cachedSrc;
            galleryLastImageScale = getEffectiveGalleryScale();
            galleryHasVisibleFrame = true;
            syncGalleryRenderSurfaceState();
            loading.style.display = 'none';
            clearPendingExplicitGalleryTarget(nextTime);
            updateGalleryActionButtons();
            scheduleGalleryPrefetch(nextTime, { preserveInFlight: true });
            return;
        }

        const result = await fetchGalleryFrameData(nextTime, { requestId });
        if (galleryActiveRequestId !== requestId) return;

        if (result.status === 'ok') {
            storeGalleryCachedFrame(nextTime, result.src, currentSceneId, getEffectiveGalleryScale());
            img.src = result.src;
            galleryLastImageSrc = result.src;
            galleryLastImageScale = getEffectiveGalleryScale();
            galleryHasVisibleFrame = true;
            syncGalleryRenderSurfaceState();
            loading.style.display = 'none';
        } else if (result.status !== 'cancelled') {
            galleryLastImageSrc = '';
            galleryLastImageScale = null;
            galleryHasVisibleFrame = false;
            loading.textContent = result.message || 'Frame unavailable';
        }

        clearPendingExplicitGalleryTarget(nextTime);
        updateGalleryActionButtons();
        scheduleGalleryPrefetch(nextTime, { preserveInFlight: true });
    }

    function exitGallery() {
        galleryActive = false;
        if (_SessionEvents) _dispatchStoreEvent(_SessionEvents.exitGallery());
        document.getElementById(GALLERY_BUTTON_ID)?.classList.remove('active');
        if (getGalleryFullscreenElement() || galleryPseudoFullscreen) {
            exitGalleryFullscreen();
        }
        cancelActiveGalleryRequest();
        cancelGalleryPrefetch();
        closeGallerySocket();
        flushGalleryActivitySave();
        const lastTime = galleryLastRequestedTime;
        const exitController = getPlaybackController();
        if (exitController && lastTime !== null
            && !isSameGalleryTime(getControllerTime(exitController), lastTime)) {
            setControllerTime(exitController, lastTime);
        }
        galleryLastRequestedTime = null;
        stopGallerySyncLoop();
        galleryIgnoredPlayerTime = null;
        galleryPendingExplicitTargetTime = null;
        galleryPendingExplicitSourceTime = null;
        galleryControlledSeekTargetTime = null;
        galleryControlsVisible = false;
        galleryLastImageSrc = '';
        galleryLastImageScale = null;
        galleryHasVisibleFrame = false;
        galleryFullResolutionPending = false;
        galleryPseudoFullscreen = false;
        if (externalScrubberSyncTimeoutId !== null) {
            clearTimeout(externalScrubberSyncTimeoutId);
            externalScrubberSyncTimeoutId = null;
        }
        cancelNativeScrubberPreviewClear();
        clearGalleryOverlayLayoutRefresh();
        resetGalleryImageTransform();
        clearGalleryRenderSurfaceState();
        syncGalleryScrollLock(false);
        unlockGalleryOrientation();
        unbindGalleryPlayerEvents();
        if (galleryOverlay) {
            galleryOverlay.parentElement?.classList.remove('stash-gallery-overlay-active');
            galleryOverlay.classList.remove('gallery-overlay-fullscreen');
            galleryOverlay.remove();
            galleryOverlay = null;
        }
    }

    // --- GALLERY STYLES ---
    function injectGalleryStyles() {
        const existing = document.getElementById('stash-gallery-css');
        if (existing) existing.remove();

        const style = document.createElement('style');
        style.id = 'stash-gallery-css';
        style.textContent = `
            /* Pop-up sprite preview */
            #stash-sprite-preview {
                position: fixed;
                width: ${DEFAULT_PREVIEW_WIDTH}px;
                aspect-ratio: 16/9;
                background-repeat: no-repeat;
                background-color: #000;
                border: 2px solid #fff;
                box-shadow: 0 4px 15px rgba(0,0,0,0.8);
                z-index: 10000;
                pointer-events: none;
                display: none;
                border-radius: 4px;
            }
            /* Gallery toolbar button */
            #gallery-mode-btn svg {
                width: 1.5em;
                height: 1.5em;
                vertical-align: middle;
            }
            #gallery-mode-btn.active {
                color: #c9a227 !important;
            }
            #stash-sprite-preview .preview-time {
                position: absolute;
                bottom: 5px;
                right: 5px;
                background: rgba(0,0,0,0.8);
                color: #fff;
                font-size: 14px;
                padding: 2px 6px;
                border-radius: 4px;
                font-weight: bold;
            }
            .stash-gallery-overlay-active {
                clip-path: inset(0);
            }
            /* Gallery overlay */
            #sprite-gallery-overlay {
                position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: #000;
                display: flex; align-items: center; justify-content: center;
                box-sizing: border-box;
                overflow: hidden;
            }
            #sprite-gallery-overlay.gallery-overlay-video-mode {
                background: transparent;
            }
            #sprite-gallery-overlay.gallery-overlay-fullscreen {
                position: fixed;
                inset: 0;
                z-index: 2147483647;
            }
            .stash-gallery-container-fullscreen {
                position: fixed !important;
                inset: 0 !important;
                z-index: 2147483647 !important;
                width: 100vw !important;
                height: 100dvh !important;
                height: 100vh !important;
                background: #000 !important;
            }
            @supports (height: 100dvh) {
                .stash-gallery-container-fullscreen {
                    height: 100dvh !important;
                }
            }
            html.stash-gallery-scroll-lock,
            body.stash-gallery-scroll-lock {
                overflow: hidden !important;
                overscroll-behavior: none;
            }
            html.stash-gallery-scroll-soft-lock,
            body.stash-gallery-scroll-soft-lock {
                overflow-x: hidden !important;
                overflow-y: auto !important;
                overscroll-behavior-x: none;
            }
            body.stash-gallery-scroll-soft-lock {
                min-height: calc(100% + 240px);
                padding-bottom: 240px;
                box-sizing: border-box;
                -webkit-overflow-scrolling: touch;
            }
            #sprite-gallery-frame {
                position: relative;
                width: 100%;
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                overflow: hidden;
            }
            #sprite-gallery-viewport {
                position: absolute;
                inset: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                overflow: hidden;
                touch-action: none;
                overscroll-behavior: contain;
            }
            .stash-gallery-player-gallery-active .vjs-control-bar,
            .stash-gallery-player-gallery-active .vjs-progress-control {
                opacity: 0 !important;
                pointer-events: none !important;
            }
            .stash-gallery-player-gallery-active > :not(#sprite-gallery-overlay):not(video.vjs-tech):not(.vjs-tech) {
                opacity: 0 !important;
                visibility: hidden !important;
                pointer-events: none !important;
            }
            #sprite-gallery-overlay img {
                max-width: 100%; max-height: 100%; object-fit: contain; display: block;
                transform-origin: center center;
                will-change: transform;
                -webkit-user-drag: none;
                user-select: none;
                pointer-events: none;
            }
            video.stash-gallery-video-active,
            .stash-gallery-player-gallery-active video.vjs-tech {
                position: absolute !important;
                inset: 0;
                width: 100% !important;
                height: 100% !important;
                max-width: 100%;
                max-height: 100%;
                object-fit: contain;
                transform-origin: center center;
                will-change: transform;
                pointer-events: none;
                z-index: 1;
            }
            #sprite-gallery-controls {
                position: absolute;
                inset: 0;
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                padding: 10px;
                box-sizing: border-box;
                opacity: 0;
                pointer-events: none;
                z-index: 2;
                transition: opacity 0.15s ease;
            }
            #sprite-gallery-controls.gallery-controls-visible {
                opacity: 1;
            }
            #sprite-gallery-controls:not(.gallery-controls-visible) .sprite-gallery-action-btn,
            #sprite-gallery-controls:not(.gallery-controls-visible) .sprite-gallery-jump-btn,
            #sprite-gallery-controls:not(.gallery-controls-visible) #sprite-gallery-scrubber,
            #sprite-gallery-controls:not(.gallery-controls-visible) #sprite-gallery-debug {
                pointer-events: none;
            }
            #sprite-gallery-controls.gallery-controls-visible .sprite-gallery-action-btn,
            #sprite-gallery-controls.gallery-controls-visible .sprite-gallery-jump-btn,
            #sprite-gallery-controls.gallery-controls-visible #sprite-gallery-scrubber,
            #sprite-gallery-controls.gallery-controls-visible #sprite-gallery-debug {
                pointer-events: auto;
            }
            .sprite-gallery-controls-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                box-sizing: border-box;
                pointer-events: none;
            }
            .sprite-gallery-controls-row.top {
                position: absolute;
                top: 10px;
                left: 10px;
                right: 10px;
                width: auto;
                align-items: flex-start;
            }
            .sprite-gallery-controls-row.bottom {
                position: absolute;
                left: 50%;
                bottom: calc(var(--gallery-controls-offset, 0px) + 10px);
                transform: translateX(-50%);
                width: min(calc(100% - 24px), 760px);
                flex-direction: column;
                align-items: center;
                justify-content: center;
                flex-wrap: wrap;
                gap: 6px;
            }
            #sprite-gallery-loading {
                position: absolute;
                color: #fff;
                font-size: 16px;
                background: rgba(0,0,0,0.75);
                padding: 6px 10px;
                border-radius: 6px;
                pointer-events: none;
            }
            #sprite-gallery-loading.sprite-gallery-loading-corner {
                bottom: calc(var(--gallery-controls-offset, 0px) + 12px);
                right: 12px;
                left: auto;
                width: 18px;
                height: 18px;
                padding: 0;
                border-radius: 999px;
                background: rgba(0,0,0,0.45);
                border: 2px solid rgba(255,255,255,0.25);
                border-top-color: rgba(255,255,255,0.95);
                box-shadow: 0 0 0 1px rgba(0,0,0,0.2);
                animation: sprite-gallery-loading-spin 0.8s linear infinite;
            }
            @keyframes sprite-gallery-loading-spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
            .gallery-mode-checkbox-label {
                display: flex; align-items: center; gap: 6px;
                color: #ccc; font-size: 12px; cursor: pointer; white-space: nowrap;
                margin-right: 10px;
            }
            .sprite-gallery-actions,
            .sprite-gallery-jumps {
                display: flex;
                align-items: center;
                gap: 6px;
                flex-wrap: wrap;
            }
            .sprite-gallery-actions {
                margin-left: auto;
                justify-content: flex-end;
            }
            .sprite-gallery-jumps {
                justify-content: center;
                width: 100%;
            }
            .sprite-gallery-action-btn,
            .sprite-gallery-jump-btn {
                background: rgba(12,12,12,0.88);
                color: #fff;
                border: 1px solid rgba(255,255,255,0.72);
                border-radius: 999px;
                padding: 7px 12px;
                cursor: pointer;
                font-size: 15px !important;
                font-weight: 600;
                line-height: 1.2 !important;
                box-shadow: 0 4px 12px rgba(0,0,0,0.32);
                text-shadow: 0 1px 2px rgba(0,0,0,0.65);
            }
            .sprite-gallery-action-btn:disabled,
            .sprite-gallery-jump-btn:disabled {
                opacity: 0.45;
                cursor: default;
            }
            .sprite-gallery-jump-btn.sprite-gallery-jump-btn-cached:not(:disabled) {
                background: rgba(156, 112, 19, 0.95);
                color: #fff6d6;
                border-color: rgba(255, 224, 138, 0.95);
                box-shadow: 0 0 0 1px rgba(255, 214, 102, 0.24), 0 6px 16px rgba(89, 57, 0, 0.45);
            }
            #sprite-gallery-time {
                background: rgba(0,0,0,0.8); color: #fff; font-size: 17px !important;
                padding: 7px 12px; border-radius: 999px; font-weight: bold;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            }
            #sprite-gallery-scrubber {
                display: block;
                flex: none;
                width: min(100%, 520px);
                min-width: 180px;
                max-height: 20px;
                accent-color: #fff;
                height: 20px;
                -webkit-appearance: none;
                appearance: none;
                writing-mode: horizontal-tb;
                background: transparent;
                -webkit-user-select: none;
                user-select: none;
                -webkit-touch-callout: none;
                -webkit-tap-highlight-color: transparent;
                touch-action: none;
            }
            #sprite-gallery-scrubber::-webkit-slider-runnable-track {
                height: 6px;
                border-radius: 999px;
                background: rgba(255,255,255,0.45);
            }
            #sprite-gallery-scrubber::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 16px;
                height: 16px;
                margin-top: -6px;
                border-radius: 50%;
                border: 1px solid rgba(0,0,0,0.55);
                background: #fff;
                box-shadow: 0 2px 6px rgba(0,0,0,0.35);
            }
            #sprite-gallery-scrubber::-moz-range-track {
                height: 6px;
                border-radius: 999px;
                background: rgba(255,255,255,0.45);
            }
            #sprite-gallery-scrubber::-moz-range-thumb {
                width: 16px;
                height: 16px;
                border-radius: 50%;
                border: 1px solid rgba(0,0,0,0.55);
                background: #fff;
                box-shadow: 0 2px 6px rgba(0,0,0,0.35);
            }
            #sprite-gallery-debug {
                width: min(100%, 760px);
                border-radius: 12px;
                background: rgba(8,8,8,0.9);
                border: 1px solid rgba(255,255,255,0.12);
                box-shadow: 0 8px 24px rgba(0,0,0,0.28);
                color: #f3f0de;
                font-family: monospace;
                font-size: 12px;
                overflow: hidden;
            }
            #sprite-gallery-debug summary {
                cursor: pointer;
                list-style: none;
                padding: 8px 10px;
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 0.04em;
                text-transform: uppercase;
                background: rgba(255,255,255,0.06);
                color: #f8e6a6;
            }
            #sprite-gallery-debug summary::-webkit-details-marker {
                display: none;
            }
            #sprite-gallery-debug-output {
                margin: 0;
                padding: 10px;
                max-height: 180px;
                overflow: auto;
                white-space: pre-wrap;
                word-break: break-word;
                line-height: 1.45;
            }
            #sprite-gallery-frame:fullscreen,
            #sprite-gallery-frame:-webkit-full-screen,
            #sprite-gallery-frame:-moz-full-screen,
            #sprite-gallery-frame:-ms-fullscreen {
                width: 100vw;
                height: 100vh;
                background: #000;
            }
            #sprite-gallery-frame.gallery-pseudo-fullscreen {
                width: 100vw;
                height: 100dvh;
                height: 100vh;
                background: #000;
            }
            @supports (height: 100dvh) {
                #sprite-gallery-frame.gallery-pseudo-fullscreen {
                    height: 100dvh;
                }
            }
            .gallery-overlay-video-mode #sprite-gallery-frame.gallery-pseudo-fullscreen {
                background: transparent;
            }
            @media (max-width: 767px) {
                #sprite-gallery-debug {
                    display: none;
                }
                #sprite-gallery-controls {
                    padding: 12px;
                }
                .sprite-gallery-controls-row.top {
                    left: 12px;
                    right: 12px;
                }
                .sprite-gallery-controls-row.bottom {
                    bottom: calc(var(--gallery-controls-offset, 0px) + 10px);
                    width: calc(100% - 24px);
                }
                .sprite-gallery-jumps {
                    justify-content: center;
                    width: 100%;
                }
                .sprite-gallery-actions {
                    width: auto;
                    justify-content: flex-end;
                }
                #sprite-gallery-frame.gallery-mobile-fullscreen #sprite-gallery-controls {
                    padding: 16px 20px;
                }
                #sprite-gallery-frame.gallery-mobile-fullscreen .sprite-gallery-controls-row.bottom {
                    bottom: 12px;
                    width: auto;
                    max-width: calc(100% - 40px);
                    gap: 8px;
                }
                #sprite-gallery-frame.gallery-mobile-fullscreen .sprite-gallery-jumps {
                    width: auto;
                    max-width: 100%;
                }
                #sprite-gallery-frame.gallery-mobile-fullscreen #sprite-gallery-scrubber {
                    width: min(100%, 280px);
                }
                #sprite-gallery-frame.gallery-mobile-fullscreen .sprite-gallery-action-btn,
                #sprite-gallery-frame.gallery-mobile-fullscreen .sprite-gallery-jump-btn,
                #sprite-gallery-frame.gallery-mobile-fullscreen #sprite-gallery-time {
                    font-size: 13px !important;
                    padding: 6px 10px;
                }
                #sprite-gallery-frame.gallery-mobile-fullscreen #sprite-gallery-debug {
                    display: none;
                }
                #sprite-gallery-frame.gallery-mobile-fullscreen #sprite-gallery-img {
                    width: 100dvw;
                    height: 100dvh;
                    max-width: 100dvw;
                    max-height: 100dvh;
                    object-fit: contain;
                    object-position: center center;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // --- GALLERY TOOLBAR BUTTON ---
    const GALLERY_BUTTON_ID = 'gallery-mode-btn';
    const GALLERY_BUTTON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"/><circle cx="8.5" cy="9.5" r="2"/><path d="M21 15l-5-5L5 21"/></svg>';

    function toggleGalleryMode() {
        if (galleryActive) {
            exitGallery();
        } else {
            const controller = getPlaybackController();
            const time = controller ? getControllerTime(controller) : 0;
            showGalleryAtTime(time);
        }
        persistGalleryStateIfRemember();
    }

    function syncGalleryToolbarButtonState() {
        const btn = document.getElementById(GALLERY_BUTTON_ID);
        if (!btn) return;
        btn.classList.toggle('active', isGalleryModeOn() && galleryOverlay !== null);
    }

    function injectGalleryToolbarButton() {
        const controlBar = document.querySelector('.vjs-control-bar');
        if (!controlBar) return false;
        if (document.getElementById(GALLERY_BUTTON_ID)) return true;

        const btn = document.createElement('button');
        btn.id = GALLERY_BUTTON_ID;
        btn.type = 'button';
        btn.className = 'vjs-control vjs-button';
        btn.title = 'Gallery Mode';
        btn.innerHTML = GALLERY_BUTTON_SVG
            + '<span class="vjs-control-text">Gallery Mode</span>';
        btn.addEventListener('click', toggleGalleryMode);
        if (isGalleryModeOn()) btn.classList.add('active');

        const findRef = (selector) => {
            const target = controlBar.querySelector(selector);
            if (!target) return null;
            let ref = target;
            while (ref.parentElement !== controlBar) ref = ref.parentElement;
            return ref;
        };
        const ref = findRef('.vjs-playback-rate') ?? findRef('.vjs-fullscreen-control');
        if (ref) {
            controlBar.insertBefore(btn, ref);
        } else {
            controlBar.appendChild(btn);
        }
        return true;
    }

    // Reconcile the gallery overlay with the authoritative Default Mode setting.
    // Mirrors TheaterMode's applyInitialState: scene-page guard, always_off clears
    // any stale saved state, remember restores the last user toggle.
    function applyInitialState() {
        if (!/\/scenes\/\d+/.test(window.location.pathname)) return;
        if (defaultMode === 'always_off') {
            setSavedGalleryState(false);
            return;
        }
        const shouldOpen = defaultMode === 'always_on'
            || (defaultMode === 'remember' && getSavedGalleryState());
        if (!shouldOpen) return;
        const controller = getPlaybackController();
        const time = controller ? getControllerTime(controller) : 0;
        showGalleryAtTime(time);
    }

    // --- INITIALIZATION ---
    async function init(sceneId) {
        if (currentSceneId === sceneId && galleryInitialized) return;

        if (currentSceneId !== sceneId) {
            // Reset any leftover overlay from the previous scene so
            // applyInitialState starts from a clean baseline.
            if (currentSceneId !== null) {
                exitGallery();
            }
            clearGalleryFrameCache();
            cancelGalleryPrefetch();
            closeGallerySocket();
        }
        currentSceneId = sceneId;
        galleryInitialized = true;

        await loadPluginSettings();
        bindExternalScrubberCompatibility();
        injectGalleryStyles();

        // Fetch scene data for duration info
        const data = await getSceneData(sceneId);
        if (data) currentSceneData = data;

        // Bind spritetab:cellactivate listener once
        if (!spritetabListenerBound) {
            document.addEventListener('spritetab:cellactivate', (e) => {
                if (!isGalleryModeOn()) return;
                e.preventDefault();
                showGalleryAtTime(e.detail.time);
            });
            spritetabListenerBound = true;
        }

        // Flush any pending resume_time save when the page is about to unload
        // so gallery navigation persists even without explicitly closing the
        // overlay first.
        if (!galleryUnloadListenersBound) {
            window.addEventListener('beforeunload', flushGalleryActivitySaveBeacon);
            window.addEventListener('pagehide', flushGalleryActivitySaveBeacon);
            galleryUnloadListenersBound = true;
        }

        // Inject toolbar button into the video.js control bar (wait for it to
        // appear), then reconcile with the Default Mode setting.
        if (injectGalleryToolbarButton()) {
            applyInitialState();
        } else {
            const controlsObserver = new MutationObserver(() => {
                if (injectGalleryToolbarButton()) {
                    controlsObserver.disconnect();
                    applyInitialState();
                }
            });
            controlsObserver.observe(document.body, { childList: true, subtree: true });
        }
    }

    // --- OBSERVER ---
    const observer = new MutationObserver(() => {
        const match = window.location.pathname.match(/\/scenes\/(\d+)/);
        if (match) {
            const sceneId = match[1];
            if (currentSceneId !== sceneId || !galleryInitialized) {
                init(sceneId);
            }
        } else {
            // Cleanup when leaving scene page
            exitGallery();
            clearGalleryFrameCache();
            clearNativeScrubberPreviewState();
            const popup = document.getElementById('stash-sprite-preview');
            if (popup) popup.remove();
            document.getElementById(GALLERY_BUTTON_ID)?.remove();
            currentSceneId = null;
            currentSceneData = null;
            galleryInitialized = false;
        }
    });

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            // Gallery UI
            setGalleryLoadingState, setGalleryControlsVisible,
            updateGalleryActionButtons, updateGalleryJumpButtons, updateGalleryUi,
            seekGalleryToTime, shiftGalleryTime, requestGalleryFullResolution,
            // Fullscreen & scroll lock
            getGalleryFullscreenElement, shouldUseSoftGalleryScrollLock,
            setGalleryScrollLockClasses, syncGalleryScrollLock, syncGalleryFullscreenState,
            unlockGalleryOrientation, lockGalleryOrientation,
            openGalleryFullscreen, exitGalleryFullscreen, toggleGalleryFullscreen,
            // Request management
            cancelActiveGalleryRequest, cancelGalleryPrefetch, closeGallerySocket,
            getGalleryTimeRequestKey, getGalleryRequestDataUrl,
            // Debug panel
            formatGalleryDebugNumber, formatGalleryDebugOffsets,
            getGallerySceneCacheTimes, getGalleryPendingRequestSummary, updateGalleryDebugPanel,
            // Socket & frame fetch
            getGalleryPrefetchBatchTimeoutMs, resolveGallerySocketRequest,
            failGallerySocketRequests, handleGallerySocketMessage,
            getGallerySocketUrl, ensureGallerySocket, fetchGalleryFrameData,
            waitForGalleryVideoFrame, getActiveGalleryMediaElement,
            // Prefetch
            buildGalleryPrefetchQueue, runGalleryPrefetchQueue, getGalleryPrefetchContextKey,
            hasActiveGalleryPrefetchRequests, getGalleryImmediateForwardPrefetchTimes,
            hasGalleryQueuedOrPendingPrefetchFrame, canReuseGalleryPrefetch,
            scheduleGalleryPrefetch, fetchGalleryPrefetchBatch,
            // Player sync
            unbindGalleryPlayerEvents, stopGallerySyncLoop, syncGalleryToPlayerTime,
            markGallerySeeking, syncGalleryFromControllerState,
            startGallerySyncLoop, bindGalleryPlayerEvents,
            // Core entry points
            showGalleryAtTime, showGalleryFrame, exitGallery,
            // Overlay layout
            updateGalleryOverlayLayout, clearGalleryOverlayLayoutRefresh,
            scheduleGalleryOverlayLayoutRefresh,
            // Gestures
            bindGalleryImageGestures, applyGalleryImageTransform,
            // Scrubber
            bindExternalScrubberCompatibility, bindGalleryScrubberPreview,
            syncNativeSpriteScrubber, updateNativeScrubberPreview,
            scheduleExternalScrubberSync,
            // State queries
            isGalleryModeOn, toggleGalleryMode, injectGalleryToolbarButton,
            syncGalleryToolbarButtonState, applyInitialState,
            getDefaultMode, getSavedGalleryState, setSavedGalleryState,
            getGalleryDuration, getGalleryResolutionScale,
            getSpriteSelectionTime, getSpriteIndexAtTime,
            isGalleryPrefetchEnabled, getGalleryPrefetchOffsetsSeconds,
            isLowBandwidthMode, getEffectiveGalleryScale, fetchGalleryFrameFromStream,
            hasGalleryRenderableFrame, isGalleryUsingVideoSurface,
            // Session store (React bridge / state-machine API)
            get _store() { return _sessionStore; },
            get _SessionState() { return _SessionState; },
            get _SessionEvents() { return _SessionEvents; },
            get _SessionEffects() { return _SessionEffects; },
            get _SessionSelectors() { return _SessionSelectors; },
            get _SessionRenderer() { return _SessionRenderer; },
            // Test state management
            _resetState() {
                galleryOverlay = null;
                galleryRequestSeq = 0;
                galleryActiveRequestId = 0;
                galleryActiveSocket = null;
                gallerySocketReadyPromise = null;
                gallerySocketRequestSeq = 0;
                gallerySocketRequests = new Map();
                galleryLastRequestedTime = null;
                galleryIgnoredPlayerTime = null;
                galleryPendingExplicitTargetTime = null;
                galleryPendingExplicitSourceTime = null;
                galleryControlledSeekTargetTime = null;
                galleryBoundTargets = [];
                galleryControlsVisible = false;
                galleryLastImageSrc = '';
                galleryLastImageScale = null;
                galleryHasVisibleFrame = false;
                galleryFullResolutionPending = false;
                galleryFullscreenEventsBound = false;
                galleryPseudoFullscreen = false;
                gallerySyncIntervalId = null;
                galleryLastObservedPlayerTime = null;
                galleryFrameCache = new Map();
                galleryPrefetchQueue = [];
                galleryPrefetchGeneration = 0;
                galleryPrefetchRunning = false;
                galleryPrefetchCenterTime = null;
                galleryPrefetchContextKey = null;
                externalScrubberBound = false;
                externalScrubberSyncTimeoutId = null;
                galleryLayoutRefreshTimeoutId = null;
                galleryLayoutRefreshDelayedTimeoutId = null;
                galleryLayoutRefreshLateTimeoutId = null;
                nativeScrubberPreviewTrack = null;
                nativeScrubberPreviewTouchId = null;
                nativeScrubberPreviewClearTimeoutId = null;
                galleryImageZoomScale = GALLERY_MIN_ZOOM_SCALE;
                galleryImagePanX = 0;
                galleryImagePanY = 0;
                galleryActiveGesture = null;
                galleryGestureTouchId = null;
                galleryGestureStartX = 0;
                galleryGestureStartY = 0;
                galleryGestureStartPanX = 0;
                galleryGestureStartPanY = 0;
                galleryGestureStartScale = GALLERY_MIN_ZOOM_SCALE;
                galleryGestureStartDistance = 0;
                galleryGestureAnchorContentX = 0;
                galleryGestureAnchorContentY = 0;
                gallerySuppressTapUntil = 0;
                currentSceneId = null;
                currentSceneData = null;
                pluginSettings = {
                    lb_prefetch_enabled: true,
                    lb_prefetch_offsets_seconds: DEFAULT_GALLERY_PREFETCH_OFFSETS_SECONDS,
                    lb_prefetch_window_seconds: DEFAULT_GALLERY_PREFETCH_WINDOW_SECONDS,
                    lb_frame_server_port: 9876,
                    lb_frame_server_host: '',
                    lb_enabled: false,
                    general_show_debug_panel: false
                };
                galleryInitialized = false;
                spritetabListenerBound = false;
                galleryUnloadListenersBound = false;
                galleryActivitySaveTimeoutId = null;
                galleryActivitySavePendingTime = null;
                galleryActive = false;
                defaultMode = 'remember';
                // Reset session store
                if (_sessionStore) {
                    _sessionStore.destroy();
                    const { createStore } = require('./src/gallerySessionStore');
                    _sessionStore = createStore({ runEffect: null, ctx: null });
                }
            },
            _applyState(delta) {
                if ('currentSceneId' in delta) currentSceneId = delta.currentSceneId;
                if ('currentSceneData' in delta) currentSceneData = delta.currentSceneData;
                if ('pluginSettings' in delta) pluginSettings = { ...pluginSettings, ...delta.pluginSettings };
                if ('galleryLastRequestedTime' in delta) galleryLastRequestedTime = delta.galleryLastRequestedTime;
                if ('galleryIgnoredPlayerTime' in delta) galleryIgnoredPlayerTime = delta.galleryIgnoredPlayerTime;
                if ('galleryPendingExplicitTargetTime' in delta) galleryPendingExplicitTargetTime = delta.galleryPendingExplicitTargetTime;
                if ('galleryPendingExplicitSourceTime' in delta) galleryPendingExplicitSourceTime = delta.galleryPendingExplicitSourceTime;
                if ('galleryControlledSeekTargetTime' in delta) galleryControlledSeekTargetTime = delta.galleryControlledSeekTargetTime;
                if ('galleryControlsVisible' in delta) galleryControlsVisible = delta.galleryControlsVisible;
                if ('galleryActiveSocket' in delta) galleryActiveSocket = delta.galleryActiveSocket;
                if ('galleryHasVisibleFrame' in delta) galleryHasVisibleFrame = delta.galleryHasVisibleFrame;
                if ('galleryActive' in delta) galleryActive = delta.galleryActive;
                if ('defaultMode' in delta) defaultMode = delta.defaultMode;
                // Sync session store from applied state
                _syncStoreFromGlobals();
            }
        };
    } else {
        observer.observe(document.body, { childList: true, subtree: true });
    }

})();
