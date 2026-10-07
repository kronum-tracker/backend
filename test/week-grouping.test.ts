import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { calendarWeek, groupByWeek, periodBounds } from '../../frontend/lib/time';
import type { Entry } from '../../frontend/lib/api';

const previousZone = process.env.TZ;
beforeAll(() => {
    process.env.TZ = 'Europe/Madrid';
});
afterAll(() => {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
});
const entry = (start: string, end: string): Entry => ({
    _id: crypto.randomUUID(),
    start,
    end,
    description: 'Test',
    assignees: [],
    tags: [],
    createdBy: { _id: 'a', name: 'A', email: 'a@test.com' },
    createdAt: start,
});
describe('Monday to Sunday grouping', () => {
    it('places Sunday in the previous week and Monday in the new week across years', () => {
        const groups = groupByWeek([
            entry('2026-01-04T10:00:00+01:00', '2026-01-04T11:00:00+01:00'),
            entry('2026-01-05T10:00:00+01:00', '2026-01-05T11:00:00+01:00'),
        ]);
        expect(groups.map((g) => g.key)).toEqual(['2026-01-05', '2025-12-29']);
        expect(groups[1].sunday.getDay()).toBe(0);
    });
    it('splits a midnight interval across Monday without double counting', () => {
        const groups = groupByWeek([
            entry('2026-10-04T23:00:00+02:00', '2026-10-05T01:00:00+02:00'),
        ]);
        expect(groups.map((g) => g.milliseconds)).toEqual([3600000, 3600000]);
        expect(groups.reduce((sum, g) => sum + g.milliseconds, 0)).toBe(7200000);
    });
    it('uses calendar Mondays across daylight saving and includes the selected Sunday', () => {
        const interval = entry('2026-03-23T00:00:00+01:00', '2026-03-30T00:00:00+02:00');
        const groups = groupByWeek([interval]);
        expect(groups).toHaveLength(1);
        expect(groups[0].milliseconds).toBe(167 * 3600000);
        expect(groupByWeek([interval], '2026-03-29', '2026-03-29')[0].milliseconds).toBe(
            23 * 3600000,
        );
        const bounds = periodBounds('2026-03-29', '2026-03-29');
        expect(bounds.end!.getTime() - bounds.start!.getTime()).toBe(23 * 3600000);
        const autumn = entry('2026-10-19T00:00:00+02:00', '2026-10-26T00:00:00+01:00');
        expect(groupByWeek([autumn])[0].milliseconds).toBe(169 * 3600000);
        const autumnSunday = periodBounds('2026-10-25', '2026-10-25');
        expect(autumnSunday.end!.getTime() - autumnSunday.start!.getTime()).toBe(25 * 3600000);
    });
});

describe('Weekly calendar', () => {
    it('splits overnight entries, keeps seconds and separates simultaneous blocks', () => {
        const first = entry('2026-10-05T09:12:34+02:00', '2026-10-05T10:23:45+02:00');
        const second = entry('2026-10-05T09:30:00+02:00', '2026-10-05T11:00:00+02:00');
        const overnight = entry('2026-10-05T23:00:00+02:00', '2026-10-06T01:00:00+02:00');
        const days = calendarWeek(
            [first, second, overnight],
            new Date('2026-10-07T12:00:00+02:00'),
        );
        expect(days).toHaveLength(7);
        expect(days[0].date.getDay()).toBe(1);
        expect(days[6].date.getDay()).toBe(0);
        expect(days[0].segments[0].top).toBeCloseTo(9 * 60 + 12 + 34 / 60);
        expect(days[0].segments.slice(0, 2).map((s) => s.columns)).toEqual([2, 2]);
        expect(days[0].segments.slice(0, 2).map((s) => s.column)).toEqual([0, 1]);
        expect(days[0].segments[2].columns).toBe(1);
        expect(days[0].segments[2].milliseconds).toBe(3600000);
        expect(days[1].milliseconds).toBe(3600000);
    });
    it('clips to the selected calendar week across daylight saving without losing hours', () => {
        const allWeek = entry('2026-03-22T23:00:00+01:00', '2026-03-30T01:00:00+02:00');
        const days = calendarWeek([allWeek], new Date('2026-03-25T12:00:00+01:00'));
        expect(days.reduce((sum, day) => sum + day.milliseconds, 0)).toBe(167 * 3600000);
        expect(days[6].milliseconds).toBe(23 * 3600000);
    });
    it('keeps a last-second entry selectable within its day', () => {
        const days = calendarWeek(
            [entry('2026-10-05T23:59:58+02:00', '2026-10-05T23:59:59+02:00')],
            new Date('2026-10-05T12:00:00+02:00'),
        );
        const segment = days[0].segments[0];
        expect(segment.milliseconds).toBe(1000);
        expect(segment.bottom - segment.top).toBeGreaterThanOrEqual(28);
        expect(segment.bottom).toBeLessThanOrEqual(1440);
    });
});
