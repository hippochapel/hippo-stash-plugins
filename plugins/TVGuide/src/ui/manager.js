/**
 * The channel manager.
 *
 * Two independent axes, which the UI has to keep visually distinct or it gets
 * confusing fast:
 *
 *   - the LINEUP decides which channels exist (a per-source rule, plus
 *     explicit picks). Stored in `tvguide_lineup`.
 *   - PREFS decide how an existing channel is presented -- pinned, hidden,
 *     renamed, re-badged, its own scene cap. Stored in `tvguide_channel_prefs`,
 *     keyed by channel id so they survive lineup changes.
 *
 * Changing the lineup re-queries the server; changing prefs never does.
 */

import { el, replaceChildren } from './dom.js';
import { Events } from '../state/actions.js';
import { PoolStatus } from '../state/initialState.js';
import { SORT_MODES } from '../domain/channelPrefs.js';
import { KNOWN_SOURCES } from '../domain/lineup.js';
import * as sel from '../state/selectors.js';
import { logoBadge } from './logoBadge.js';

const SOURCE_LABELS = {
    studio: 'Studios',
    tag: 'Tags',
    group: 'Groups',
    savedFilter: 'Saved filters'
};

const SORT_LABELS = {
    name: 'Name',
    sceneCount: 'Scene count',
    source: 'Source'
};

