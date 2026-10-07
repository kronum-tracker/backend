import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    activityByPeriod,
    filterEntries,
    groupByMember,
    groupByProject,
} from '../../frontend/lib/time';
import type { Entry, User } from '../../frontend/lib/api';

const previousZone = process.env.TZ;
beforeAll(() => {
    process.env.TZ = 'Europe/Madrid';
});
afterAll(() => {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
});
const ana: User = { _id: 'ana', name: 'Ana', email: 'ana@example.test' };
const bruno: User = { _id: 'bruno', name: 'Bruno', email: 'bruno@example.test' };
const entry = (
    id: string,
    start: string,
    end: string,
    assignees = [ana],
    tags = ['design'],
): Entry => ({
    _id: id,
    description: id,
    start,
    end,
    assignees,
    tags,
    createdBy: ana,
    createdAt: start,
});

describe('Entry views and selected periods', () => {
    it('groups personal entries by project, clips the period and counts shared entries once', () => {
        const alpha = { _id: 'alpha', name: 'Alpha', color: '#6759e8' };
        const beta = { _id: 'beta', name: 'Beta', color: '#8877de' };
        const shared = {
            ...entry('shared', '2026-10-04T23:00:00+02:00', '2026-10-05T01:00:00+02:00', [
                ana,
                bruno,
            ]),
            project: alpha,
        };
        const recent = {
            ...entry('recent', '2026-10-05T09:00:00+02:00', '2026-10-05T10:00:15+02:00'),
            project: alpha,
        };
        const other = {
            ...entry('other', '2026-10-05T12:00:00+02:00', '2026-10-05T12:30:10+02:00'),
            project: beta,
        };
        const outside = {
            ...entry('outside', '2026-10-06T09:00:00+02:00', '2026-10-06T10:00:00+02:00'),
            project: beta,
        };
        const groups = groupByProject([shared, other, recent, outside], '2026-10-05', '2026-10-05');
        expect(
            groups.map((group) => [
                group.project._id,
                group.milliseconds,
                group.segments.map((segment) => segment.entry._id),
            ]),
        ).toEqual([
            ['alpha', 7215000, ['recent', 'shared']],
            ['beta', 1810000, ['other']],
        ]);
        expect(groups[0].segments[1].entry).toBe(shared);
        expect(groups[0].segments[1].start).toBe('2026-10-04T22:00:00.000Z');
    });
    it('groups shared entries per member with clipped durations without changing the entry', () => {
        const shared = entry('shared', '2026-10-04T23:00:00+02:00', '2026-10-05T01:00:00+02:00', [
            ana,
            bruno,
        ]);
        const own = entry('own', '2026-10-05T09:00:00+02:00', '2026-10-05T10:00:15+02:00');
        const groups = groupByMember([shared, own], '2026-10-05', '2026-10-05');
        expect(
            groups.map((group) => [group.user._id, group.milliseconds, group.segments.length]),
        ).toEqual([
            ['ana', 7215000, 2],
            ['bruno', 3600000, 1],
        ]);
        expect(groups[0].segments[0].entry).toBe(shared);
        expect(shared.start).toBe('2026-10-04T23:00:00+02:00');
    });
    it('combines description, members and tags while keeping OR within each selection', () => {
        const entries = [
            entry('Diseño compartido', '2026-10-05T09:00:00+02:00', '2026-10-05T10:00:00+02:00', [
                ana,
                bruno,
            ]),
            entry(
                'Diseño individual',
                '2026-10-05T10:00:00+02:00',
                '2026-10-05T11:00:00+02:00',
                [ana],
                ['review'],
            ),
        ];
        expect(
            filterEntries(entries, {
                search: ' DISEÑO ',
                members: ['bruno'],
                tags: ['design', 'review'],
            }),
        ).toEqual([entries[0]]);
        expect(filterEntries(entries, { members: ['missing'], tags: [] })).toEqual([]);
        expect(filterEntries(entries, {})).toEqual(entries);
    });
    it('reflects custom dates in daily activity and includes empty days and split intervals', () => {
        const entries = [
            entry('overnight', '2026-10-04T23:00:00+02:00', '2026-10-05T01:00:00+02:00'),
        ];
        const activity = activityByPeriod(entries, '2026-10-05', '2026-10-07');
        expect(activity.weekly).toBe(false);
        expect(activity.buckets.map((bucket) => [bucket.key, bucket.milliseconds])).toEqual([
            ['2026-10-05', 3600000],
            ['2026-10-06', 0],
            ['2026-10-07', 0],
        ]);
        expect(activityByPeriod(entries, '2026-10-07', '2026-10-05').buckets).toEqual([]);
    });
    it('keeps empty weeks for long custom periods and clips boundary weeks across daylight saving', () => {
        const entries = [entry('spring', '2026-03-29T00:00:00+01:00', '2026-03-30T00:00:00+02:00')];
        const activity = activityByPeriod(entries, '2026-03-01', '2026-04-05');
        expect(activity.weekly).toBe(true);
        expect(activity.buckets).toHaveLength(6);
        expect(activity.buckets[0].start.getDate()).toBe(1);
        expect(activity.buckets[5].end.getDate()).toBe(5);
        expect(activity.buckets.filter((bucket) => bucket.milliseconds === 0)).toHaveLength(5);
        expect(activity.buckets.reduce((sum, bucket) => sum + bucket.milliseconds, 0)).toBe(
            23 * 3600000,
        );
    });
});
