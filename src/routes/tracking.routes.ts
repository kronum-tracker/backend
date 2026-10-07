import { Router, type Request, type Response, type NextFunction } from 'express';
import { isValidObjectId, Types } from 'mongoose';
import User, { type IUser } from '../models/user.model.js';
import { Project, Invitation, TimeEntry, Session } from '../models/tracking.model.js';
import {
    requireAuth,
    publicUser,
    hashPassword,
    verifyPassword,
    createSession,
    clearSession,
    hashToken,
    sessionToken,
} from '../utils/auth.js';

export const trackingRoutes = Router();
class ApiError extends Error {
    constructor(
        public status: number,
        message: string,
    ) {
        super(message);
    }
}
const fail = (status: number, message: string): never => {
    throw new ApiError(status, message);
};
const id = (value: unknown) =>
    typeof value === 'string' && isValidObjectId(value)
        ? value
        : fail(400, 'Identificador no válido.');
function text(value: unknown, label: string, max: number, optional = false): string {
    if (optional && (value === undefined || value === '')) return '';
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
        fail(400, `${label}: indica entre 1 y ${max} caracteres.`);
    return (value as string).trim();
}
function email(value: unknown) {
    const result = text(value, 'Correo', 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) fail(400, 'Introduce un correo válido.');
    return result;
}
function password(value: unknown) {
    if (typeof value !== 'string' || value.length < 8 || value.length > 128)
        fail(400, 'La contraseña debe tener entre 8 y 128 caracteres.');
    return value as string;
}
function color(value: unknown) {
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail(400, 'Color no válido.');
    return value as string;
}
const current = (res: Response): IUser => res.locals.user;
const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ data });

// Bound login/registration attempts per IP without retaining submitted credentials.
const attempts = new Map<string, { count: number; reset: number }>();
trackingRoutes.use('/auth', (req, res, next) => {
    if (req.method !== 'POST' || !['/login', '/register'].includes(req.path)) return next();
    const now = Date.now();
    for (const [key, value] of attempts) if (value.reset < now) attempts.delete(key);
    const key = req.ip || 'unknown';
    const value = attempts.get(key) || { count: 0, reset: now + 15 * 60 * 1000 };
    if (++value.count > 30)
        return res
            .status(429)
            .json({ message: 'Demasiados intentos. Vuelve a probar en 15 minutos.' });
    attempts.set(key, value);
    next();
});
trackingRoutes.post('/auth/register', async (req, res) => {
    if (
        req.body.passwordConfirmation !== req.body.password ||
        typeof req.body.passwordConfirmation !== 'string'
    )
        fail(400, 'Las contraseñas deben coincidir.');
    const data = {
        name: text(req.body.name, 'Nombre', 50),
        email: email(req.body.email),
        password: await hashPassword(password(req.body.password)),
    };
    const user = await User.create(data);
    await createSession(user, res);
    ok(res, publicUser(user), 201);
});
trackingRoutes.post('/auth/login', async (req, res) => {
    const address = email(req.body.email);
    const secret = password(req.body.password);
    const user = await User.findOne({ email: address }).select('+password');
    // Also perform a password derivation for unknown addresses.
    const valid = await verifyPassword(
        secret,
        user?.password || `${'0'.repeat(32)}:${'0'.repeat(128)}`,
    );
    if (!user || !valid) fail(401, 'Correo o contraseña incorrectos.');
    await createSession(user!, res);
    ok(res, publicUser(user!));
});
trackingRoutes.use(requireAuth);
trackingRoutes.get('/auth/me', (req, res) => ok(res, publicUser(current(res))));
trackingRoutes.post('/auth/logout', async (req, res) => {
    await Session.deleteOne({ tokenHash: hashToken(sessionToken(req)) });
    clearSession(res);
    ok(res, null);
});
trackingRoutes.patch('/auth/me', async (req, res) => {
    const user = await User.findById(current(res)._id).select('+password');
    if (!user) fail(401, 'Inicia sesión para continuar.');
    if (
        (req.body.name !== undefined && req.body.name !== user!.name) ||
        (req.body.email !== undefined && email(req.body.email) !== user!.email)
    )
        fail(400, 'El nombre y el correo no se pueden modificar.');
    const sensitive = req.body.password !== undefined;
    if (
        sensitive &&
        (typeof req.body.currentPassword !== 'string' ||
            !(await verifyPassword(req.body.currentPassword, user!.password)))
    )
        fail(400, 'Introduce tu contraseña actual para cambiar la contraseña.');
    if (req.body.password !== undefined)
        user!.password = await hashPassword(password(req.body.password));
    await user!.save();
    if (sensitive) {
        await Session.deleteMany({ user: user!._id });
        await createSession(user!, res);
    }
    ok(res, publicUser(user!));
});

