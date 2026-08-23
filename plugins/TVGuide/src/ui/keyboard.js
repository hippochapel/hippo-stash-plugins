/**
 * Keyboard control for the guide.
 *
 * Key handling is split in two: `mapKey` is a pure key -> intent lookup, and
 * the handler turns an intent into dispatches. That keeps the keymap itself
 * trivially testable and free of store wiring.
 *
 * Follows the WAI-ARIA grid pattern: arrows move a roving focus, Enter acts on
 * the focused cell, Escape leaves.
 */

import { Events } from '../state/actions.js';
import { windowMs, windowEndMs } from '../state/selectors.js';

export const Intents = {
    TIME_PREV: 'TIME_PREV',
    TIME_NEXT: 'TIME_NEXT',
    CHANNEL_PREV: 'CHANNEL_PREV',
    CHANNEL_NEXT: 'CHANNEL_NEXT',
    PAGE_PREV: 'PAGE_PREV',
    PAGE_NEXT: 'PAGE_NEXT',
    WINDOW_START: 'WINDOW_START',
    WINDOW_END: 'WINDOW_END',
    GO_NOW: 'GO_NOW',
    TUNE: 'TUNE',
    EXPAND: 'EXPAND',
    MUTE: 'MUTE',
    CLOSE: 'CLOSE',
    HELP: 'HELP'
};

/** @returns {string|null} the intent for a key event, or null to let it pass. */
export function mapKey(event) {
    switch (event.key) {
        case 'ArrowLeft':
            return Intents.TIME_PREV;
        case 'ArrowRight':
            return Intents.TIME_NEXT;
        case 'ArrowUp':
            return Intents.CHANNEL_PREV;
        case 'ArrowDown':
            return Intents.CHANNEL_NEXT;
        case 'PageUp':
            return Intents.PAGE_PREV;
        case 'PageDown':
            return Intents.PAGE_NEXT;
        case 'Home':
            return Intents.WINDOW_START;
        case 'End':
            return Intents.WINDOW_END;
        case 'Enter':
            return event.shiftKey ? Intents.EXPAND : Intents.TUNE;
        case ' ':
        case 'Spacebar':
            return Intents.TUNE;
        case 'Escape':
            return Intents.CLOSE;
        default:
            break;
    }

    switch (event.key.toLowerCase()) {
        case 'n':
            return Intents.GO_NOW;
        case 'e':
            return Intents.EXPAND;
        case 'm':
            return Intents.MUTE;
        case '?':
            return Intents.HELP;
        default:
            return null;
    }
}

/** Typing in a field must never be swallowed as a guide shortcut. */
export function isTextEntry(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function createKeyboardHandler({ store, onClose, onHelp }) {
    return function handleKeydown(event) {
        const state = store.getState();
        if (!state.open) return;
        if (isTextEntry(event.target)) return;

        const intent = mapKey(event);
        if (!intent) return;

        // Only claim keys we actually acted on, so browser shortcuts survive.
        event.preventDefault();
        event.stopPropagation();

        const focusedChannelId = state.focus?.channelId;

        switch (intent) {
            case Intents.TIME_PREV:
                store.dispatch({ type: Events.MOVE_FOCUS, axis: 'time', delta: -1 });
                return;
            case Intents.TIME_NEXT:
                store.dispatch({ type: Events.MOVE_FOCUS, axis: 'time', delta: 1 });
                return;
            case Intents.CHANNEL_PREV:
                store.dispatch({ type: Events.MOVE_FOCUS, axis: 'channel', delta: -1 });
                return;
            case Intents.CHANNEL_NEXT:
                store.dispatch({ type: Events.MOVE_FOCUS, axis: 'channel', delta: 1 });
                return;
            case Intents.PAGE_PREV:
                store.dispatch({ type: Events.PAN, deltaMs: -windowMs(state) });
                return;
            case Intents.PAGE_NEXT:
                store.dispatch({ type: Events.PAN, deltaMs: windowMs(state) });
                return;
            case Intents.WINDOW_START:
                if (focusedChannelId) {
                    store.dispatch({
                        type: Events.FOCUS_CELL,
                        channelId: focusedChannelId,
                        timeMs: state.windowStartMs
                    });
                }
                return;
            case Intents.WINDOW_END:
                if (focusedChannelId) {
                    store.dispatch({
                        type: Events.FOCUS_CELL,
                        channelId: focusedChannelId,
                        timeMs: windowEndMs(state) - 1
                    });
                }
                return;
            case Intents.GO_NOW:
                store.dispatch({ type: Events.GO_TO_NOW });
                if (focusedChannelId) {
                    store.dispatch({
                        type: Events.FOCUS_CELL,
                        channelId: focusedChannelId,
                        timeMs: state.nowMs
                    });
                }
                return;
            case Intents.TUNE:
                if (focusedChannelId) store.dispatch({ type: Events.TUNE, channelId: focusedChannelId });
                return;
            case Intents.EXPAND:
                if (focusedChannelId) store.dispatch({ type: Events.EXPAND, channelId: focusedChannelId });
                return;
            case Intents.MUTE:
                store.dispatch({ type: Events.SET_MUTED, muted: !state.muted });
                return;
            case Intents.HELP:
                if (onHelp) onHelp();
                return;
            default:
                if (onClose) onClose();
        }
    };
}
