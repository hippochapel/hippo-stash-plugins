import { fetchScenePool, sceneTitle, SCENE_POOL_QUERY } from '../../src/api/scenes.js';

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
