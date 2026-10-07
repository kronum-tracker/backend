import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';

describe('Health and request validation', () => {
    it('reports health and rejects missing or malformed registration data', async () => {
        expect((await request(app).get('/health')).status).toBe(200);
        expect((await request(app).post('/api/v1/auth/register')).status).toBe(400);
        expect((await request(app).post('/api/v1/auth/register').send([])).status).toBe(400);
        expect(
            (
                await request(app)
                    .post('/api/v1/auth/register')
                    .set('Content-Type', 'application/json')
                    .send('{bad')
            ).status,
        ).toBe(400);
    });
});
