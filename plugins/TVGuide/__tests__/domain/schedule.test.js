import {
    hashString,
    mulberry32,
    seededShuffle,
    dayBucket,
    buildDaySchedule,
    programAt,
    scheduleBetween,
    MAX_SCHEDULE_WALK,
    condenseRow,
    shouldCondense
} from '../../src/domain/schedule.js';

const HOUR = 3600000;
const MIN = 60000;

/** Scenes with tidy round durations so offsets are readable in assertions. */
function scenes(...durationsMinutes) {
    return durationsMinutes.map((m, i) => ({
        id: String(i + 1),
        title: `Scene ${i + 1}`,
        files: [{ duration: m * 60 }]
    }));
}

describe('hashString', () => {
    it('is deterministic', () => {
        expect(hashString('studio:12|2026-08-22')).toBe(hashString('studio:12|2026-08-22'));
    });

    it('separates keys that differ only by source prefix', () => {
        expect(hashString('studio:12')).not.toBe(hashString('tag:12'));
    });

    it('returns an unsigned 32-bit integer', () => {
        for (const s of ['', 'a', 'a longer string with spaces', 'éè']) {
            const h = hashString(s);
            expect(Number.isInteger(h)).toBe(true);
            expect(h).toBeGreaterThanOrEqual(0);
            expect(h).toBeLessThanOrEqual(0xffffffff);
        }
    });
});

describe('mulberry32', () => {
    it('produces a repeatable sequence for a seed', () => {
        const a = mulberry32(123);
        const b = mulberry32(123);
        expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    });

    it('stays within [0, 1)', () => {
        const rng = mulberry32(7);
        for (let i = 0; i < 500; i++) {
            const v = rng();
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        }
    });

    it('diverges for different seeds', () => {
        expect(mulberry32(1)()).not.toBe(mulberry32(2)());
    });
});

describe('seededShuffle', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];

    it('is a permutation, not a mutation', () => {
        const out = seededShuffle(items, 42);
        expect(out).not.toBe(items);
        expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
        expect([...out].sort()).toEqual(items);
    });

    it('is deterministic for a seed', () => {
        expect(seededShuffle(items, 42)).toEqual(seededShuffle(items, 42));
    });

    it('differs across seeds', () => {
        expect(seededShuffle(items, 1)).not.toEqual(seededShuffle(items, 2));
    });

    it('handles empty and single-element input', () => {
        expect(seededShuffle([], 1)).toEqual([]);
        expect(seededShuffle(['x'], 1)).toEqual(['x']);
    });
});

describe('dayBucket', () => {
    it('keys by local calendar date and starts at local midnight', () => {
        const noon = new Date(2026, 7, 22, 12, 0, 0).getTime();
        const { key, startMs } = dayBucket(noon);
        expect(key).toBe('2026-08-22');
        expect(new Date(startMs).getHours()).toBe(0);
        expect(new Date(startMs).getMinutes()).toBe(0);
        expect(startMs).toBeLessThanOrEqual(noon);
    });

    it('zero-pads month and day', () => {
        expect(dayBucket(new Date(2026, 0, 5, 9).getTime()).key).toBe('2026-01-05');
    });

    it('rolls over at local midnight', () => {
        const before = dayBucket(new Date(2026, 7, 22, 23, 59, 59).getTime());
        const after = dayBucket(new Date(2026, 7, 23, 0, 0, 1).getTime());
        expect(before.key).toBe('2026-08-22');
        expect(after.key).toBe('2026-08-23');
        expect(after.startMs).toBeGreaterThan(before.startMs);
    });
});