async function projectFor(req: Request, res: Response, ownerOnly = false) {
    const project = await Project.findOne({
        _id: id(req.params.projectId),
        members: current(res)._id,
    });
    if (!project) fail(404, 'Proyecto no encontrado.');
    if (ownerOnly && String(project!.owner) !== String(current(res)._id))
        fail(403, 'Solo el propietario puede realizar esta acción.');
    return project!;
}
trackingRoutes.get('/projects', async (req, res) => {
    const projects = await Project.find({ members: current(res)._id })
        .populate('members', 'name email')
        .sort({ updatedAt: -1 });
    const totals = await TimeEntry.aggregate([
        {
            $match: {
                project: { $in: projects.map((project) => project._id) },
                end: { $ne: null },
            },
        },
        {
            $group: {
                _id: '$project',
                milliseconds: {
                    $sum: {
                        $multiply: [{ $subtract: ['$end', '$start'] }, { $size: '$assignees' }],
                    },
                },
            },
        },
    ]);
    const byProject = new Map(totals.map((value) => [String(value._id), value.milliseconds]));
    ok(
        res,
        projects.map((project) => ({
            ...project.toObject(),
            teamMilliseconds: byProject.get(String(project._id)) || 0,
        })),
    );
});
trackingRoutes.post('/projects', async (req, res) => {
    ok(
        res,
        await Project.create({
            name: text(req.body.name, 'Nombre del proyecto', 100),
            description: text(req.body.description, 'Descripción', 2000, true),
            color: color(req.body.color || '#6759e8'),
            owner: current(res)._id,
            members: [current(res)._id],
        }),
        201,
    );
});
trackingRoutes.get('/projects/:projectId', async (req, res) => {
    const project = await projectFor(req, res);
    await project.populate('members', 'name email');
    ok(res, project);
});
trackingRoutes.patch('/projects/:projectId', async (req, res) => {
    const project = await projectFor(req, res, true);
    project.name = text(req.body.name, 'Nombre', 100);
    project.description = text(req.body.description, 'Descripción', 2000, true);
    project.color = color(req.body.color || project.color);
    await project.save();
    ok(res, project);
});
trackingRoutes.delete('/projects/:projectId', async (req, res) => {
    const project = await projectFor(req, res, true);
    await TimeEntry.deleteMany({ project: project._id });
    await Invitation.deleteMany({ project: project._id });
    await project.deleteOne();
    ok(res, null);
});
trackingRoutes.delete('/projects/:projectId/members/:memberId', async (req, res) => {
    const project = await projectFor(req, res, true);
    const memberId = id(req.params.memberId);
    if (String(project.owner) === memberId) fail(400, 'No puedes eliminar al propietario.');
    // Historical assignments remain visible after a member leaves.
    project.members = project.members.filter((member) => String(member) !== memberId);
    await project.save();
    await TimeEntry.updateMany(
        { project: project._id, timerUser: memberId, end: null },
        { $set: { end: new Date() } },
    );
    ok(res, project);
});

