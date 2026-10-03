import { fetchScenePool, fetchAllScenePool, fetchSceneStreams, sceneTitle, SCENE_POOL_QUERY } from '../../src/api/scenes.js';

describe('the full library pool', () => {
    it('loads beyond the normal cap, deduplicates pages, and includes the final partial page', async () => {
        const first = Array.from({ length: 500 }, (_, i) => ({ id: String(i) }));
        const gql = jest.fn()
            .mockResolvedValueOnce({ findScenes: { scenes: first } })
            .mockResolvedValueOnce({ findScenes: { scenes: [first[499], { id: '500' }] } });
        const result = await fetchAllScenePool(gql);
        expect(result).toHaveLength(501);
        expect(result.at(-1).id).toBe('500');
        expect(result[0]._summary).toBe(true);
        expect(gql.mock.calls[0][0]).not.toMatch(/details|paths|performers|studio|tags/);
        expect(gql.mock.calls.map((call) => call[1])).toEqual([1, 2].map((page) => ({
            filter: {}, find: { per_page: 500, page, sort: 'id', direction: 'ASC' }
        })));
    });

    it('rejects incomplete results rather than scheduling a partial library', async () => {
        const gql = jest.fn()
            .mockResolvedValueOnce({ findScenes: { scenes: Array.from({ length: 500 }, (_, i) => ({ id: String(i) })) } })
            .mockRejectedValueOnce(new Error('offline'));
        await expect(fetchAllScenePool(gql)).rejects.toThrow('offline');
        await expect(fetchAllScenePool(async () => ({}))).rejects.toThrow('full scene library');
        expect(await fetchAllScenePool(async () => ({ findScenes: { scenes: [] } }))).toEqual([]);
    });
});

it('fetches alternate stream URLs for only the failed scene', async () => {
    const streams = [{ url: '/scene/1202/stream.mp4', mime_type: 'video/mp4' }];
    const gql = jest.fn(async () => ({ findScene: { sceneStreams: streams } }));
    expect(await fetchSceneStreams(gql, '1202')).toEqual(streams);
    expect(gql.mock.calls[0][1]).toEqual({ id: '1202' });
    expect(await fetchSceneStreams(async () => ({ findScene: null }), 'missing')).toEqual([]);
});

describe('fetchScenePool', () => {
    const filter = { studios: { value: ['1'], modifier: 'INCLUDES' } };

    it('passes the channel filter through untouched', async () => {
        const gql = jest.fn(async () => ({ findScenes: { scenes: [] } }));
        await fetchScenePool(gql, filter, 50);
        expect(gql.mock.calls[0][1].filter).toBe(filter);
    });

    it('sorts by id ascending so the pool is stable between loads', async () => {
        const gql = jest.fn(async () => ({ findScenes: { scenes: [] } }));
        await fetchScenePool(gql, filter, 50);

        const find = gql.mock.calls[0][1].find;
        expect(find.sort).toBe('id');
        expect(find.direction).toBe('ASC');
        expect(find.per_page).toBe(50);
    });

    it('requests the fields the schedule and guide need', () => {
        for (const field of ['duration', 'details', 'stream', 'screenshot', 'title']) {
            expect(SCENE_POOL_QUERY).toContain(field);
        }
    });

    it('requests related performer and tag identifiers for scene details', () => {
        expect(SCENE_POOL_QUERY).toContain('performers { id name image_path }');
        expect(SCENE_POOL_QUERY).toContain('tags { id name image_path }');
    });

    it('returns the scenes', async () => {
        const scenes = [{ id: '1' }];
        expect(await fetchScenePool(async () => ({ findScenes: { scenes } }), filter, 10)).toBe(scenes);
    });

    it('returns an empty array when the response is empty or malformed', async () => {
        expect(await fetchScenePool(async () => ({}), filter, 10)).toEqual([]);
        expect(await fetchScenePool(async () => ({ findScenes: {} }), filter, 10)).toEqual([]);
        expect(await fetchScenePool(async () => null, filter, 10)).toEqual([]);
    });
});

describe('sceneTitle', () => {
    it('uses the title when there is one', () => {
        expect(sceneTitle({ id: '4', title: 'Real Title' })).toBe('Real Title');
    });

    it('identifies untitled scenes by id rather than showing a blank', () => {
        expect(sceneTitle({ id: '4' })).toBe('Untitled scene 4');
        expect(sceneTitle({ id: '4', title: '' })).toBe('Untitled scene 4');
        expect(sceneTitle({ id: '4', title: '   ' })).toBe('Untitled scene 4');
    });
});