describe('buildDaySchedule', () => {
    it('lays scenes end to end with cumulative offsets', () => {
        const s = buildDaySchedule('ch', scenes(10, 20, 30), '2026-08-22');
        expect(s.totalMs).toBe(60 * MIN);
        expect(s.entries.map((e) => e.offsetMs)).toEqual([0, s.entries[1].offsetMs, s.entries[2].offsetMs]);
        // offsets are the running sum of the durations in shuffled order
        let running = 0;
        for (const e of s.entries) {
            expect(e.offsetMs).toBe(running);
            running += e.durationMs;
        }
        expect(running).toBe(s.totalMs);
    });

    it('is deterministic for the same channel and day', () => {
        const a = buildDaySchedule('studio:1', scenes(5, 10, 15, 20), '2026-08-22');
        const b = buildDaySchedule('studio:1', scenes(5, 10, 15, 20), '2026-08-22');
        expect(a.entries.map((e) => e.scene.id)).toEqual(b.entries.map((e) => e.scene.id));
    });

    it('orders differently for a different channel or a different day', () => {
        const pool = scenes(5, 10, 15, 20, 25, 30, 35, 40);
        const base = buildDaySchedule('studio:1', pool, '2026-08-22').entries.map((e) => e.scene.id);
        const otherChannel = buildDaySchedule('studio:2', pool, '2026-08-22').entries.map((e) => e.scene.id);
        const otherDay = buildDaySchedule('studio:1', pool, '2026-08-23').entries.map((e) => e.scene.id);
        expect(otherChannel).not.toEqual(base);
        expect(otherDay).not.toEqual(base);
    });

    it('drops scenes with missing, zero or negative duration', () => {
        const pool = [
            { id: 'a', files: [{ duration: 600 }] },
            { id: 'b', files: [{ duration: 0 }] },
            { id: 'c', files: [] },
            { id: 'd' },
            { id: 'e', files: [{ duration: null }] },
            { id: 'f', files: [{ duration: -5 }] }
        ];
        const s = buildDaySchedule('ch', pool, '2026-08-22');
        expect(s.entries.map((e) => e.scene.id)).toEqual(['a']);
        expect(s.totalMs).toBe(10 * MIN);
    });

    it('returns an empty schedule for an empty pool', () => {
        expect(buildDaySchedule('ch', [], '2026-08-22')).toEqual({ entries: [], totalMs: 0 });
    });

    it('returns an empty schedule when every scene lacks a duration', () => {
        const s = buildDaySchedule('ch', [{ id: 'a' }, { id: 'b', files: [{ duration: 0 }] }], '2026-08-22');
        expect(s).toEqual({ entries: [], totalMs: 0 });
    });

    it('tolerates a null pool', () => {
        expect(buildDaySchedule('ch', null, '2026-08-22')).toEqual({ entries: [], totalMs: 0 });
    });
});

describe('programAt', () => {
    const DAY_START = new Date(2026, 7, 22, 0, 0, 0).getTime();
    const sched = buildDaySchedule('ch', scenes(30, 30, 30), '2026-08-22');

    it('returns null for an empty schedule', () => {
        expect(programAt({ entries: [], totalMs: 0 }, DAY_START, DAY_START)).toBeNull();
    });

    it('returns the first entry at the start of the broadcast day', () => {
        const p = programAt(sched, DAY_START, DAY_START);
        expect(p.index).toBe(0);
        expect(p.elapsedMs).toBe(0);
        expect(p.startMs).toBe(DAY_START);
        expect(p.endMs).toBe(DAY_START + 30 * MIN);
    });

    it('reports elapsed time inside the current programme', () => {
        const p = programAt(sched, DAY_START + 12 * MIN, DAY_START);
        expect(p.index).toBe(0);
        expect(p.elapsedMs).toBe(12 * MIN);
        expect(p.durationMs).toBe(30 * MIN);
    });

    it('advances to the next entry at an exact boundary', () => {
        const p = programAt(sched, DAY_START + 30 * MIN, DAY_START);
        expect(p.index).toBe(1);
        expect(p.elapsedMs).toBe(0);
    });

    it('loops once the day total is exhausted, keeping absolute times honest', () => {
        // total is 90 min; 95 min in we are 5 min into entry 0 of the second loop
        const p = programAt(sched, DAY_START + 95 * MIN, DAY_START);
        expect(p.index).toBe(0);
        expect(p.elapsedMs).toBe(5 * MIN);
        expect(p.startMs).toBe(DAY_START + 90 * MIN);
        expect(p.endMs).toBe(DAY_START + 120 * MIN);
    });

    it('handles times before the day start without going negative', () => {
        const p = programAt(sched, DAY_START - 10 * MIN, DAY_START);
        expect(p).not.toBeNull();
        expect(p.elapsedMs).toBeGreaterThanOrEqual(0);
        expect(p.elapsedMs).toBeLessThan(p.durationMs);
        expect(p.startMs).toBeLessThanOrEqual(DAY_START - 10 * MIN);
        expect(p.endMs).toBeGreaterThan(DAY_START - 10 * MIN);
    });

    it('always reports a time that falls inside the returned programme', () => {
        for (let m = 0; m < 200; m += 7) {
            const now = DAY_START + m * MIN;
            const p = programAt(sched, now, DAY_START);
            expect(p.startMs).toBeLessThanOrEqual(now);
            expect(p.endMs).toBeGreaterThan(now);
            expect(p.endMs - p.startMs).toBe(p.durationMs);
            expect(now - p.startMs).toBe(p.elapsedMs);
        }
    });

    it('handles a single scene longer than a day', () => {
        const long = buildDaySchedule('ch', scenes(60 * 30), '2026-08-22'); // 30 hours
        const p = programAt(long, DAY_START + 25 * HOUR, DAY_START);
        expect(p.index).toBe(0);
        expect(p.elapsedMs).toBe(25 * HOUR);
    });
});

