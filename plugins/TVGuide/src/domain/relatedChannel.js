import { monogram } from './format.js';
import { makeChannelId } from './lineup.js';

const FILTERS = {
    performer: (id) => ({ performers: { value: [id], modifier: 'INCLUDES' } }),
    tag: (id) => ({ tags: { value: [id], modifier: 'INCLUDES', depth: -1 } })
};

/** Turn a performer or tag from a scene into a channel ready for the guide. */
export function relatedChannel(source, entity) {
    const id = String(entity?.id || '').trim();
    const name = String(entity?.name || '').trim();
    if (!FILTERS[source] || !id || !name) return null;

    return {
        id: makeChannelId(source, id),
        source,
        name,
        logo: { type: 'monogram', ...monogram(name) },
        sceneCount: 0,
        sceneFilter: FILTERS[source](id)
    };
}
