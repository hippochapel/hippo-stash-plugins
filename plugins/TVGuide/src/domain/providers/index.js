/**
 * The provider registry -- the extension point for channel sources.
 *
 * Adding a source means adding one module here. Everything downstream (the
 * scheduler, the grid, the viewer) works in terms of channels and scene
 * filters, so it needs no changes at all.
 */

import studio from './studio.js';
import tag from './tag.js';
import group from './group.js';
import savedFilter from './savedFilter.js';

export const PROVIDERS = {
    [studio.source]: studio,
    [tag.source]: tag,
    [group.source]: group,
    [savedFilter.source]: savedFilter
};

/**
 * Expand a lineup into channels.
 *
 * Entries are resolved concurrently but emitted in lineup order, so the guide's
 * channel order is the user's, not whichever query returned first.
 *
 * A source that fails is reported rather than thrown: one broken saved filter
 * should cost you that channel, not the whole guide.
 *
 * @returns {Promise<{channels: Array, errors: Array<{source, message}>}>}
 */
export async function resolveLineup(lineup, gql) {
    const results = await Promise.all(
        lineup.map(async (entry) => {
            const provider = PROVIDERS[entry.source];
            if (!provider) return { channels: [], error: null };
            try {
                return { channels: await provider.listChannels(entry, gql), error: null };
            } catch (e) {
                return { channels: [], error: { source: entry.source, message: e.message } };
            }
        })
    );

    const channels = [];
    const errors = [];
    const seen = new Set();

    for (const result of results) {
        if (result.error) errors.push(result.error);
        for (const channel of result.channels) {
            // Two lineup entries can legitimately select the same studio; the
            // first wins so the guide has no duplicate rows.
            if (seen.has(channel.id)) continue;
            seen.add(channel.id);
            channels.push(channel);
        }
    }

    return { channels, errors };
}