describe('scheduleBetween', () => {
    const DAY_START = new Date(2026, 7, 22, 0, 0, 0).getTime();
    const sched = buildDaySchedule('ch', scenes(30, 30, 30), '2026-08-22');

    it('returns an empty list for an empty schedule', () => {
        expect(scheduleBetween({ entries: [], totalMs: 0 }, DAY_START, DAY_START, DAY_START + HOUR)).toEqual([]);
    });

    it('covers the whole window with contiguous programmes', () => {
        const from = DAY_START + 10 * MIN;
        const to = from + 2 * HOUR;
        const out = scheduleBetween(sched, DAY_START, from, to);

        expect(out[0].startMs).toBeLessThanOrEqual(from);
        expect(out[out.length - 1].endMs).toBeGreaterThanOrEqual(to);
        for (let i = 1; i < out.length; i++) {
            expect(out[i].startMs).toBe(out[i - 1].endMs);
        }
    });

    it('includes the programme already in progress at the window start', () => {
        const out = scheduleBetween(sched, DAY_START, DAY_START + 45 * MIN, DAY_START + 50 * MIN);
        expect(out[0].startMs).toBe(DAY_START + 30 * MIN);
        expect(out[0].index).toBe(1);
    });

    it('spans midnight without a gap', () => {
        const out = scheduleBetween(sched, DAY_START, DAY_START + 23.5 * HOUR, DAY_START + 24.5 * HOUR);
        for (let i = 1; i < out.length; i++) {
            expect(out[i].startMs).toBe(out[i - 1].endMs);
        }
        expect(out[out.length - 1].endMs).toBeGreaterThanOrEqual(DAY_START + 24.5 * HOUR);
    });

    it('returns a single block when one scene spans the entire window', () => {
        const long = buildDaySchedule('ch', scenes(600), '2026-08-22');
        const out = scheduleBetween(long, DAY_START, DAY_START + HOUR, DAY_START + 4 * HOUR);
        expect(out).toHaveLength(1);
    });

    it('caps the walk so a pathological window cannot hang', () => {
        const tiny = buildDaySchedule('ch', [{ id: 'x', files: [{ duration: 1 }] }], '2026-08-22');
        const out = scheduleBetween(tiny, DAY_START, DAY_START, DAY_START + 365 * 24 * HOUR);
        expect(out.length).toBe(MAX_SCHEDULE_WALK);
    });

    it('returns nothing when the window is inverted or empty', () => {
        expect(scheduleBetween(sched, DAY_START, DAY_START + HOUR, DAY_START)).toEqual([]);
        expect(scheduleBetween(sched, DAY_START, DAY_START, DAY_START)).toEqual([]);
    });
});

