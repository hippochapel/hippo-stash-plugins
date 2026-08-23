/**
 * Shared implementation for the sources that are "a Stash entity with scenes":
 * studios, tags and groups. They differ only in query name, filter type and
 * which field holds the artwork, so each becomes a short declaration rather
 * than a copy of this logic.
 *
 * Every provider's job is the same and ends in the same place: turn a lineup
 * entry into channels, each carrying a SceneFilterType. Nothing downstream
 * knows or cares which source a channel came from.
 */

import { makeChannelId } from '../lineup.js';
import { resolveLogo } from '../logo.js';

export function createEntityProvider(config) {
    const {
        source,
        queryName,
        rootField,
        filterArg,
        filterType,
        collectionField,
        logoField,
        sceneFilterKey,
        // studios/tags/groups take a HierarchicalMultiCriterionInput, which
        // accepts `depth`. Performers take a plain MultiCriterionInput, which
        // does not -- sending depth there fails validation.
        hierarchical = true
    } = config;

    const query = `query ${queryName}($f: ${filterType}, $find: FindFilterType, $ids: [ID!]) {
  ${rootField}(${filterArg}: $f, filter: $find, ids: $ids) {
    ${collectionField} { id name ${logoField} scene_count }
  }
}`;

    return {
        source,
        query,

        async listChannels(entry, gql) {
            // Explicit ids win: the user picked these, so a scene-count
            // threshold must not quietly remove them.
            const byIds = Array.isArray(entry.ids) && entry.ids.length > 0;

            const variables = {
                ids: byIds ? entry.ids : null,
                f: byIds ? null : countFilter(entry.minScenes),
                find: { per_page: -1, sort: 'name', direction: 'ASC' }
            };

            const data = await gql(query, variables);
            const entities = data?.[rootField]?.[collectionField] || [];

            return entities.map((entity) => ({
                id: makeChannelId(source, entity.id),
                source,
                name: entity.name,
                logo: resolveLogo(entity[logoField], entity.name),
                sceneCount: entity.scene_count ?? 0,
                sceneFilter: {
                    [sceneFilterKey]: hierarchical
                        ? { value: [entity.id], modifier: 'INCLUDES', depth: -1 }
                        : { value: [entity.id], modifier: 'INCLUDES' }
                }
            }));
        }
    };
}

/**
 * `minScenes` reads as "at least N", so it becomes GREATER_THAN N-1.
 * A threshold of zero means no filter at all rather than a filter that
 * matches everything.
 */
function countFilter(minScenes) {
    if (!minScenes || minScenes <= 0) return null;
    return { scene_count: { value: minScenes - 1, modifier: 'GREATER_THAN' } };
}
