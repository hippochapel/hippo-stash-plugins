import { mapKey, Intents, isTextEntry, createKeyboardHandler } from '../../src/ui/keyboard.js';
import { Events } from '../../src/state/actions.js';
import { createInitialState } from '../../src/state/initialState.js';

const NOON = new Date(2026, 7, 22, 12, 0, 0).getTime();
const HOUR = 3600000;

const key = (k, extra = {}) => ({ key: k, shiftKey: false, ...extra });

describe('mapKey', () => {
    it.each([
        ['ArrowLeft', Intents.TIME_PREV],
        ['ArrowRight', Intents.TIME_NEXT],
        ['ArrowUp', Intents.CHANNEL_PREV],
        ['ArrowDown', Intents.CHANNEL_NEXT],
        ['PageUp', Intents.PAGE_PREV],
        ['PageDown', Intents.PAGE_NEXT],
        ['Home', Intents.WINDOW_START],
        ['End', Intents.WINDOW_END],
        ['Enter', Intents.TUNE],
        [' ', Intents.TUNE],
        ['Spacebar', Intents.TUNE],
        ['Escape', Intents.CLOSE],
        ['n', Intents.GO_NOW],
        ['e', Intents.EXPAND],
        ['m', Intents.MUTE],
        ['?', Intents.HELP]
    ])('maps %s', (k, intent) => {
        expect(mapKey(key(k))).toBe(intent);
    });

    it('treats Shift+Enter as expand', () => {
        expect(mapKey(key('Enter', { shiftKey: true }))).toBe(Intents.EXPAND);
    });

    it('accepts uppercase letter shortcuts', () => {
        expect(mapKey(key('N'))).toBe(Intents.GO_NOW);
        expect(mapKey(key('M'))).toBe(Intents.MUTE);
    });

    it('ignores keys it does not own', () => {
        expect(mapKey(key('q'))).toBeNull();
        expect(mapKey(key('F5'))).toBeNull();
    });
});

