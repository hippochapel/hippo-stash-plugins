/**
 * The player panel: the video plus everything wrapped around it.
 *
 * Controls sit *on* the video rather than beside it, so the picture gets the
 * width. They reveal on hover/focus on a pointer device and stay visible on
 * touch, where there is no hover to reveal them with.
 *
 * Three sizes: corner, theater (full width with the guide scrolling below), and
 * fullscreen. iOS Safari cannot fullscreen an arbitrary element, so there the
 * video's own native fullscreen is used instead -- which shows the video alone,
 * without the guide. Theater is the iPad answer.
 */

import { el, replaceChildren } from './dom.js';
import { Events } from '../state/actions.js';
import { formatClock, formatDuration, formatRemaining } from '../domain/format.js';
import { sceneTitle } from '../api/scenes.js';
import * as sel from '../state/selectors.js';
import { setIcon } from './icons.js';

export function createPlayer({ store, viewer }) {
    const spinner = el('div', { class: 'tvguide-spinner', 'aria-hidden': 'true' });

    const playPause = controlButton('tvguide-play', () =>
        store.dispatch({
            type: Events.SET_VIEWER_PAUSED,
            paused: !store.getState().viewerPaused
        })
    );

    const mute = controlButton('tvguide-mute', () =>
        store.dispatch({ type: Events.SET_MUTED, muted: !store.getState().muted })
    );

    const theater = controlButton('tvguide-theater', () => cycleMode('theater'));
    const fullscreen = controlButton('tvguide-fullscreen', () => cycleMode('fullscreen'));

    const watch = el(
        'button',
        {
            class: 'tvguide-watch',
            type: 'button',
            onclick: () => {
                const { tunedChannelId } = store.getState();
                if (tunedChannelId) store.dispatch({ type: Events.EXPAND, channelId: tunedChannelId });
            }
        },
        'Watch'
    );

    const backToLive = el(
        'button',
        {
            class: 'tvguide-back-to-live',
            type: 'button',
            hidden: true,
            onclick: () => store.dispatch({ type: Events.BACK_TO_LIVE })
        },
        'Back to live'
    );

    const controls = el(
        'div',
        { class: 'tvguide-player-controls' },
        playPause,
        mute,
        backToLive,
        el('span', { class: 'tvguide-player-spacer' }),
        theater,
        fullscreen,
        watch
    );

    const stage = el('div', { class: 'tvguide-player-stage' }, viewer.element, spinner, controls);
    const progress = el('div', { class: 'tvguide-player-progress' });
    const caption = el('p', { class: 'tvguide-player-caption' });

    const root = el('div', { class: 'tvguide-player' }, stage, progress, caption);

    viewer.subscribe((event) => {
        // The spinner is about the stream, not about being paused -- a paused
        // player is not loading.
        root.classList.toggle('is-loading', event.type === 'loading');
    });

    function controlButton(className, onclick) {
        return el('button', { class: `tvguide-player-button ${className}`, type: 'button', onclick });
    }

    /** Toggle a mode: pressing the button you are already in returns to corner. */
    function cycleMode(mode) {
        const current = store.getState().playerMode;
        store.dispatch({ type: Events.SET_PLAYER_MODE, mode: current === mode ? 'corner' : mode });
    }

    /**
     * Fullscreen targets the *stage*, not the whole panel.
     *
     * The panel's progress readout is rewritten every second; keeping the
     * fullscreen element off that churning subtree is what stops fullscreen
     * dropping out again a tick after it opens.
     */
    function isFullscreen() {
        return document.fullscreenElement === stage;
    }

    function applyFullscreen(on) {
        if (on) {
            if (isFullscreen()) return;
            if (stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
            else if (viewer.element.webkitEnterFullscreen) {
                // iOS: only a video element can go fullscreen, so the guide is
                // not visible in this mode on iPad.
                viewer.element.webkitEnterFullscreen();
            }
            return;
        }
        // Only exit what we opened -- exiting unconditionally would fight
        // anything else on the page that is fullscreen.
        if (isFullscreen() && document.exitFullscreen) {
            document.exitFullscreen().catch(() => {});
        }
    }

    // Let state follow the browser: pressing Esc, or the OS dropping out of
    // fullscreen, must not leave the button claiming we are still in it.
    document.addEventListener('fullscreenchange', () => {
        if (!isFullscreen() && store.getState().playerMode === 'fullscreen') {
            store.dispatch({ type: Events.SET_PLAYER_MODE, mode: 'corner' });
        }
    });

    /**
     * Control visibility is driven from JS rather than `@media (hover: hover)`.
     * The media query reported the wrong thing on at least one real machine and
     * left the controls permanently on screen; pointer events tell the truth.
     */
    let hideTimer = null;
    const showControls = () => {
        clearTimeout(hideTimer);
        root.classList.add('is-showing-controls');
    };
    const hideControls = () => {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => root.classList.remove('is-showing-controls'), 120);
    };

    stage.addEventListener('mouseenter', showControls);
    stage.addEventListener('mousemove', showControls);
    stage.addEventListener('mouseleave', hideControls);
    // Keyboard users need them too, and touch has no hover to reveal with.
    stage.addEventListener('focusin', showControls);
    stage.addEventListener('focusout', hideControls);
    stage.addEventListener('touchstart', showControls, { passive: true });

    return {
        element: root,

        setMode(mode) {
            applyFullscreen(mode === 'fullscreen');
        },

        render(state) {
            const channel = sel.tunedChannel(state);
            const previewing = sel.isPreviewing(state);
            const program = previewing ? null : channel && sel.liveProgram(state, channel.id);
            const scene = previewing ? state.preview.scene : program?.scene;

            root.dataset.mode = state.playerMode;
            root.hidden = !state.settings.guide_autoplay;
            // Nothing is streaming during a preview, so the video is hidden
            // rather than sitting there as a black rectangle pretending to be a
            // player. The banner already shows the poster.
            root.classList.toggle('is-previewing', previewing);

            // SVG icons, not emoji: these inherit currentColor and size with
            // the button instead of rendering as platform artwork.
            setIcon(playPause, state.viewerPaused ? 'play' : 'pause');
            playPause.setAttribute('aria-label', state.viewerPaused ? 'Play' : 'Pause');
            playPause.setAttribute('aria-pressed', state.viewerPaused ? 'true' : 'false');

            setIcon(mute, state.muted ? 'muted' : 'unmuted');
            mute.setAttribute('aria-label', state.muted ? 'Unmute' : 'Mute');
            mute.setAttribute('aria-pressed', state.muted ? 'true' : 'false');

            setIcon(theater, 'theater');
            theater.setAttribute('aria-label', 'Theater mode');
            theater.setAttribute('aria-pressed', state.playerMode === 'theater' ? 'true' : 'false');

            setIcon(fullscreen, state.playerMode === 'fullscreen' ? 'exitFullscreen' : 'fullscreen');
            fullscreen.setAttribute('aria-label', 'Fullscreen');
            fullscreen.setAttribute('aria-pressed', state.playerMode === 'fullscreen' ? 'true' : 'false');

            backToLive.hidden = !previewing;

            caption.textContent = channel
                ? `${channel.name}${scene ? ` · ${sceneTitle(scene)}` : ''}${previewing ? ' (preview)' : ''}`
                : '';

            renderProgress(state, program);
        }
    };

    function renderProgress(state, program) {
        if (!program) {
            replaceChildren(progress);
            return;
        }

        const pct = Math.min(100, Math.max(0, (program.elapsedMs / program.durationMs) * 100));

        replaceChildren(
            progress,
            el(
                'div',
                {
                    class: 'tvguide-progress',
                    role: 'progressbar',
                    'aria-valuemin': '0',
                    'aria-valuemax': '100',
                    'aria-valuenow': String(Math.round(pct)),
                    'aria-label': 'Programme progress'
                },
                el('div', { class: 'tvguide-progress-fill', style: { width: `${pct}%` } })
            ),
            el(
                'p',
                { class: 'tvguide-player-times' },
                `${formatDuration(program.elapsedMs / 1000)} / ${formatDuration(program.durationMs / 1000)}`,
                ` · ends ${formatClock(program.endMs)}`,
                ` · ${formatRemaining(program.endMs - state.nowMs)}`
            )
        );
    }
}
