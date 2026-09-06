import { surfChannel } from '../../src/ui/channelSurf.js';
import { createStore } from '../../src/state/store.js';
import { createInitialState } from '../../src/state/initialState.js';
import { Events } from '../../src/state/actions.js';

const channels = ['a', 'b', 'c'].map((id) => ({ id, name: id, source: 'studio', sceneFilter: {} }));
function mount(overrides = {}) {
    const runEffect = jest.fn();
    const store = createStore({ runEffect, initialState: {
        ...createInitialState(), open: true, channels, allChannels: channels,
        tunedChannelId: 'a', ...overrides
    } });
    return { store, runEffect };
}

it('wraps in guide order and requests programming without scrolling the guide', () => {
    const { store, runEffect } = mount({ viewerPaused: true, playerMode: 'fullscreen' });
    surfChannel(store, -1);
    expect(store.getState()).toMatchObject({ tunedChannelId: 'c', viewerPaused: false,
        playerMode: 'fullscreen', guideScrollChannelId: null });
    expect(runEffect.mock.calls.map(([effect]) => effect)).toContainEqual(expect.objectContaining({ type: 'fetchPool', channelId: 'c' }));
    surfChannel(store, 1);
    expect(store.getState().tunedChannelId).toBe('a');
});

it('uses only the filtered visible rows and recovers when the tuned row is absent', () => {
    const { store } = mount({ channels: [channels[1], channels[2]] });
    surfChannel(store, 1);
    expect(store.getState().tunedChannelId).toBe('b');
    surfChannel(store, -1);
    expect(store.getState().tunedChannelId).toBe('c');
});

it('leaves playback alone with zero channels or only the current channel', () => {
    for (const visible of [[], [channels[0]]]) {
        const { store, runEffect } = mount({ channels: visible, viewerPaused: true });
        surfChannel(store, 1);
        expect(store.getState().viewerPaused).toBe(true);
        expect(runEffect).not.toHaveBeenCalled();
    }
});

it('does not play an old pool response after surfing onward', () => {
    const { store, runEffect } = mount();
    surfChannel(store, 1);
    surfChannel(store, 1);
    runEffect.mockClear();
    store.dispatch({ type: Events.POOL_LOADED, channelId: 'b', scenes: [{ id: 'scene', files: [{ duration: 100 }] }] });
    expect(store.getState().tunedChannelId).toBe('c');
    expect(runEffect.mock.calls.map(([effect]) => effect.type)).not.toContain('tuneViewer');
});

it('starts the transition before switching streams, and skips it when there is no destination', () => {
    const { store } = mount();
    const beforeTune = jest.fn(() => expect(store.getState().tunedChannelId).toBe('a'));
    surfChannel(store, 1, beforeTune);
    expect(beforeTune).toHaveBeenCalledTimes(1);
    expect(store.getState().tunedChannelId).toBe('b');
    const single = mount({ channels: [channels[0]] });
    beforeTune.mockClear();
    surfChannel(single.store, 1, beforeTune);
    expect(beforeTune).not.toHaveBeenCalled();
});