describe('isTextEntry', () => {
    it.each(['INPUT', 'TEXTAREA', 'SELECT'])('recognises %s', (tag) => {
        expect(isTextEntry({ tagName: tag })).toBe(true);
    });

    it('recognises contenteditable', () => {
        expect(isTextEntry({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    });

    it('rejects ordinary elements and nothing', () => {
        expect(isTextEntry({ tagName: 'DIV' })).toBe(false);
        expect(isTextEntry(null)).toBe(false);
    });
});

describe('createKeyboardHandler', () => {
    function harness(stateOverrides = {}) {
        const state = {
            ...createInitialState(),
            open: true,
            nowMs: NOON,
            windowStartMs: NOON,
            channels: [{ id: 'studio:1' }, { id: 'studio:2' }],
            focus: { channelId: 'studio:1', timeMs: NOON },
            ...stateOverrides
        };
        const dispatch = jest.fn();
        const onClose = jest.fn();
        const onHelp = jest.fn();
        const handle = createKeyboardHandler({
            store: { getState: () => state, dispatch },
            onClose,
            onHelp
        });
        return { handle, dispatch, onClose, onHelp, state };
    }

    const event = (k, extra = {}) => ({
        key: k,
        shiftKey: false,
        target: { tagName: 'DIV' },
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        ...extra
    });

    it('does nothing while the guide is closed', () => {
        const { handle, dispatch } = harness({ open: false });
        handle(event('ArrowRight'));
        expect(dispatch).not.toHaveBeenCalled();
    });

    it('leaves typing in a form field alone', () => {
        const { handle, dispatch } = harness();
        const e = event('n', { target: { tagName: 'INPUT' } });
        handle(e);
        expect(dispatch).not.toHaveBeenCalled();
        expect(e.preventDefault).not.toHaveBeenCalled();
    });

    it('leaves keys it does not own to the browser', () => {
        const { handle, dispatch } = harness();
        const e = event('F5');
        handle(e);
        expect(e.preventDefault).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
    });

    it('claims the keys it does act on', () => {
        const { handle } = harness();
        const e = event('ArrowRight');
        handle(e);
        expect(e.preventDefault).toHaveBeenCalled();
        expect(e.stopPropagation).toHaveBeenCalled();
    });

    it('moves focus through time', () => {
        const { handle, dispatch } = harness();
        handle(event('ArrowRight'));
        handle(event('ArrowLeft'));
        expect(dispatch).toHaveBeenNthCalledWith(1, { type: Events.MOVE_FOCUS, axis: 'time', delta: 1 });
        expect(dispatch).toHaveBeenNthCalledWith(2, { type: Events.MOVE_FOCUS, axis: 'time', delta: -1 });
    });

    it('moves focus between channels', () => {
        const { handle, dispatch } = harness();
        handle(event('ArrowDown'));
        handle(event('ArrowUp'));
        expect(dispatch).toHaveBeenNthCalledWith(1, { type: Events.MOVE_FOCUS, axis: 'channel', delta: 1 });
        expect(dispatch).toHaveBeenNthCalledWith(2, { type: Events.MOVE_FOCUS, axis: 'channel', delta: -1 });
    });

    it('pages by a full window width', () => {
        const { handle, dispatch } = harness();
        handle(event('PageDown'));
        handle(event('PageUp'));
        expect(dispatch).toHaveBeenNthCalledWith(1, { type: Events.PAN, deltaMs: 3 * HOUR });
        expect(dispatch).toHaveBeenNthCalledWith(2, { type: Events.PAN, deltaMs: -3 * HOUR });
    });

    it('jumps focus to the window edges', () => {
        const { handle, dispatch } = harness();
        handle(event('Home'));
        expect(dispatch).toHaveBeenCalledWith({
            type: Events.FOCUS_CELL,
            channelId: 'studio:1',
            timeMs: NOON
        });

        dispatch.mockClear();
        handle(event('End'));
        expect(dispatch.mock.calls[0][0].timeMs).toBe(NOON + 3 * HOUR - 1);
    });

    it('returns to now and puts focus back on the live programme', () => {
        const { handle, dispatch } = harness({ windowStartMs: NOON + 5 * HOUR });
        handle(event('n'));
        expect(dispatch).toHaveBeenNthCalledWith(1, { type: Events.GO_TO_NOW });
        expect(dispatch).toHaveBeenNthCalledWith(2, {
            type: Events.FOCUS_CELL,
            channelId: 'studio:1',
            timeMs: NOON
        });
    });

    it('tunes the focused channel', () => {
        const { handle, dispatch } = harness();
        handle(event('Enter'));
        expect(dispatch).toHaveBeenCalledWith({ type: Events.TUNE, channelId: 'studio:1' });
    });

    it('expands with e or Shift+Enter', () => {
        const { handle, dispatch } = harness();
        handle(event('e'));
        handle(event('Enter', { shiftKey: true }));
        expect(dispatch).toHaveBeenCalledTimes(2);
        expect(dispatch.mock.calls[0][0]).toEqual({ type: Events.EXPAND, channelId: 'studio:1' });
        expect(dispatch.mock.calls[1][0]).toEqual({ type: Events.EXPAND, channelId: 'studio:1' });
    });

    it('toggles mute', () => {
        const { handle, dispatch } = harness({ muted: true });
        handle(event('m'));
        expect(dispatch).toHaveBeenCalledWith({ type: Events.SET_MUTED, muted: false });
    });

    it('closes on Escape', () => {
        const { handle, onClose } = harness();
        handle(event('Escape'));
        expect(onClose).toHaveBeenCalled();
    });

    it('opens help', () => {
        const { handle, onHelp } = harness();
        handle(event('?'));
        expect(onHelp).toHaveBeenCalled();
    });

    it('ignores focus-dependent keys when nothing has focus', () => {
        const { handle, dispatch } = harness({ focus: null });
        handle(event('Enter'));
        handle(event('e'));
        handle(event('Home'));
        handle(event('End'));
        expect(dispatch).not.toHaveBeenCalled();
    });

    it('still returns to now without focus', () => {
        const { handle, dispatch } = harness({ focus: null });
        handle(event('n'));
        expect(dispatch).toHaveBeenCalledTimes(1);
        expect(dispatch).toHaveBeenCalledWith({ type: Events.GO_TO_NOW });
    });

    it('works without optional callbacks', () => {
        const state = { ...createInitialState(), open: true };
        const handle = createKeyboardHandler({ store: { getState: () => state, dispatch: jest.fn() } });
        expect(() => {
            handle(event('Escape'));
            handle(event('?'));
        }).not.toThrow();
    });
});

describe('the channel manager owns the keyboard while open', () => {
    function harness(stateOverrides = {}) {
        const state = {
            ...createInitialState(),
            open: true,
            nowMs: NOON,
            channels: [{ id: 'studio:1' }],
            focus: { channelId: 'studio:1', timeMs: NOON },
            ...stateOverrides
        };
        const dispatch = jest.fn();
        const handle = createKeyboardHandler({
            store: { getState: () => state, dispatch },
            onClose: jest.fn(),
            onHelp: jest.fn()
        });
        return { handle, dispatch };
    }

    const event = (k, extra = {}) => ({
        key: k,
        shiftKey: false,
        target: { tagName: 'DIV' },
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        ...extra
    });

    it('opens the manager with c', () => {
        const { handle, dispatch } = harness();
        handle(event('c'));
        expect(dispatch).toHaveBeenCalledWith({ type: Events.MANAGER_OPEN });
    });

    it('does not steal guide shortcuts while the manager is open', () => {
        // The manager is full of text fields; n, m and e must reach them.
        const { handle, dispatch } = harness({ managerOpen: true });
        handle(event('n'));
        handle(event('m'));
        handle(event('ArrowRight'));
        expect(dispatch).not.toHaveBeenCalled();
    });

    it('Escape closes the manager rather than the whole guide', () => {
        const { handle, dispatch } = harness({ managerOpen: true });
        handle(event('Escape'));
        expect(dispatch).toHaveBeenCalledWith({ type: Events.MANAGER_CLOSE });
    });
});