describe('shouldCondense', () => {
    const rows = (n) => Array.from({ length: n }, () => ({}));

    it('leaves a normal row alone', () => {
        // 6 blocks across 1200px is 200px each -- plenty for a title.
        expect(shouldCondense(rows(6), 1200)).toBe(false);
    });

    it('condenses a row of slivers', () => {
        // 40 blocks across 1200px is 30px each.
        expect(shouldCondense(rows(40), 1200)).toBe(true);
    });

    it('never condenses a row with few enough blocks to read', () => {
        expect(shouldCondense(rows(3), 100)).toBe(false);
        expect(shouldCondense(rows(0), 100)).toBe(false);
    });

    it('depends on the available width, not the count alone', () => {
        expect(shouldCondense(rows(10), 3000)).toBe(false);
        expect(shouldCondense(rows(10), 600)).toBe(true);
    });

    it('tolerates junk', () => {
        expect(shouldCondense(null, 1000)).toBe(false);
    });
});

describe('condenseRow', () => {
    const MIN_ = 60000;
    const BASE = new Date(2026, 7, 22, 12, 0, 0).getTime();

    /** n back-to-back 2-minute programmes. */
    const strip = (n) =>
        Array.from({ length: n }, (_, i) => ({
            scene: { id: `s${i}`, title: `Scene ${i}` },
            startMs: BASE + i * 2 * MIN_,
            endMs: BASE + (i + 1) * 2 * MIN_
        }));

    const kinds = (segs) => segs.map((s) => (s.kind === 'count' ? `+${s.n}` : s.program.scene.id));

    it('produces count / prev / current / next / count around the anchor', () => {
        const programs = strip(30);
        const anchor = programs[10].startMs + MIN_;
        expect(kinds(condenseRow(programs, anchor))).toEqual(['+9', 's9', 's10', 's11', '+18']);
    });

    it('names the anchored programme', () => {
        const programs = strip(30);
        const segs = condenseRow(programs, programs[10].startMs);
        const named = segs.filter((s) => s.kind === 'program').map((s) => s.program.scene.id);
        expect(named).toContain('s10');
    });

    it('counts every programme it hid', () => {
        const programs = strip(30);
        const segs = condenseRow(programs, programs[10].startMs);
        const hidden = segs.filter((s) => s.kind === 'count').reduce((sum, s) => sum + s.n, 0);
        const shown = segs.filter((s) => s.kind === 'program').length;
        expect(hidden + shown).toBe(30);
    });

    it('keeps a full label window when the anchor is at the very start', () => {
        const programs = strip(30);
        expect(kinds(condenseRow(programs, programs[0].startMs))).toEqual(['s0', 's1', 's2', '+27']);
    });

    it('keeps a full label window when the anchor is at the very end', () => {
        const programs = strip(30);
        expect(kinds(condenseRow(programs, programs[29].startMs))).toEqual(['+27', 's27', 's28', 's29']);
    });

    it('falls back to an edge when the anchor is outside the row', () => {
        const programs = strip(30);
        expect(kinds(condenseRow(programs, BASE - 5 * MIN_))[0]).toBe('s0');
        expect(kinds(condenseRow(programs, BASE + 1000 * MIN_)).pop()).toBe('s29');
    });

    it('honours a wider label window', () => {
        const programs = strip(30);
        expect(kinds(condenseRow(programs, programs[10].startMs, 5)))
            .toEqual(['+8', 's8', 's9', 's10', 's11', 's12', '+17']);
    });

    it('does not condense a row that already fits', () => {
        const programs = strip(3);
        expect(kinds(condenseRow(programs, programs[0].startMs))).toEqual(['s0', 's1', 's2']);
    });

    it('returns nothing for an empty row', () => {
        expect(condenseRow([], BASE)).toEqual([]);
        expect(condenseRow(null, BASE)).toEqual([]);
    });
});
