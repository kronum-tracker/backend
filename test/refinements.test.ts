import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { TimeEntry } from '../src/models/tracking.model.js';
import { duration } from '../../frontend/lib/api';

const base = '/api/v1';
async function account(name: string) {
    const agent = request.agent(app),
        email = `${crypto.randomUUID()}@test.com`;
    const result = await agent
        .post(`${base}/auth/register`)
        .send({ name, email, password: 'password-test', passwordConfirmation: 'password-test' });
    expect(result.status).toBe(201);
    return { agent, user: result.body.data, email };
}
describe('Requested refinements', () => {
    it('requires matching confirmation and rejects any identity change even with the current password', async () => {
        const data = {
            name: 'Fixed name',
            email: `${crypto.randomUUID()}@test.com`,
            password: 'password-test',
        };
        expect((await request(app).post(`${base}/auth/register`).send(data)).status).toBe(400);
        expect(
            (
                await request(app)
                    .post(`${base}/auth/register`)
                    .send({ ...data, passwordConfirmation: 'different-password' })
            ).status,
        ).toBe(400);
        const { agent, user } = await account('Immutable');
        expect(
            (
                await agent
                    .patch(`${base}/auth/me`)
                    .send({ name: 'New name', currentPassword: 'password-test' })
            ).status,
        ).toBe(400);
        expect(
            (
                await agent
                    .patch(`${base}/auth/me`)
                    .send({ email: 'changed@test.com', currentPassword: 'password-test' })
            ).status,
        ).toBe(400);
        expect(
            (
                await agent
                    .patch(`${base}/auth/me`)
                    .send({ password: 'new-password', currentPassword: 'password-test' })
            ).status,
        ).toBe(200);
        expect((await agent.get(`${base}/auth/me`)).body.data).toMatchObject({
            _id: user._id,
            name: user.name,
            email: user.email,
        });
    });
    it('finds and invites names, handles duplicate names through a selected user ID, and protects the directory', async () => {
        const owner = await account('Owner'),
            first = await account('Same name'),
            second = await account('Same name');
        const unique = await account('Unique member');
        const project = (
            await owner.agent.post(`${base}/projects`).send({ name: 'Invitation names' })
        ).body.data;
        const path = `${base}/projects/${project._id}`;
        expect((await first.agent.get(`${path}/invitees`).query({ query: 'Same' })).status).toBe(
            404,
        );
        const results = await owner.agent.get(`${path}/invitees`).query({ query: 'same' });
        expect(results.status).toBe(200);
        expect(results.body.data).toHaveLength(2);
        expect(results.body.data[0].password).toBeUndefined();
        expect(
            (await owner.agent.post(`${path}/invitations`).send({ recipient: 'Same name' })).status,
        ).toBe(409);
        const invite = await owner.agent
            .post(`${path}/invitations`)
            .send({ userId: first.user._id });
        expect(invite.status).toBe(201);
        expect(invite.body.data.email).toBe(first.email);
        expect((await first.agent.get(`${base}/invitations`)).body.data).toHaveLength(1);
        expect((await second.agent.get(`${base}/invitations`)).body.data).toHaveLength(0);
        expect(
            (await owner.agent.post(`${path}/invitations`).send({ recipient: 'unique MEMBER' }))
                .status,
        ).toBe(201);
        expect((await unique.agent.get(`${base}/invitations`)).body.data).toHaveLength(1);
        expect(
            (await owner.agent.post(`${path}/invitations`).send({ recipient: 'Missing name' }))
                .status,
        ).toBe(404);
        expect(
            (await owner.agent.post(`${path}/invitations`).send({ recipient: 'future@test.com' }))
                .status,
        ).toBe(201);
    });
    it('sums team work once per assigned person and excludes timers and inaccessible projects', async () => {
        const owner = await account('Owner'),
            member = await account('Member');
        const project = (await owner.agent.post(`${base}/projects`).send({ name: 'Totals' })).body
            .data;
        const path = `${base}/projects/${project._id}`;
        const invite = (
            await owner.agent.post(`${path}/invitations`).send({ userId: member.user._id })
        ).body.data;
        await member.agent
            .post(`${base}/invitations/${invite._id}/respond`)
            .send({ status: 'accepted' });
        const first = (
            await owner.agent
                .post(`${path}/entries`)
                .send({
                    description: 'Shared',
                    start: '2026-10-05T09:00:00Z',
                    end: '2026-10-05T10:00:15Z',
                    assignees: [owner.user._id, member.user._id],
                })
        ).body.data;
        await owner.agent.post(`${path}/timer`).send({});
        const total = 2 * (3600000 + 15000);
        expect((await owner.agent.get(`${base}/projects`)).body.data[0].teamMilliseconds).toBe(
            total,
        );
        const other = (await owner.agent.post(`${base}/projects`).send({ name: 'Private' })).body
            .data;
        expect(
            (await owner.agent.get(`${base}/projects`)).body.data.find(
                (p: { _id: string }) => p._id === other._id,
            ).teamMilliseconds,
        ).toBe(0);
        expect((await member.agent.get(`${base}/projects`)).body.data).toHaveLength(1);
        await member.agent
            .patch(`${path}/entries/${first._id}`)
            .send({
                description: 'Changed',
                start: first.start,
                end: '2026-10-05T11:00:30Z',
                assignees: [member.user._id],
            });
        expect(
            (await owner.agent.get(`${base}/projects`)).body.data.find(
                (p: { _id: string }) => p._id === project._id,
            ).teamMilliseconds,
        ).toBe(7200000 + 30000);
        await member.agent.delete(`${path}/entries/${first._id}`);
        expect(await TimeEntry.countDocuments({ project: project._id, end: { $ne: null } })).toBe(
            0,
        );
        expect(
            (await owner.agent.get(`${base}/projects`)).body.data.find(
                (p: { _id: string }) => p._id === project._id,
            ).teamMilliseconds,
        ).toBe(0);
    });
    it('formats every duration with seconds without rounding minutes', () => {
        expect(duration(0)).toBe('0h 00m 00s');
        expect(duration(59000)).toBe('0h 00m 59s');
        expect(duration(3599999)).toBe('0h 59m 59s');
        expect(duration(90061000)).toBe('25h 01m 01s');
    });
});
