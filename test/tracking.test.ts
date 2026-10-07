import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import User from '../src/models/user.model.js';
import { Project } from '../src/models/tracking.model.js';

const base = '/api/v1';
async function account(name: string) {
    const agent = request.agent(app);
    const email = `${name}-${crypto.randomUUID()}@example.com`;
    const result = await agent
        .post(`${base}/auth/register`)
        .send({
            name,
            email,
            password: 'correct-password',
            passwordConfirmation: 'correct-password',
        });
    expect(result.status).toBe(201);
    return { agent, user: result.body.data, email, cookie: result.headers['set-cookie'] };
}
async function fixture() {
    const owner = await account('Owner');
    const member = await account('Member');
    const result = await owner.agent
        .post(`${base}/projects`)
        .send({ name: 'Kronum project', color: '#6759e8' });
    return {
        owner,
        member,
        project: result.body.data,
        path: `${base}/projects/${result.body.data._id}`,
    };
}
const times = {
    description: 'Design review',
    start: '2026-10-05T22:00:00.000Z',
    end: '2026-10-06T02:00:00.000Z',
    tags: [],
};

describe('Accounts and sessions', () => {
    it('hashes passwords, keeps them private, logs in and revokes sessions on logout', async () => {
        const owner = await account('Session');
        const stored = await User.findById(owner.user._id).select('+password');
        expect(stored!.password).not.toBe('correct-password');
        expect(owner.user.password).toBeUndefined();
        expect(String(owner.cookie)).toContain('HttpOnly');
        expect((await owner.agent.get(`${base}/auth/me`)).status).toBe(200);
        await owner.agent.post(`${base}/auth/logout`);
        expect((await owner.agent.get(`${base}/projects`)).status).toBe(401);
        expect(
            (
                await owner.agent
                    .post(`${base}/auth/login`)
                    .send({ email: owner.email, password: 'wrong-password' })
            ).status,
        ).toBe(401);
        expect(
            (
                await owner.agent
                    .post(`${base}/auth/login`)
                    .send({ email: owner.email.toUpperCase(), password: 'correct-password' })
            ).status,
        ).toBe(200);
        expect((await request(app).get(`${base}/users`)).status).toBe(401);
    });
    it('validates accounts and requires current password for sensitive changes', async () => {
        expect(
            (
                await request(app)
                    .post(`${base}/auth/register`)
                    .send({ name: 'A', email: 'bad', password: 'x' })
            ).status,
        ).toBe(400);
        const owner = await account('Profile');
        const otherSession = request.agent(app);
        await otherSession
            .post(`${base}/auth/login`)
            .send({ email: owner.email, password: 'correct-password' });
        expect(
            (
                await owner.agent
                    .patch(`${base}/auth/me`)
                    .send({ name: 'Updated', email: owner.email, password: 'new-password' })
            ).status,
        ).toBe(400);
        expect(
            (
                await owner.agent.patch(`${base}/auth/me`).send({
                    name: owner.user.name,
                    email: owner.email,
                    password: 'new-password',
                    currentPassword: 'correct-password',
                })
            ).status,
        ).toBe(200);
        expect((await otherSession.get(`${base}/auth/me`)).status).toBe(401);
        expect((await owner.agent.get(`${base}/auth/me`)).body.data.name).toBe(owner.user.name);
        expect(
            (
                await request(app)
                    .post(`${base}/auth/login`)
                    .set('Origin', 'https://other.example')
                    .send({ email: owner.email, password: 'new-password' })
            ).status,
        ).toBe(403);
    });
});
describe('Project time tracking', () => {
    it('isolates projects and reserves management actions for owners', async () => {
        const { owner, member, project, path } = await fixture();
        expect((await member.agent.get(`${base}/projects`)).body.data).toEqual([]);
        expect((await member.agent.get(`${path}/entries`)).status).toBe(404);
        expect((await member.agent.patch(path).send({ name: 'Attack' })).status).toBe(404);
        const invitation = await owner.agent
            .post(`${path}/invitations`)
            .send({ email: member.email });
        await member.agent
            .post(`${base}/invitations/${invitation.body.data._id}/respond`)
            .send({ status: 'accepted' });
        expect((await member.agent.get(path)).body.data.members).toHaveLength(2);
        expect((await member.agent.delete(path)).status).toBe(403);
        expect((await member.agent.post(`${path}/tags`).send({ name: 'Tag' })).status).toBe(403);
        expect((await owner.agent.delete(`${path}/members/${project.owner}`)).status).toBe(400);
    });
    it('delivers invitations before registration, prevents duplicates and recipient impersonation', async () => {
        const { owner, member, path } = await fixture();
        const address = `future-${crypto.randomUUID()}@example.com`;
        const invite = await owner.agent.post(`${path}/invitations`).send({ email: address });
        expect(invite.status).toBe(201);
        expect(
            (await owner.agent.post(`${path}/invitations`).send({ email: address })).status,
        ).toBe(409);
        expect(
            (
                await member.agent
                    .post(`${base}/invitations/${invite.body.data._id}/respond`)
                    .send({ status: 'accepted' })
            ).status,
        ).toBe(404);
        const future = request.agent(app);
        await future
            .post(`${base}/auth/register`)
            .send({
                name: 'Future',
                email: address,
                password: 'correct-password',
                passwordConfirmation: 'correct-password',
            });
        expect((await future.get(`${base}/invitations`)).body.data[0].project.name).toBe(
            'Kronum project',
        );
        expect(
            (
                await future
                    .post(`${base}/invitations/${invite.body.data._id}/respond`)
                    .send({ status: 'declined' })
            ).status,
        ).toBe(200);
        expect((await future.get(`${base}/projects`)).body.data).toEqual([]);
        expect(
            (await owner.agent.post(`${path}/invitations`).send({ email: address })).status,
        ).toBe(201);
    });
    it('creates and edits shared entries and combines user, tag, date and text filters', async () => {
        const { owner, member, path } = await fixture();
        const invite = await owner.agent.post(`${path}/invitations`).send({ email: member.email });
        await member.agent
            .post(`${base}/invitations/${invite.body.data._id}/respond`)
            .send({ status: 'accepted' });
        const tags = await owner.agent
            .post(`${path}/tags`)
            .send({ name: 'Design', color: '#319477' });
        const tag = tags.body.data[0]._id;
        const payload = { ...times, assignees: [owner.user._id, member.user._id], tags: [tag] };
        const entry = await member.agent.post(`${path}/entries`).send(payload);
        expect(entry.status).toBe(201);
        expect(entry.body.data.assignees).toHaveLength(2);
        const list = await owner.agent.get(`${path}/entries`).query({
            users: member.user._id,
            tags: tag,
            from: '2026-10-06T00:00:00Z',
            to: '2026-10-07T00:00:00Z',
            search: 'review',
        });
        expect(list.body.data).toHaveLength(1);
        expect(list.body.data[0].assignees[0].password).toBeUndefined();
        expect(
            (await owner.agent.get(`${path}/entries`).query({ from: '2026-10-07T00:00:00Z' })).body
                .data,
        ).toHaveLength(0);
        expect(
            (
                await owner.agent
                    .patch(`${path}/entries/${entry.body.data._id}`)
                    .send({ ...payload, description: 'Updated review' })
            ).status,
        ).toBe(200);
        await owner.agent.delete(`${path}/tags/${tag}`);
        expect((await owner.agent.get(`${path}/entries`)).body.data[0].tags).toEqual([]);
    });
    it('rejects invalid intervals, outsiders, foreign tags, invalid IDs and malformed filters', async () => {
        const { owner, member, path } = await fixture();
        const payload = { ...times, assignees: [owner.user._id] };
        expect(
            (await owner.agent.post(`${path}/entries`).send({ ...payload, end: times.start }))
                .status,
        ).toBe(400);
        expect(
            (await owner.agent.post(`${path}/entries`).send({ ...payload, start: 'bad' })).status,
        ).toBe(400);
        expect(
            (
                await owner.agent
                    .post(`${path}/entries`)
                    .send({ ...payload, start: '2026-02-30T09:00:00Z' })
            ).status,
        ).toBe(400);
        expect(
            (await owner.agent.post(`${path}/entries`).send({ ...payload, assignees: [] })).status,
        ).toBe(400);
        expect(
            (
                await owner.agent
                    .post(`${path}/entries`)
                    .send({ ...payload, assignees: [member.user._id] })
            ).status,
        ).toBe(400);
        expect(
            (
                await owner.agent
                    .post(`${path}/entries`)
                    .send({ ...payload, tags: [member.user._id] })
            ).status,
        ).toBe(400);
        expect((await owner.agent.get(`${path}/entries`).query({ users: 'bad' })).status).toBe(400);
        expect(
            (await owner.agent.get(`${path}/entries`).query({ from: times.end, to: times.start }))
                .status,
        ).toBe(400);
        expect((await owner.agent.get(`${base}/projects/bad`)).status).toBe(400);
    });
    it('revokes removed members while preserving historical assignments and deletes project data', async () => {
        const { owner, member, project, path } = await fixture();
        const invite = await owner.agent.post(`${path}/invitations`).send({ email: member.email });
        await member.agent
            .post(`${base}/invitations/${invite.body.data._id}/respond`)
            .send({ status: 'accepted' });
        const payload = { ...times, assignees: [member.user._id] };
        const entry = await owner.agent.post(`${path}/entries`).send(payload);
        await owner.agent.delete(`${path}/members/${member.user._id}`);
        expect((await member.agent.get(`${path}/entries`)).status).toBe(404);
        expect((await owner.agent.get(`${path}/entries`)).body.data[0].assignees[0].name).toBe(
            'Member',
        );
        expect(
            (
                await owner.agent
                    .patch(`${path}/entries/${entry.body.data._id}`)
                    .send({ ...payload, description: 'Historical edit' })
            ).status,
        ).toBe(200);
        expect((await owner.agent.post(`${path}/entries`).send(payload)).status).toBe(400);
        expect((await owner.agent.delete(path)).status).toBe(200);
        expect(await Project.findById(project._id)).toBeNull();
        expect((await owner.agent.get(`${path}/entries`)).status).toBe(404);
    });
    it('cancels invitations and handles simultaneous responses without granting declined access', async () => {
        const { owner, member, path } = await fixture();
        const invite = await owner.agent.post(`${path}/invitations`).send({ email: member.email });
        await owner.agent.delete(`${path}/invitations/${invite.body.data._id}`);
        expect((await member.agent.get(`${base}/invitations`)).body.data).toEqual([]);
        expect(
            (
                await member.agent
                    .post(`${base}/invitations/${invite.body.data._id}/respond`)
                    .send({ status: 'accepted' })
            ).status,
        ).toBe(404);
        const again = await owner.agent.post(`${path}/invitations`).send({ email: member.email });
        const results = await Promise.all(
            ['accepted', 'declined'].map((status) =>
                member.agent
                    .post(`${base}/invitations/${again.body.data._id}/respond`)
                    .send({ status }),
            ),
        );
        expect(results.filter((result) => result.status === 200)).toHaveLength(1);
        const winner = results.find((result) => result.status === 200)!;
        const projects = await member.agent.get(`${base}/projects`);
        expect(projects.body.data.length).toBe(winner.body.data.status === 'accepted' ? 1 : 0);
    });
});
