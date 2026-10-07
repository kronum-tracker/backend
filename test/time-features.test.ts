import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { TimeEntry } from '../src/models/tracking.model.js';

const base = '/api/v1';
beforeAll(async () => {
    await TimeEntry.init();
});
async function fixture() {
    const owner = request.agent(app),
        other = request.agent(app);
    const a = await owner.post(`${base}/auth/register`).send({
        name: 'Ana',
        email: `ana-${crypto.randomUUID()}@test.com`,
        password: 'password-test',
        passwordConfirmation: 'password-test',
    });
    const address = `bea-${crypto.randomUUID()}@test.com`;
    const b = await other
        .post(`${base}/auth/register`)
        .send({
            name: 'Bea',
            email: address,
            password: 'password-test',
            passwordConfirmation: 'password-test',
        });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const p = await owner.post(`${base}/projects`).send({ name: 'Timers' });
    const path = `${base}/projects/${p.body.data._id}`;
    return { owner, other, a: a.body.data, b: b.body.data, project: p.body.data, path, address };
}
describe('Live timers and reports', () => {
    it('continues an entry with its metadata and leaves the original intact', async () => {
        const { owner, other, a, b, path, address } = await fixture();
        const invite = await owner.post(`${path}/invitations`).send({ email: address });
        await other
            .post(`${base}/invitations/${invite.body.data._id}/respond`)
            .send({ status: 'accepted' });
        const tags = await owner.post(`${path}/tags`).send({ name: 'Design' });
        const tag = tags.body.data[0]._id;
        const original = (
            await owner.post(`${path}/entries`).send({
                description: 'Shared task',
                start: '2026-10-05T09:12:34Z',
                end: '2026-10-05T10:23:45Z',
                assignees: [a._id, b._id],
                tags: [tag],
            })
        ).body.data;
        const before = Date.now();
        const resumed = await other
            .post(`${path}/timer`)
            .send({ entryId: original._id, description: 'Ignored' });
        expect(resumed.status).toBe(201);
        const timer = resumed.body.data.timer;
        expect(timer._id).not.toBe(original._id);
        expect(timer.description).toBe('Shared task');
        expect(timer.tags).toEqual([tag]);
        expect(timer.assignees.map((person: { _id: string }) => person._id).sort()).toEqual(
            [a._id, b._id].sort(),
        );
        expect(Date.parse(timer.start)).toBeGreaterThanOrEqual(before);
        expect(timer.end).toBeNull();
        expect((await other.post(`${path}/timer`).send({ entryId: original._id })).status).toBe(
            409,
        );
        expect((await other.post(`${path}/timer`).send({ entryId: timer._id })).status).toBe(404);
        await other.post(`${base}/timer/${timer._id}/stop`);
        const saved = await TimeEntry.findById(original._id);
        expect(saved!.start.toISOString()).toBe(original.start);
        expect(saved!.end!.toISOString()).toBe(original.end);
        expect(saved!.description).toBe(original.description);
        await owner.delete(`${path}/members/${b._id}`);
        const afterRemoval = await owner.post(`${path}/timer`).send({ entryId: original._id });
        expect(
            afterRemoval.body.data.timer.assignees.map((person: { _id: string }) => person._id),
        ).toEqual([a._id]);
        expect((await other.post(`${path}/timer`).send({ entryId: original._id })).status).toBe(
            404,
        );
        const another = (await owner.post(`${base}/projects`).send({ name: 'Other project' })).body
            .data;
        expect(
            (
                await owner
                    .post(`${base}/projects/${another._id}/timer`)
                    .send({ entryId: original._id })
            ).status,
        ).toBe(404);
    });
    it('returns personal assignments across accessible projects and excludes active timers', async () => {
        const { owner, other, a, b, path, address } = await fixture();
        const invite = await owner.post(`${path}/invitations`).send({ email: address });
        await other
            .post(`${base}/invitations/${invite.body.data._id}/respond`)
            .send({ status: 'accepted' });
        const data = {
            description: 'Personal task',
            start: '2026-10-04T23:30:00Z',
            end: '2026-10-05T01:00:00Z',
        };
        await owner.post(`${path}/entries`).send({ ...data, assignees: [a._id] });
        const shared = (
            await owner.post(`${path}/entries`).send({ ...data, assignees: [a._id, b._id] })
        ).body.data;
        const privateProject = (await other.post(`${base}/projects`).send({ name: 'Private' })).body
            .data;
        const privateEntry = (
            await other
                .post(`${base}/projects/${privateProject._id}/entries`)
                .send({ ...data, assignees: [b._id] })
        ).body.data;
        await other.post(`${path}/timer`).send({});
        const query = { from: '2026-10-05T00:00:00Z', to: '2026-10-06T00:00:00Z' };
        const list = await other.get(`${base}/me/entries`).query(query);
        expect(list.status).toBe(200);
        expect(list.body.data.map((e: { _id: string }) => e._id).sort()).toEqual(
            [shared._id, privateEntry._id].sort(),
        );
        expect(
            list.body.data.find((e: { _id: string }) => e._id === privateEntry._id).project.name,
        ).toBe('Private');
        expect((await owner.get(`${base}/me/entries`).query(query)).body.data).toHaveLength(2);
        expect((await request(app).get(`${base}/me/entries`).query(query)).status).toBe(401);
        expect(
            (await owner.get(`${base}/me/entries`).query({ from: query.to, to: query.from }))
                .status,
        ).toBe(400);
        await owner.delete(`${path}/members/${b._id}`);
        const afterRemoval = await other.get(`${base}/me/entries`).query(query);
        expect(afterRemoval.body.data.map((e: { _id: string }) => e._id)).toEqual([
            privateEntry._id,
        ]);
    });
    it('starts at server time, survives a new session, forbids duplicate timers, and stops exactly once', async () => {
        const { owner, other, a, path } = await fixture();
        const before = Date.now();
        const running = await owner
            .post(`${path}/timer`)
            .send({ description: 'Live task', assignees: [a._id] });
        expect(running.status).toBe(201);
        const timer = running.body.data.timer;
        expect(Date.parse(timer.start)).toBeGreaterThanOrEqual(before);
        expect(timer.end).toBeNull();
        expect((await owner.get(`${base}/timer`)).body.data.timer._id).toBe(timer._id);
        const p2 = await owner.post(`${base}/projects`).send({ name: 'Another' });
        expect(
            (await owner.post(`${base}/projects/${p2.body.data._id}/timer`).send({})).status,
        ).toBe(409);
        expect((await owner.get(`${path}/entries`)).body.data).toEqual([]);
        expect((await other.post(`${base}/timer/${timer._id}/stop`)).status).toBe(404);
        expect(
            (
                await owner.patch(`${path}/entries/${timer._id}`).send({
                    description: 'Bad stop',
                    start: timer.start,
                    end: new Date().toISOString(),
                    assignees: [a._id],
                })
            ).status,
        ).toBe(409);
        const fresh = request.agent(app);
        await fresh.post(`${base}/auth/login`).send({ email: a.email, password: 'password-test' });
        expect((await fresh.get(`${base}/timer`)).body.data.timer._id).toBe(timer._id);
        const results = await Promise.all(
            [owner, fresh].map((agent) => agent.post(`${base}/timer/${timer._id}/stop`)),
        );
        expect(results.every((result) => result.status === 200)).toBe(true);
        expect(results.every((result) => !!result.body.data.end)).toBe(true);
        expect(results[0].body.data.end).toBe(results[1].body.data.end);
        const entries = (await owner.get(`${path}/entries`)).body.data;
        expect(entries).toHaveLength(1);
        expect(Date.parse(entries[0].end)).toBeGreaterThan(Date.parse(entries[0].start));
        expect((await owner.get(`${base}/timer`)).body.data.timer).toBeNull();
    });
    it('protects timers from other members and preserves time when the tracking member is removed', async () => {
        const { owner, other, path, b, address } = await fixture();
        const invite = await owner.post(`${path}/invitations`).send({ email: address });
        await other
            .post(`${base}/invitations/${invite.body.data._id}/respond`)
            .send({ status: 'accepted' });
        const timer = (await other.post(`${path}/timer`).send({})).body.data.timer;
        expect((await owner.post(`${base}/timer/${timer._id}/stop`)).status).toBe(404);
        expect((await owner.delete(`${path}/entries/${timer._id}`)).status).toBe(404);
        await owner.delete(`${path}/members/${b._id}`);
        expect((await other.get(`${base}/timer`)).body.data.timer).toBeNull();
        expect((await owner.get(`${path}/entries`)).body.data).toHaveLength(1);
    });
    it('clips reports to the period, credits each assignee and excludes running timers', async () => {
        const { owner, other, a, b, path, address } = await fixture();
        const invite = await owner.post(`${path}/invitations`).send({ email: address });
        await other
            .post(`${base}/invitations/${invite.body.data._id}/respond`)
            .send({ status: 'accepted' });
        await owner.post(`${path}/entries`).send({
            description: 'Shared overnight task',
            start: '2026-10-04T22:00:00Z',
            end: '2026-10-05T02:00:00Z',
            assignees: [a._id, b._id],
        });
        await owner.post(`${path}/entries`).send({
            description: 'Ana task',
            start: '2026-10-05T10:00:00Z',
            end: '2026-10-05T11:00:00Z',
            assignees: [a._id],
        });
        await owner.post(`${path}/timer`).send({});
        const report = await other
            .get(`${path}/report`)
            .query({ from: '2026-10-05T00:00:00Z', to: '2026-10-06T00:00:00Z' });
        expect(report.status).toBe(200);
        expect(
            report.body.data.people.find((p: { user: { _id: string } }) => p.user._id === a._id)
                .milliseconds,
        ).toBe(3 * 3600000);
        expect(
            report.body.data.people.find((p: { user: { _id: string } }) => p.user._id === b._id)
                .milliseconds,
        ).toBe(2 * 3600000);
        expect(report.body.data.teamMilliseconds).toBe(5 * 3600000);
        expect(report.body.data.entryMilliseconds).toBe(3 * 3600000);
        expect(report.body.data.count).toBe(2);
        const empty = await owner
            .get(`${path}/report`)
            .query({ from: '2027-01-01T00:00:00Z', to: '2027-01-02T00:00:00Z' });
        expect(empty.body.data.teamMilliseconds).toBe(0);
        expect(empty.body.data.people).toHaveLength(2);
        expect(
            (
                await owner
                    .get(`${path}/report`)
                    .query({ from: 'invalid', to: '2026-10-06T00:00:00Z' })
            ).status,
        ).toBe(400);
        expect(
            (
                await owner
                    .get(`${path}/report`)
                    .query({ from: '2026-10-06T00:00:00Z', to: '2026-10-05T00:00:00Z' })
            ).status,
        ).toBe(400);
    });
    it('rejects outsider assignments and creates only one timer under simultaneous starts', async () => {
        const { owner, a, b, path } = await fixture();
        expect((await owner.post(`${path}/timer`).send({ assignees: [b._id] })).status).toBe(400);
        expect((await owner.post(`${path}/timer`).send({ assignees: [] })).status).toBe(400);
        const results = await Promise.all(
            [1, 2].map(() => owner.post(`${path}/timer`).send({ assignees: [a._id] })),
        );
        expect(results.filter((r) => r.status === 201)).toHaveLength(1);
        expect(results.filter((r) => r.status === 409)).toHaveLength(1);
        expect(await TimeEntry.countDocuments({ timerUser: a._id, end: null })).toBe(1);
    });
});
