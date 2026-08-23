/**
 * Session-scoped cache for scene pools.
 *
 * Pools are the expensive part of opening the guide, and they do not change
 * within a session in any way that matters. Keyed by day as well as channel so
 * a cache entry cannot outlive the broadcast day it was fetched for.
 *
 * Storage is optional: private-mode browsers and quota exhaustion both throw,
 * and a cache that cannot store is only ever a performance loss.
 */

const PREFIX = 'tvguide:pool';

export function createPoolCache({ storage } = {}) {
    const store = storage === undefined ? safeSessionStorage() : storage;

    const keyFor = (channelId, dayKey) => `${PREFIX}:${channelId}:${dayKey}`;

    return {
        get(channelId, dayKey) {
            if (!store) return null;
            try {
                const raw = store.getItem(keyFor(channelId, dayKey));
                return raw ? JSON.parse(raw) : null;
            } catch (e) {
                return null;
            }
        },

        set(channelId, dayKey, scenes) {
            if (!store) return;
            try {
                store.setItem(keyFor(channelId, dayKey), JSON.stringify(scenes));
            } catch (e) {
                // Over quota. Drop what we have and carry on uncached rather
                // than letting a storage limit break channel loading.
                this.clear();
            }
        },

        clear() {
            if (!store) return;
            try {
                const doomed = [];
                for (let i = 0; i < store.length; i++) {
                    const key = store.key(i);
                    if (key && key.startsWith(PREFIX)) doomed.push(key);
                }
                doomed.forEach((key) => store.removeItem(key));
            } catch (e) {
                /* nothing sensible left to do */
            }
        }
    };
}

function safeSessionStorage() {
    try {
        return globalThis.sessionStorage || null;
    } catch (e) {
        return null;
    }
}