export function createManager({ store }) {
    const search = el('input', {
        type: 'search',
        id: 'tvguide-manager-search',
        class: 'tvguide-manager-search',
        placeholder: 'Filter channels…',
        oninput: (e) => store.dispatch({ type: Events.MANAGER_SEARCH, query: e.target.value })
    });

    const sortSelect = el(
        'select',
        {
            id: 'tvguide-manager-sort',
            class: 'tvguide-manager-sort',
            onchange: (e) => store.dispatch({ type: Events.SET_SORT, sort: e.target.value })
        },
        SORT_MODES.map((mode) => el('option', { value: mode }, SORT_LABELS[mode]))
    );

    const sections = el('div', { class: 'tvguide-manager-sections' });
    const status = el('p', { class: 'tvguide-manager-status' });

    const root = el(
        'div',
        {
            class: 'tvguide-manager',
            role: 'dialog',
            'aria-label': 'Manage channels',
            hidden: true
        },
        el(
            'div',
            { class: 'tvguide-manager-head' },
            el('h2', { class: 'tvguide-manager-title' }, 'Channels'),
            el(
                'div',
                { class: 'tvguide-manager-tools' },
                el('label', { for: 'tvguide-manager-search', class: 'tvguide-sr-only' }, 'Filter channels'),
                search,
                el('label', { for: 'tvguide-manager-sort' }, 'Sort'),
                sortSelect
            ),
            el('button', {
                class: 'tvguide-manager-close',
                type: 'button',
                'aria-label': 'Close channel manager',
                text: '×',
                onclick: () => store.dispatch({ type: Events.MANAGER_CLOSE })
            })
        ),
        status,
        sections
    );

    // Editing is local to the panel -- it is not guide state, and putting it in
    // the store would mean a re-render on every keystroke.
    const editing = new Set();
    let renderedSignature = '';

    function render(state) {
        root.hidden = !state.managerOpen;
        if (!state.managerOpen) return;

        if (sortSelect.value !== state.sort) sortSelect.value = state.sort;
        if (search.value !== state.managerSearch) search.value = state.managerSearch;

        renderStatus(state);

        // Rebuild only when something the list depends on actually moved --
        // otherwise typing in an editor field would destroy the field.
        const signature = [
            state.catalogStatus,
            state.managerSearch,
            state.sort,
            JSON.stringify(state.lineup),
            JSON.stringify(state.prefs),
            state.allChannels.length,
            [...editing].join(',')
        ].join('|');
        if (signature === renderedSignature) return;
        renderedSignature = signature;

        replaceChildren(sections, KNOWN_SOURCES.map((source) => renderSection(state, source)));
    }

    /** Expanding an editor is local state, so it has to force the rebuild. */
    function toggleEditor(channelId) {
        if (editing.has(channelId)) editing.delete(channelId);
        else editing.add(channelId);
        renderedSignature = '';
        render(store.getState());
    }

    return { element: root, render };

    function renderStatus(state) {
        if (sel.catalogStatus(state) === PoolStatus.LOADING) {
            status.textContent = 'Loading available channels…';
        } else if (sel.catalogError(state)) {
            status.textContent = `Could not load channels: ${sel.catalogError(state)}`;
        } else {
            const shown = state.channels.length;
            const hidden = Object.values(state.prefs).filter((p) => p.hidden).length;
            status.textContent = hidden > 0
                ? `${shown} channels in the guide, ${hidden} hidden.`
                : `${shown} channels in the guide.`;
        }
    }

    function renderSection(state, source) {
        const rule = sel.lineupRule(state, source);
        const rows = sel.catalogRows(state, source);

        return el(
            'section',
            { class: 'tvguide-manager-section' },
            el(
                'header',
                { class: 'tvguide-manager-section-head' },
                el('h3', {}, SOURCE_LABELS[source]),
                ruleControl(state, source, rule)
            ),
            rows.length === 0
                ? el('p', { class: 'tvguide-manager-empty' },
                      state.catalogStatus === PoolStatus.READY ? 'Nothing matches.' : '…')
                : el('ul', { class: 'tvguide-manager-list' }, rows.map((row) => renderRow(state, source, row)))
        );
    }

    /**
     * The per-source rule. While it is on, newly-added studios (or tags, or
     * groups) become channels on their own; turning it off freezes the lineup
     * to whatever has been picked explicitly.
     */
    function ruleControl(state, source, rule) {
        const enabled = Boolean(rule);
        const checkboxId = `tvguide-rule-${source}`;
        const thresholdId = `tvguide-rule-threshold-${source}`;

        return el(
            'div',
            { class: 'tvguide-manager-rule' },
            el('input', {
                type: 'checkbox',
                id: checkboxId,
                checked: enabled,
                // Same default as the threshold input below, or enabling a rule
                // would silently apply 0 while the field showed something else.
                onchange: (e) =>
                    setRule(state, source, e.target.checked, rule?.minScenes ?? state.settings.guide_min_scenes)
            }),
            el('label', { for: checkboxId }, 'Include all with at least'),
            el('input', {
                type: 'number',
                id: thresholdId,
                class: 'tvguide-manager-threshold',
                min: '0',
                value: String(rule?.minScenes ?? state.settings.guide_min_scenes),
                disabled: !enabled,
                'aria-label': `Minimum scenes for ${SOURCE_LABELS[source]}`,
                onchange: (e) => setRule(state, source, true, Number(e.target.value))
            }),
            el('span', {}, 'scenes')
        );
    }

    function setRule(state, source, enabled, minScenes) {
        const others = state.lineup.filter(
            (entry) => !(entry.source === source && !entry.ids && !entry.names)
        );
        const lineup = enabled
            ? [...others, { source, minScenes: Number(minScenes) || 0 }]
            : others;
        store.dispatch({ type: Events.SET_LINEUP, lineup });
    }

    function renderRow(state, source, row) {
        const { channel, included, pinned, hidden, pref } = row;
        const isEditing = editing.has(channel.id);

        return el(
            'li',
            {
                class: [
                    'tvguide-manager-row',
                    included && 'is-included',
                    hidden && 'is-hidden',
                    pinned && 'is-pinned'
                ].filter(Boolean).join(' '),
                'data-channel-id': channel.id
            },
            el(
                'div',
                { class: 'tvguide-manager-row-main' },
                logoBadge(pref?.name || pref?.logoUrl
                    ? { ...channel, name: pref.name || channel.name,
                        logo: pref.logoUrl ? { type: 'image', url: pref.logoUrl } : channel.logo }
                    : channel),
                el(
                    'div',
                    { class: 'tvguide-manager-row-text' },
                    el('span', { class: 'tvguide-manager-row-name' }, pref?.name || channel.name),
                    el('span', { class: 'tvguide-manager-row-meta' },
                        pref?.name ? `${channel.name} · ` : '',
                        channel.sceneCount == null ? 'saved filter' : `${channel.sceneCount} scenes`)
                ),
                el(
                    'div',
                    { class: 'tvguide-manager-row-actions' },
                    toggleButton({
                        label: included ? 'Remove from guide' : 'Add to guide',
                        text: included ? 'Remove' : 'Add',
                        pressed: included,
                        onclick: () => toggleIncluded(state, source, channel, included)
                    }),
                    toggleButton({
                        label: pinned ? `Unpin ${channel.name}` : `Pin ${channel.name} to the top`,
                        text: pinned ? '★' : '☆',
                        pressed: pinned,
                        disabled: !included,
                        onclick: () => store.dispatch({ type: Events.TOGGLE_PIN, channelId: channel.id })
                    }),
                    toggleButton({
                        label: hidden ? `Show ${channel.name}` : `Hide ${channel.name}`,
                        text: hidden ? 'Show' : 'Hide',
                        pressed: hidden,
                        disabled: !included,
                        onclick: () => store.dispatch({ type: Events.TOGGLE_HIDDEN, channelId: channel.id })
                    }),
                    el('button', {
                        class: 'tvguide-manager-edit',
                        type: 'button',
                        'aria-expanded': isEditing ? 'true' : 'false',
                        'aria-label': `Customise ${channel.name}`,
                        text: 'Edit',
                        onclick: () => toggleEditor(channel.id)
                    })
                )
            ),
            isEditing ? renderEditor(channel, pref) : null
        );
    }

    function toggleButton({ label, text, pressed, disabled, onclick }) {
        return el('button', {
            class: 'tvguide-manager-toggle',
            type: 'button',
            'aria-label': label,
            'aria-pressed': pressed ? 'true' : 'false',
            disabled: disabled || false,
            onclick
        }, text);
    }

    /**
     * Explicit picks live in a single ids entry per source. Removing a channel
     * the rule swept in also turns the rule off -- otherwise the next resolve
     * would simply bring it straight back, which reads as the button not
     * working.
     */
    function toggleIncluded(state, source, channel, included) {
        const localId = channel.id.slice(source.length + 1);
        const rule = sel.lineupRule(state, source);
        const picks = new Set(sel.explicitIds(state, source));

        if (included) picks.delete(localId);
        else picks.add(localId);

        const others = state.lineup.filter(
            (entry) => !(entry.source === source && Array.isArray(entry.ids))
        );

        let lineup = others;
        if (included && rule) {
            // Freeze the current membership, minus the one being removed.
            const swept = (state.catalog?.[source] || [])
                .filter((c) => c.id !== channel.id)
                .filter((c) => state.allChannels.some((live) => live.id === c.id))
                .map((c) => c.id.slice(source.length + 1));
            swept.forEach((id) => picks.add(id));
            lineup = others.filter((entry) => !(entry.source === source && !entry.ids && !entry.names));
        }

        if (picks.size > 0) lineup = [...lineup, { source, ids: [...picks] }];

        store.dispatch({ type: Events.SET_LINEUP, lineup });
    }

    function renderEditor(channel, pref) {
        const nameId = `tvguide-edit-name-${channel.id}`;
        const logoId = `tvguide-edit-logo-${channel.id}`;
        const capId = `tvguide-edit-cap-${channel.id}`;

        const commit = (patch) =>
            store.dispatch({ type: Events.SET_CHANNEL_PREF, channelId: channel.id, patch });

        return el(
            'div',
            { class: 'tvguide-manager-editor' },
            field(nameId, 'Display name', el('input', {
                type: 'text',
                id: nameId,
                value: pref?.name || '',
                placeholder: channel.name,
                onchange: (e) => commit({ name: e.target.value })
            })),
            field(logoId, 'Logo URL', el('input', {
                type: 'url',
                id: logoId,
                value: pref?.logoUrl || '',
                placeholder: 'Leave blank for the default',
                onchange: (e) => commit({ logoUrl: e.target.value })
            })),
            field(capId, 'Scenes in rotation', el('input', {
                type: 'number',
                id: capId,
                min: '1',
                value: pref?.poolCap ? String(pref.poolCap) : '',
                placeholder: 'Default',
                onchange: (e) => commit({ poolCap: e.target.value })
            }))
        );
    }

    function field(id, label, input) {
        return el('div', { class: 'tvguide-manager-field' }, el('label', { for: id }, label), input);
    }
}
