/**
 * Inline SVG control icons.
 *
 * Not emoji: those render differently on every platform, carry their own
 * colour, and read as decoration rather than as controls. These inherit
 * currentColor and size with the button.
 */

function icon(paths, { filled = true } = {}) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    for (const d of paths) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        if (filled) {
            path.setAttribute('fill', 'currentColor');
        } else {
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', 'currentColor');
            path.setAttribute('stroke-width', '2');
            path.setAttribute('stroke-linecap', 'round');
            path.setAttribute('stroke-linejoin', 'round');
        }
        svg.appendChild(path);
    }
    return svg;
}

export const ICONS = {
    play: () => icon(['M8 5v14l11-7z']),
    pause: () => icon(['M6 5h4v14H6zM14 5h4v14h-4z']),
    muted: () => icon(['M4 9v6h4l5 4V5L8 9H4z', 'M16.5 9.5l5 5M21.5 9.5l-5 5']),
    unmuted: () => icon(['M4 9v6h4l5 4V5L8 9H4z', 'M16.5 8.5a5 5 0 010 7']),
    theater: () => icon(['M3 6h18v9H3z'], { filled: false }),
    fullscreen: () => icon(['M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'], { filled: false }),
    exitFullscreen: () => icon(['M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5'], { filled: false })
};

/** Replace a button's icon while leaving its text label alone. */
export function setIcon(button, name) {
    const existing = button.querySelector('svg');
    if (existing) existing.remove();
    button.insertBefore(ICONS[name](), button.firstChild);
}
