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

    function applyFullscreen(on) {
        if (on) {
            if (root.requestFullscreen) root.requestFullscreen().catch(() => {});
            else if (viewer.element.webkitEnterFullscreen) {
                // iOS: only a video element can go fullscreen, so the guide is
                // not visible in this mode on iPad.
                viewer.element.webkitEnterFullscreen();
            }
            return;
        }
        if (document.fullscreenElement && document.exitFullscreen) {
            document.exitFullscreen().catch(() => {});
        }
    }

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
            root.classList.toggle('is-previewing', previewing);

            // Words, not glyphs: the emoji set read as clutter and did not
            // match anything else in the Stash UI.
            playPause.textContent = state.viewerPaused ? 'Play' : 'Pause';
            playPause.setAttribute('aria-label', state.viewerPaused ? 'Play' : 'Pause');
            playPause.setAttribute('aria-pressed', state.viewerPaused ? 'true' : 'false');

            mute.textContent = state.muted ? 'Unmute' : 'Mute';
            mute.setAttribute('aria-label', state.muted ? 'Unmute' : 'Mute');
            mute.setAttribute('aria-pressed', state.muted ? 'true' : 'false');

            theater.textContent = 'Theater';
            theater.setAttribute('aria-label', 'Theater mode');
            theater.setAttribute('aria-pressed', state.playerMode === 'theater' ? 'true' : 'false');

            fullscreen.textContent = 'Full';
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
