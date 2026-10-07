import { randomBytes, scrypt as scryptCallback, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Request, Response, NextFunction } from 'express';
import { Session } from '../models/tracking.model.js';
import User, { type IUser } from '../models/user.model.js';

const scrypt = promisify(scryptCallback);
const cookieName = 'kronum_session';
const lifetime = 7 * 24 * 60 * 60 * 1000;
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export async function hashPassword(password: string) {
    const salt = randomBytes(16).toString('hex');
    const key = (await scrypt(password, salt, 64)) as Buffer;
    return `${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string) {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const key = (await scrypt(password, salt, 64)) as Buffer;
    const expected = Buffer.from(hash, 'hex');
    return key.length === expected.length && timingSafeEqual(key, expected);
}
export function sessionToken(req: Request) {
    return (
        req.headers.cookie
            ?.split(';')
            .map((x) => x.trim())
            .find((x) => x.startsWith(`${cookieName}=`))
            ?.slice(cookieName.length + 1) || ''
    );
}
export const publicUser = (user: IUser) => ({
    _id: String(user._id),
    name: user.name,
    email: user.email,
});
export async function createSession(user: IUser, res: Response) {
    const token = randomBytes(32).toString('hex');
    await Session.create({
        tokenHash: hashToken(token),
        user: user._id,
        expiresAt: new Date(Date.now() + lifetime),
    });
    res.cookie(cookieName, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: lifetime,
        path: '/',
    });
}
export function clearSession(res: Response) {
    res.clearCookie(cookieName, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
    });
}
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
    const session = await Session.findOne({
        tokenHash: hashToken(sessionToken(req)),
        expiresAt: { $gt: new Date() },
    });
    const user = session && (await User.findById(session.user));
    if (!user) return res.status(401).json({ message: 'Inicia sesión para continuar.' });
    res.locals.user = user;
    next();
}