trackingRoutes.get('/invitations', async (req, res) => {
    ok(
        res,
        await Invitation.find({ email: current(res).email, status: 'pending' })
            .populate('project', 'name description color')
            .populate('invitedBy', 'name email')
            .sort({ createdAt: -1 }),
    );
});
trackingRoutes.get('/projects/:projectId/invitations', async (req, res) => {
    const project = await projectFor(req, res, true);
    ok(
        res,
        await Invitation.find({ project: project._id, status: 'pending' }).sort({ createdAt: -1 }),
    );
});
trackingRoutes.get('/projects/:projectId/invitees', async (req, res) => {
    const project = await projectFor(req, res, true);
    const query = text(req.query.query, 'Búsqueda', 50);
    if (query.length < 2) return ok(res, []);
    const literal = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const users = await User.find({
        _id: { $nin: project.members },
        $or: [
            { name: { $regex: literal, $options: 'i' } },
            { email: { $regex: literal, $options: 'i' } },
        ],
    })
        .select('name email')
        .sort({ name: 1, _id: 1 })
        .limit(10);
    ok(res, users.map(publicUser));
});
trackingRoutes.post('/projects/:projectId/invitations', async (req, res) => {
    const project = await projectFor(req, res, true);
    let address: string;
    if (req.body.userId !== undefined) {
        const user = await User.findById(id(req.body.userId));
        if (!user) fail(404, 'Usuario no encontrado.');
        address = user!.email;
    } else {
        const recipient = text(req.body.recipient ?? req.body.email, 'Nombre o correo', 254);
        if (recipient.includes('@')) address = email(recipient);
        else {
            const literal = recipient.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const matches = await User.find({
                name: { $regex: `^${literal}$`, $options: 'i' },
            }).limit(2);
            if (!matches.length)
                fail(404, 'No existe un usuario con ese nombre. Puedes invitar por correo.');
            if (matches.length > 1)
                fail(
                    409,
                    'Hay varios usuarios con ese nombre. Selecciona uno de la búsqueda o indica su correo.',
                );
            address = matches[0].email;
        }
    }
    const target = await User.findOne({ email: address });
    if (target && project.members.some((member) => String(member) === String(target._id)))
        fail(400, 'Esta persona ya pertenece al proyecto.');
    ok(
        res,
        await Invitation.create({
            project: project._id,
            email: address,
            invitedBy: current(res)._id,
        }),
        201,
    );
});
trackingRoutes.delete('/projects/:projectId/invitations/:invitationId', async (req, res) => {
    const project = await projectFor(req, res, true);
    const invitation = await Invitation.findOneAndUpdate(
        { _id: id(req.params.invitationId), project: project._id, status: 'pending' },
        { status: 'cancelled' },
        { new: true },
    );
    if (!invitation) fail(404, 'Invitación no encontrada.');
    ok(res, null);
});
trackingRoutes.post('/invitations/:invitationId/respond', async (req, res) => {
    if (!['accepted', 'declined'].includes(req.body.status)) fail(400, 'Respuesta no válida.');
    const invitation = await Invitation.findOne({
        _id: id(req.params.invitationId),
        email: current(res).email,
        status: 'pending',
    });
    if (!invitation) fail(404, 'Invitación no encontrada.');
    const project = await Project.findById(invitation!.project);
    if (!project) fail(404, 'El proyecto ya no existe.');
    const result = await Invitation.findOneAndUpdate(
        { _id: invitation!._id, status: 'pending' },
        { status: req.body.status },
        { new: true },
    );
    if (!result) fail(409, 'La invitación ya se ha respondido.');
    if (req.body.status === 'accepted') {
        try {
            await Project.updateOne(
                { _id: project!._id },
                { $addToSet: { members: current(res)._id } },
            );
        } catch (err) {
            await Invitation.updateOne(
                { _id: invitation!._id, status: 'accepted' },
                { status: 'pending' },
            );
            throw err;
        }
    }
    ok(res, result);
});

