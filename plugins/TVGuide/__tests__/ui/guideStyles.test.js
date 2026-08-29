import { readFileSync } from 'node:fs';

const styles = readFileSync('src/styles/index.css', 'utf8');

describe('short-scene dividers', () => {
    it('stay inside the rounded programme card', () => {
        expect(styles).toMatch(/\.tvguide-block-divider\s*\{[^}]*top:\s*4px;[^}]*bottom:\s*4px;/s);
    });
});
