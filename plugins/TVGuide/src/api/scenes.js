/**
 * Scene pool loading.
 *
 * Every channel source reduces to a SceneFilterType, so one fetcher serves all
 * of them. The pool must be *stable*: the schedule is a seeded shuffle of it,
 * so if the pool came back in a different order each time, the "live" illusion
 * would collapse. Hence the fixed `sort: id, direction: ASC` -- the cap then
 * always takes the same slice of the same list.
 */

export const SCENE_POOL_QUERY = `query TVGuideScenePool($filter: SceneFilterType, $find: FindFilterType) {
  findScenes(scene_filter: $filter, filter: $find) {
    scenes {
      id
      title
      details
      date
      paths { screenshot stream }
      files { duration }
      studio { name image_path }
      performers { id name image_path }
      tags { id name image_path }
    }
  }
}`;

/**
 * @param gql       client from createClient
 * @param sceneFilter  a SceneFilterType, straight from a channel
 * @param poolCap   how many scenes at most may enter the schedule
 */
export async function fetchScenePool(gql, sceneFilter, poolCap) {
    const data = await gql(SCENE_POOL_QUERY, {
        filter: sceneFilter,
        find: { per_page: poolCap, page: 1, sort: 'id', direction: 'ASC' }
    });
    return data?.findScenes?.scenes || [];
}

const SCENE_INDEX_QUERY = `query TVGuideSceneIndex($filter: SceneFilterType, $find: FindFilterType) {
    findScenes(scene_filter: $filter, filter: $find) {
        scenes { id title files { duration } }
    }
}`;

/** Fetch only the timing index, not full metadata for the entire library. */
export async function fetchAllScenePool(gql) {
    const scenes = new Map();
    const perPage = 500;
    for (let page = 1; ; page += 1) {
        const data = await gql(SCENE_INDEX_QUERY, {
            filter: {}, find: { per_page: perPage, page, sort: 'id', direction: 'ASC' }
        });
        const batch = data?.findScenes?.scenes;
        if (!Array.isArray(batch)) throw new Error('Unable to load the full scene library');
        for (const scene of batch) scenes.set(scene.id, { ...scene, _summary: true });
        if (batch.length < perPage) return [...scenes.values()];
    }
}

export async function fetchSceneDetails(gql, id) {
    const data = await gql(`query TVGuideSceneDetails($id: ID!) {
        findScene(id: $id) {
            id title details date files { duration }
            paths { screenshot stream }
            studio { name image_path }
            performers { id name image_path }
            tags { id name image_path }
        }
    }`, { id });
    if (!data?.findScene) throw new Error('Scene details are unavailable');
    return { ...data.findScene, _summary: false };
}

/** Resolve alternate streams only when direct playback fails. */
export async function fetchSceneStreams(gql, id) {
    const data = await gql(`query TVGuideSceneStreams($id: ID!) {
        findScene(id: $id) { sceneStreams { url mime_type } }
    }`, { id });
    return data?.findScene?.sceneStreams || [];
}

/** Untitled scenes still need something to show in the guide. */
export function sceneTitle(scene) {
    const title = (scene.title || '').trim();
    return title || `Untitled scene ${scene.id}`;
}