trackingRoutes.post('/projects/:projectId/tags', async (req, res) => {
    const project = await projectFor(req, res, true);
    const name = text(req.body.name, 'Etiqueta', 40);
    if (project.tags.some((tag) => tag.name.toLowerCase() === name.toLowerCase()))
        fail(409, 'Ya existe una etiqueta con ese nombre.');
    project.tags.push({ name, color: color(req.body.color || '#6759e8') });
    await project.save();
    ok(res, project.tags, 201);
});
trackingRoutes.patch('/projects/:projectId/tags/:tagId', async (req, res) => {
    const project = await projectFor(req, res, true);
    const tag = project.tags.id(id(req.params.tagId));
    if (!tag) fail(404, 'Etiqueta no encontrada.');
    const name = text(req.body.name, 'Etiqueta', 40);
    if (
        project.tags.some(
            (other) =>
                String(other._id) !== String(tag!._id) &&
                other.name.toLowerCase() === name.toLowerCase(),
        )
    )
        fail(409, 'Ya existe una etiqueta con ese nombre.');
    tag!.name = name;
    tag!.color = color(req.body.color);
    await project.save();
    ok(res, project.tags);
});
trackingRoutes.delete('/projects/:projectId/tags/:tagId', async (req, res) => {
    const project = await projectFor(req, res, true);
    const tag = project.tags.id(id(req.params.tagId));
    if (!tag) fail(404, 'Etiqueta no encontrada.');
    await TimeEntry.updateMany({ project: project._id }, { $pull: { tags: tag!._id } });
    tag!.deleteOne();
    await project.save();
    ok(res, project.tags);
});

