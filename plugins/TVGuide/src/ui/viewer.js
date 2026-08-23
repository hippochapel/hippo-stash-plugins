/**
 * The corner viewer: the part that makes the guide feel live.
 *
 * Two problems it exists to solve:
 *
 * 1. Seeking. `paths.stream` may be served direct or transcoded. On a direct
 *    file, setting `currentTime` works. On a transcode it can silently do
 *    nothing, so if no `seeked` arrives in time we reload the stream with
 *    `?start=`, which Stash honours server-side.
 *
 * 2. Drift. A tuned stream slowly falls behind the schedule -- buffering,
 *    a throttled background tab, a paused-then-resumed element. The viewer
 *    holds its own baseline and nudges itself back when it strays far enough
 *    to be visible.
 */

import { el } from './dom.js';

export const SEEK_TIMEOUT_MS = 4000;
export const SEEK_TOLERANCE_S = 2;
export const DRIFT_CHECK_MS = 10000;
export const DRIFT_TOLERANCE_S = 3;

/** Add a server-side start offset to a stream URL. */
export function withStart(url, seconds) {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}start=${Math.floor(seconds)}`;
}

export function createViewer({ now = () => Date.now(), document: doc = document } = {}) {
    const video = el('video', {
        class: 'tvguide-viewer-video',
        muted: true,
        playsinline: true,
        preload: 'metadata'
    });
    // The muted attribute alone is not always honoured before first play.
    video.muted = true;

    let baseOffsetMs = 0;
    let baseWallMs = 0;
    let currentSceneId = null;
    let streamUrl = null;
    // When the `?start=` fallback engages, the stream's own t=0 is that offset
    // rather than the start of the scene. Everything comparing `currentTime`
    // against schedule time has to subtract this, or drift correction would
    // think it is hours behind and re-seek forever.
    let streamBaseSeconds = 0;
    let seekTimer = null;
    let driftTimer = null;
    // Set while the user has deliberately paused, so drift correction and the
    // resume path both leave the element alone.
    let userPaused = false;
    // A still being shown instead of the live stream.
    let posterOnly = false;
    const listeners = new Set();

    function emit(event) {
        for (const listener of listeners) {
            try {
                listener(event);
            } catch (e) {
                /* a broken listener must not stop playback */
            }
        }
    }

    // Loading state: the poster is up from the moment we tune, and the spinner
    // runs until the element actually reports playing.
    video.addEventListener('loadstart', () => emit({ type: 'loading' }));
    video.addEventListener('waiting', () => emit({ type: 'loading' }));
    video.addEventListener('playing', () => emit({ type: 'playing' }));
    video.addEventListener('pause', () => emit({ type: 'paused' }));

    /** Where the schedule says we should be, in scene time. */
    function expectedSeconds() {
        return (baseOffsetMs + (now() - baseWallMs)) / 1000;
    }

    /** The same instant expressed in the current stream's own timeline. */
    function expectedStreamSeconds() {
        return expectedSeconds() - streamBaseSeconds;
    }

    function clearSeekTimer() {
        if (seekTimer) {
            clearTimeout(seekTimer);
            seekTimer = null;
        }
    }

    /**
     * Seek, then verify. A transcoded stream can accept `currentTime` and
     * ignore it, so the fallback re-requests the stream at the offset instead.
     */
    function seek(sceneSeconds) {
        clearSeekTimer();

        const target = sceneSeconds - streamBaseSeconds;

        try {
            video.currentTime = target;
        } catch (e) {
            // Metadata not ready yet; the fallback below still covers us.
        }

        seekTimer = setTimeout(() => {
            seekTimer = null;
            if (Math.abs(video.currentTime - target) > SEEK_TOLERANCE_S && streamUrl) {
                // The stream ignored the seek -- ask the server to start there
                // instead, and remember that its timeline is now shifted.
                streamBaseSeconds = sceneSeconds;
                video.src = withStart(streamUrl, sceneSeconds);
                video.load();
                play();
            }
        }, SEEK_TIMEOUT_MS);

        video.addEventListener('seeked', clearSeekTimer, { once: true });
    }

    function play() {
        const attempt = video.play();
        // Autoplay policy may refuse; the poster stays up and the user can
        // start it themselves. Not an error worth surfacing.
        if (attempt && typeof attempt.catch === 'function') attempt.catch(() => {});
    }

    function checkDrift() {
        if (!currentSceneId || userPaused || posterOnly || video.paused || video.seeking) return;
        if (Math.abs(video.currentTime - expectedStreamSeconds()) > DRIFT_TOLERANCE_S) {
            seek(expectedSeconds());
        }
    }

    function startDriftWatch() {
        if (driftTimer) return;
        driftTimer = setInterval(checkDrift, DRIFT_CHECK_MS);
    }

    return {
        element: video,

        /** Subscribe to loading/playing/paused. Returns an unsubscribe. */
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        /** Point the viewer at a scene, positioned where the schedule says. */
        tune(scene, offsetMs, muted) {
            userPaused = false;
            posterOnly = false;
            baseOffsetMs = offsetMs;
            baseWallMs = now();
            video.muted = Boolean(muted);

            const nextUrl = scene?.paths?.stream || null;

            // Same scene, still playing: nudge rather than reload, so switching
            // back to a channel does not restart its buffer.
            if (scene && scene.id === currentSceneId && streamUrl === nextUrl) {
                seek(offsetMs / 1000);
                // Still has to start playing: this is the path taken when
                // resuming from a pause, where the element is stopped.
                play();
                return;
            }

            currentSceneId = scene ? scene.id : null;
            streamUrl = nextUrl;
            streamBaseSeconds = 0;

            if (!streamUrl) {
                this.stop();
                return;
            }

            if (scene.paths?.screenshot) video.poster = scene.paths.screenshot;

            video.src = streamUrl;
            video.load();

            video.addEventListener('loadedmetadata', () => seek(offsetMs / 1000), { once: true });
            play();
            startDriftWatch();
        },

        setMuted(muted) {
            video.muted = Boolean(muted);
        },

        setPaused(paused) {
            userPaused = Boolean(paused);
            if (paused) video.pause();
            else play();
        },

        /**
         * Show a scene as a still, without streaming it.
         *
         * Used when previewing something that is not on now: there is nothing
         * live to show, and starting its stream would misrepresent the schedule.
         */
        showPoster(scene) {
            posterOnly = true;
            userPaused = true;
            video.pause();
            video.removeAttribute('src');
            video.load();
            currentSceneId = null;
            streamUrl = null;
            if (scene?.paths?.screenshot) video.poster = scene.paths.screenshot;
            emit({ type: 'poster' });
        },

        isPaused() {
            return userPaused || video.paused;
        },

        stop() {
            userPaused = false;
            posterOnly = false;
            clearSeekTimer();
            if (driftTimer) {
                clearInterval(driftTimer);
                driftTimer = null;
            }
            currentSceneId = null;
            streamUrl = null;
            streamBaseSeconds = 0;
            video.pause();
            video.removeAttribute('src');
            video.load();
        },

        // Exposed for tests and for the drift watch to be driven deterministically.
        /**
         * Re-establish playback after the tab was backgrounded.
         *
         * iOS pauses the element on app switch and fires nothing drift
         * correction can act on -- and drift correction deliberately ignores a
         * paused element, so it can never recover on its own.
         */
        resume(offsetMs) {
            if (userPaused || posterOnly || !streamUrl) return false;
            baseOffsetMs = offsetMs;
            baseWallMs = now();
            seek(offsetMs / 1000);
            play();
            return true;
        },

        _checkDrift: checkDrift,
        _expectedSeconds: expectedSeconds,
        _streamBaseSeconds: () => streamBaseSeconds
    };
}
