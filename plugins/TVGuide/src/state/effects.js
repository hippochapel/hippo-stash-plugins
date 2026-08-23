/**
 * The effect runner: the only place in the state layer that touches the world.
 *
 * Everything it needs is injected, so the whole surface can be driven from
 * tests with plain objects -- no jsdom video element, no network.
 */

import { Events } from './actions.js';
import { resolveLineup } from '../domain/providers/index.js';
import { fetchScenePool } from '../api/scenes.js';

/** Concurrent pool fetches. Enough to fill a screen, few enough not to
 *  stampede the server when someone scrolls fast through a long lineup. */
export const MAX_CONCURRENT_POOL_FETCHES = 4;

export function createEffectRunner({
    gql,
    cache,
    viewer,
    storage,
    announce,
    navigate,
    getLineup,
    maxConcurrent = MAX_CONCURRENT_POOL_FETCHES
}) {
    let inFlight = 0;
    const waiting = [];

    function pump() {
        while (inFlight < maxConcurrent && waiting.length > 0) {
            const job = waiting.shift();
            inFlight++;
            job().finally(() => {
                inFlight--;
                pump();
            });
        }
    }

    function schedule(job) {
        waiting.push(job);
        pump();
    }

    return function runEffect(effect, getState, dispatch) {
        switch (effect.type) {
            case 'loadChannels':
                // Promise.resolve().then so a synchronous throw (a corrupt
                // lineup, say) becomes a reported failure rather than an
                // exception escaping the effect drain loop.
                Promise.resolve()
                    .then(() => resolveLineup(getLineup(), gql))
                    .then(
                        ({ channels, errors }) =>
                            dispatch({ type: Events.CHANNELS_LOADED, channels, errors }),
                        (error) => dispatch({ type: Events.CHANNELS_FAILED, message: error.message })
                    );
                return;

            case 'fetchPool': {
                const { dayKey, settings } = getState();

                const cached = cache && cache.get(effect.channelId, dayKey);
                if (cached) {
                    dispatch({ type: Events.POOL_LOADED, channelId: effect.channelId, scenes: cached });
                    return;
                }

                schedule(() =>
                    fetchScenePool(gql, effect.sceneFilter, settings.guide_pool_cap).then(
                        (scenes) => {
                            if (cache) cache.set(effect.channelId, dayKey, scenes);
                            dispatch({ type: Events.POOL_LOADED, channelId: effect.channelId, scenes });
                        },
                        (error) =>
                            dispatch({
                                type: Events.POOL_FAILED,
                                channelId: effect.channelId,
                                message: error.message
                            })
                    )
                );
                return;
            }

            case 'tuneViewer':
                if (viewer) viewer.tune(effect.scene, effect.offsetMs, getState().muted);
                return;

            case 'stopViewer':
                if (viewer) viewer.stop();
                return;

            case 'setMuted':
                if (viewer) viewer.setMuted(effect.muted);
                return;

            case 'navigateToScene':
                if (navigate) navigate(effect.sceneId, effect.offsetSeconds);
                return;

            case 'persist':
                if (!storage) return;
                try {
                    storage.setItem(effect.key, effect.value);
                } catch (e) {
                    // Preferences are a nicety; a full or blocked store is not
                    // a reason to interrupt viewing.
                }
                return;

            case 'announce':
                if (announce) announce(effect.message);
                return;

            default:
                return;
        }
    };
}