function ids(value: unknown, label: string) {
    if (!Array.isArray(value) || value.length > 100) fail(400, `${label}: lista no válida.`);
    return [...new Set((value as unknown[]).map(id))];
}
function date(value: unknown) {
    if (
        typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/.test(value) ||
        !Number.isFinite(Date.parse(value))
    )
        fail(400, 'Indica una fecha y hora válidas con zona horaria.');
    const calendarDate = (value as string).slice(0, 10);
    const parsedCalendar = new Date(`${calendarDate}T00:00:00Z`);
    if (
        !Number.isFinite(parsedCalendar.getTime()) ||
        parsedCalendar.toISOString().slice(0, 10) !== calendarDate
    )
        fail(400, 'La fecha indicada no existe.');
    return new Date(value as string);
}
async function entryData(req: Request, res: Response) {
    const project = await projectFor(req, res);
    const start = date(req.body.start),
        end = date(req.body.end);
    if (end <= start) fail(400, 'La hora de fin debe ser posterior al inicio.');
    const assignees = ids(req.body.assignees, 'Miembros'),
        tags = ids(req.body.tags ?? [], 'Etiquetas');
    if (!assignees.length) fail(400, 'Selecciona al menos un miembro.');
    // Preserve historical assignments when editing, but never assign new non-members.
    const existing =
        req.params.entryId &&
        (await TimeEntry.findOne({ _id: id(req.params.entryId), project: project._id }));
    if (existing && !existing.end) fail(409, 'Detén el temporizador antes de editar la entrada.');
    if (
        assignees.some(
            (member) =>
                !project.members.some((p) => String(p) === member) &&
                !(existing && existing.assignees.some((p) => String(p) === member)),
        )
    )
        fail(400, 'Solo puedes asignar miembros del proyecto.');
    if (tags.some((tag) => !project.tags.some((p) => String(p._id) === tag)))
        fail(400, 'Las etiquetas deben pertenecer al proyecto.');
    return {
        project: project._id,
        description: text(req.body.description, 'Descripción', 2000),
        start,
        end,
        assignees: assignees.map((member) => new Types.ObjectId(member)),
        tags: tags.map((tag) => new Types.ObjectId(tag)),
    };
}
async function timerResponse(userId: Types.ObjectId) {
    const timer = await TimeEntry.findOne({ timerUser: userId, end: null })
        .populate('project', 'name color')
        .populate('assignees', 'name email');
    return { timer, serverNow: new Date().toISOString() };
}
trackingRoutes.get('/timer', async (req, res) => ok(res, await timerResponse(current(res)._id)));
trackingRoutes.post('/projects/:projectId/timer', async (req, res) => {
    const project = await projectFor(req, res);
    const source =
        req.body.entryId !== undefined
            ? await TimeEntry.findOne({
                  _id: id(req.body.entryId),
                  project: project._id,
                  end: { $ne: null },
              })
            : null;
    if (req.body.entryId !== undefined && !source) fail(404, 'Entrada no encontrada.');
    const assignees = source
        ? source.assignees
              .map(String)
              .filter((member) => project.members.some((p) => String(p) === member))
        : ids(req.body.assignees ?? [String(current(res)._id)], 'Miembros');
    const tags = source
        ? source.tags.map(String).filter((tag) => project.tags.some((p) => String(p._id) === tag))
        : ids(req.body.tags ?? [], 'Etiquetas');
    if (
        !assignees.length ||
        assignees.some((member) => !project.members.some((p) => String(p) === member))
    )
        fail(400, 'Selecciona miembros del proyecto.');
    if (tags.some((tag) => !project.tags.some((p) => String(p._id) === tag)))
        fail(400, 'Las etiquetas deben pertenecer al proyecto.');
    if (await TimeEntry.exists({ timerUser: current(res)._id, end: null }))
        fail(409, 'Ya tienes un temporizador en marcha. Deténlo antes de iniciar otro.');
    try {
        await TimeEntry.create({
            project: project._id,
            description:
                source?.description ||
                text(req.body.description, 'Descripción', 2000, true) ||
                'Sin descripción',
            start: new Date(),
            end: null,
            timerUser: current(res)._id,
            createdBy: current(res)._id,
            assignees: assignees.map((member) => new Types.ObjectId(member)),
            tags: tags.map((tag) => new Types.ObjectId(tag)),
        });
    } catch (err) {
        if (err instanceof Error && 'code' in err && err.code === 11000)
            fail(409, 'Ya tienes un temporizador en marcha.');
        throw err;
    }
    ok(res, await timerResponse(current(res)._id), 201);
});
trackingRoutes.post('/timer/:entryId/stop', async (req, res) => {
    const entryId = id(req.params.entryId);
    const existing = await TimeEntry.findOne({ _id: entryId, timerUser: current(res)._id });
    if (!existing) fail(404, 'Temporizador no encontrado.');
    // The same document becomes a completed entry; repeated stop requests are idempotent.
    const entry = await TimeEntry.findOneAndUpdate(
        { _id: entryId, timerUser: current(res)._id, end: null },
        { $set: { end: new Date(Math.max(Date.now(), existing!.start.getTime() + 1)) } },
        { new: true },
    );
    ok(res, entry || (await TimeEntry.findOne({ _id: entryId, timerUser: current(res)._id })));
});
trackingRoutes.get('/projects/:projectId/report', async (req, res) => {
    const project = await projectFor(req, res);
    const from = date(req.query.from),
        to = date(req.query.to);
    if (from >= to) fail(400, 'El fin del periodo debe ser posterior al inicio.');
    const [result] = await TimeEntry.aggregate([
        { $match: { project: project._id, end: { $gt: from }, start: { $lt: to } } },
        { $set: { elapsed: { $subtract: [{ $min: ['$end', to] }, { $max: ['$start', from] }] } } },
        {
            $facet: {
                totals: [
                    {
                        $group: {
                            _id: null,
                            milliseconds: { $sum: '$elapsed' },
                            count: { $sum: 1 },
                        },
                    },
                ],
                people: [
                    { $unwind: '$assignees' },
                    {
                        $group: {
                            _id: '$assignees',
                            milliseconds: { $sum: '$elapsed' },
                            entries: { $sum: 1 },
                        },
                    },
                ],
            },
        },
    ]);
    const values = result.people as {
        _id: Types.ObjectId;
        milliseconds: number;
        entries: number;
    }[];
    const users = await User.find({
        _id: { $in: [...project.members, ...values.map((p) => p._id)] },
    });
    const people = users
        .map((user) => {
            const stats = values.find((p) => String(p._id) === String(user._id));
            return {
                user: publicUser(user),
                milliseconds: stats?.milliseconds || 0,
                entries: stats?.entries || 0,
            };
        })
        .sort((a, b) => b.milliseconds - a.milliseconds || a.user.name.localeCompare(b.user.name));
    ok(res, {
        from,
        to,
        people,
        teamMilliseconds: people.reduce((total, person) => total + person.milliseconds, 0),
        entryMilliseconds: result.totals[0]?.milliseconds || 0,
        count: result.totals[0]?.count || 0,
    });
});
trackingRoutes.get('/me/entries', async (req, res) => {
    const from = date(req.query.from),
        to = date(req.query.to);
    if (from >= to) fail(400, 'El fin del periodo debe ser posterior al inicio.');
    const projects = await Project.find({ members: current(res)._id }).select('_id');
    ok(
        res,
        await TimeEntry.find({
            project: { $in: projects.map((project) => project._id) },
            assignees: current(res)._id,
            end: { $gt: from },
            start: { $lt: to },
        })
            .populate('project', 'name color')
            .populate('assignees', 'name email')
            .populate('createdBy', 'name email')
            .sort({ start: -1 }),
    );
});
trackingRoutes.get('/projects/:projectId/entries', async (req, res) => {
    const project = await projectFor(req, res);
    const filter: Record<string, unknown> = { project: project._id, end: { $ne: null } };
    if (req.query.users)
        filter.assignees = { $in: ids(String(req.query.users).split(','), 'Usuarios') };
    if (req.query.tags) filter.tags = { $in: ids(String(req.query.tags).split(','), 'Etiquetas') };
    // Include intervals that overlap the requested range, including overnight work.
    if (req.query.from) filter.end = { $gt: date(req.query.from) };
    if (req.query.to) filter.start = { $lt: date(req.query.to) };
    if (req.query.from && req.query.to && date(req.query.from) >= date(req.query.to))
        fail(400, 'Rango de fechas no válido.');
    if (req.query.search)
        filter.description = {
            $regex: text(req.query.search, 'Búsqueda', 200).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
            $options: 'i',
        };
    ok(
        res,
        await TimeEntry.find(filter)
            .populate('assignees', 'name email')
            .populate('createdBy', 'name email')
            .sort({ start: -1 }),
    );
});
trackingRoutes.post('/projects/:projectId/entries', async (req, res) => {
    const data = await entryData(req, res);
    ok(res, await TimeEntry.create({ ...data, createdBy: current(res)._id }), 201);
});
trackingRoutes.patch('/projects/:projectId/entries/:entryId', async (req, res) => {
    const data = await entryData(req, res);
    const entry = await TimeEntry.findOneAndUpdate(
        { _id: id(req.params.entryId), project: data.project },
        { $set: data },
        { new: true, runValidators: true },
    );
    if (!entry) fail(404, 'Entrada no encontrada.');
    ok(res, entry);
});
trackingRoutes.delete('/projects/:projectId/entries/:entryId', async (req, res) => {
    const project = await projectFor(req, res);
    const entry = await TimeEntry.findOneAndDelete({
        _id: id(req.params.entryId),
        project: project._id,
        end: { $ne: null },
    });
    if (!entry) fail(404, 'Entrada no encontrada.');
    ok(res, null);
});
trackingRoutes.use(
    (
        err: Error & { code?: number; type?: string },
        req: Request,
        res: Response,
        next: NextFunction,
    ) => {
        if (res.headersSent) return next(err);
        if (err instanceof ApiError) return res.status(err.status).json({ message: err.message });
        if (err.code === 11000)
            return res.status(409).json({ message: 'El correo o la invitación ya existe.' });
        console.error('Tracking API error:', err.message);
        return res
            .status(500)
            .json({ message: 'No se pudo completar la operación. Vuelve a intentarlo.' });
    },
);
