const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const jsonBody = (schema: unknown) => ({
    required: true,
    content: { 'application/json': { schema } },
});
const parameter = (name: string) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' },
});
const projectParam = parameter('projectId');
const responses = {
    '200': { description: 'Operación completada. La respuesta contiene { data: ... }.' },
    '400': { description: 'Datos no válidos; { message: string }.' },
    '401': { description: 'Sesión ausente, revocada o caducada.' },
    '403': { description: 'Acción reservada al propietario u origen no permitido.' },
    '404': { description: 'Recurso inexistente o fuera de tus proyectos.' },
    '409': { description: 'Correo, etiqueta o invitación duplicada; invitación ya respondida.' },
    '429': { description: 'Límite de autenticación: 30 intentos por IP cada 15 minutos.' },
};
const operation = (summary: string, tag: string, parameters: unknown[] = [], schema?: unknown) => ({
    summary,
    tags: [tag],
    parameters,
    responses,
    ...(schema ? { requestBody: jsonBody(schema) } : {}),
});
const string = { type: 'string' };
const objectId = { type: 'string', pattern: '^[a-fA-F0-9]{24}$' };
const email = { type: 'string', format: 'email', maxLength: 254 };
const password = { type: 'string', minLength: 8, maxLength: 128 };
const color = { type: 'string', pattern: '^#[a-fA-F0-9]{6}$', example: '#6759e8' };

export const swaggerDocument = {
    openapi: '3.0.3',
    info: {
        title: 'Kronum API',
        version: '1.0.0',
        description:
            'Gestión de tiempo en equipo. Sesiones mediante cookie HttpOnly de 7 días. Solo el propietario gestiona proyectos, miembros, invitaciones y etiquetas; cualquier miembro gestiona las entradas. Los filtros de fechas incluyen intervalos que se solapan. Las invitaciones se entregan en la bandeja de la aplicación, sin envío de correo.',
    },
    servers: [{ url: '/', description: 'Origen actual; API bajo /api/v1' }],
    security: [{ session: [] }],
    components: {
        securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'kronum_session' } },
        schemas: {
            Credentials: {
                type: 'object',
                required: ['email', 'password'],
                properties: { email, password },
            },
            Register: {
                type: 'object',
                required: ['name', 'email', 'password', 'passwordConfirmation'],
                properties: {
                    name: { ...string, minLength: 1, maxLength: 50 },
                    email,
                    password,
                    passwordConfirmation: {
                        ...password,
                        description: 'Debe coincidir con password.',
                    },
                },
            },
            Profile: {
                type: 'object',
                required: ['password', 'currentPassword'],
                properties: {
                    name: { ...string, readOnly: true },
                    email: { ...email, readOnly: true },
                    password,
                    currentPassword: {
                        ...string,
                        description:
                            'Obligatoria para cambiar la contraseña. El nombre y el correo son inmutables. Se revocan todas las sesiones y se emite una nueva.',
                    },
                },
            },
            Project: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: { ...string, minLength: 1, maxLength: 100 },
                    description: { ...string, maxLength: 2000 },
                    color,
                },
            },
            Tag: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: { ...string, minLength: 1, maxLength: 40 },
                    color: { ...color, description: 'Obligatorio al editar.' },
                },
            },
            Invitation: {
                type: 'object',
                properties: {
                    email,
                    recipient: {
                        ...string,
                        description:
                            'Correo o nombre exacto de un usuario existente; si hay nombres duplicados, usar userId o correo.',
                    },
                    userId: objectId,
                },
                anyOf: [
                    { required: ['email'] },
                    { required: ['recipient'] },
                    { required: ['userId'] },
                ],
            },
            Response: {
                type: 'object',
                required: ['status'],
                properties: { status: { type: 'string', enum: ['accepted', 'declined'] } },
            },
            Entry: {
                type: 'object',
                required: ['description', 'start', 'end', 'assignees'],
                properties: {
                    description: { ...string, minLength: 1, maxLength: 2000 },
                    start: { ...string, format: 'date-time', example: '2026-10-06T09:00:00Z' },
                    end: {
                        ...string,
                        format: 'date-time',
                        description: 'Posterior a start, con zona horaria explícita.',
                        example: '2026-10-06T11:30:00Z',
                    },
                    assignees: {
                        type: 'array',
                        minItems: 1,
                        maxItems: 100,
                        items: objectId,
                        description:
                            'Uno o varios miembros del proyecto. Al editar se admiten asignaciones históricas existentes.',
                    },
                    tags: {
                        type: 'array',
                        maxItems: 100,
                        items: objectId,
                        description: 'Etiquetas del mismo proyecto.',
                    },
                },
            },
        },
    },
    paths: {
        '/api/v1/projects/{projectId}/invitees': {
            get: operation(
                'Buscar usuarios para invitar por nombre o correo (solo propietario)',
                'Invitaciones',
                [
                    projectParam,
                    {
                        name: 'query',
                        in: 'query',
                        required: true,
                        schema: { ...string, minLength: 2, maxLength: 50 },
                    },
                ],
            ),
        },
        '/api/v1/me/entries': {
            get: operation(
                'Entradas finalizadas asignadas a ti en todos tus proyectos actuales; incluye intervalos que cruzan el periodo',
                'Tiempo',
                [
                    {
                        name: 'from',
                        in: 'query',
                        required: true,
                        schema: { ...string, format: 'date-time' },
                    },
                    {
                        name: 'to',
                        in: 'query',
                        required: true,
                        schema: { ...string, format: 'date-time' },
                        description: 'Fin exclusivo; horario con zona explícita.',
                    },
                ],
            ),
        },
        '/api/v1/timer': {
            get: operation(
                'Consultar tu temporizador persistente y la hora del servidor',
                'Temporizador',
            ),
        },
        '/api/v1/projects/{projectId}/timer': {
            post: {
                ...operation(
                    'Iniciar ahora un temporizador (uno activo por usuario)',
                    'Temporizador',
                    [projectParam],
                    {
                        type: 'object',
                        properties: {
                            description: { ...string, maxLength: 2000 },
                            entryId: {
                                ...objectId,
                                description:
                                    'Continuar una entrada finalizada del proyecto en un nuevo intervalo. Copia descripción, miembros que siguen en el proyecto y etiquetas existentes; ignora los otros campos.',
                            },
                            assignees: {
                                type: 'array',
                                minItems: 1,
                                items: objectId,
                                description: 'Por defecto el usuario actual.',
                            },
                            tags: { type: 'array', items: objectId },
                        },
                    },
                ),
                responses: {
                    ...responses,
                    '201': {
                        description:
                            'Temporizador creado: { data: { timer, serverNow } }. El inicio se fija en el servidor y end es null.',
                    },
                },
            },
        },
        '/api/v1/timer/{entryId}/stop': {
            post: operation(
                'Detener tu temporizador y convertirlo en una entrada finalizada; operación idempotente',
                'Temporizador',
                [parameter('entryId')],
            ),
        },
        '/api/v1/projects/{projectId}/report': {
            get: operation(
                'Horas finalizadas del periodo por persona y suma del equipo; los intervalos se recortan al rango',
                'Informes',
                [
                    projectParam,
                    {
                        name: 'from',
                        in: 'query',
                        required: true,
                        schema: { ...string, format: 'date-time' },
                        description: 'Inicio inclusivo del periodo con zona horaria.',
                    },
                    {
                        name: 'to',
                        in: 'query',
                        required: true,
                        schema: { ...string, format: 'date-time' },
                        description: 'Fin exclusivo del periodo con zona horaria.',
                    },
                ],
            ),
        },
        '/health': { get: { ...operation('Comprobar disponibilidad', 'Health'), security: [] } },
        '/api/v1/auth/register': {
            post: {
                ...operation('Crear cuenta y abrir sesión', 'Cuenta', [], ref('Register')),
                security: [],
                responses: {
                    ...responses,
                    '201': {
                        description:
                            'Cuenta creada; { data: { _id, name, email } }. Cookie de sesión emitida.',
                    },
                },
            },
        },
        '/api/v1/auth/login': {
            post: {
                ...operation('Iniciar sesión', 'Cuenta', [], ref('Credentials')),
                security: [],
            },
        },
        '/api/v1/auth/logout': { post: operation('Revocar sesión actual', 'Cuenta') },
        '/api/v1/auth/me': {
            get: operation('Consultar la propia cuenta', 'Cuenta'),
            patch: operation(
                'Actualizar nombre, correo o contraseña',
                'Cuenta',
                [],
                ref('Profile'),
            ),
        },
        '/api/v1/projects': {
            get: operation('Listar proyectos de los que eres miembro', 'Proyectos'),
            post: {
                ...operation(
                    'Crear proyecto y ser su propietario',
                    'Proyectos',
                    [],
                    ref('Project'),
                ),
                responses: { ...responses, '201': { description: 'Proyecto creado.' } },
            },
        },
        '/api/v1/projects/{projectId}': {
            get: operation('Consultar proyecto con miembros y etiquetas', 'Proyectos', [
                projectParam,
            ]),
            patch: operation(
                'Editar proyecto (propietario)',
                'Proyectos',
                [projectParam],
                ref('Project'),
            ),
            delete: operation(
                'Eliminar proyecto, entradas e invitaciones (propietario)',
                'Proyectos',
                [projectParam],
            ),
        },
        '/api/v1/projects/{projectId}/members/{memberId}': {
            delete: operation(
                'Retirar miembro conservando el historial (propietario)',
                'Miembros',
                [projectParam, parameter('memberId')],
            ),
        },
        '/api/v1/invitations': {
            get: operation(
                'Consultar bandeja de invitaciones pendientes del propio correo',
                'Invitaciones',
            ),
        },
        '/api/v1/invitations/{invitationId}/respond': {
            post: operation(
                'Aceptar o rechazar una invitación dirigida a tu cuenta',
                'Invitaciones',
                [parameter('invitationId')],
                ref('Response'),
            ),
        },
        '/api/v1/projects/{projectId}/invitations': {
            get: operation(
                'Listar invitaciones pendientes enviadas (propietario)',
                'Invitaciones',
                [projectParam],
            ),
            post: {
                ...operation(
                    'Invitar por correo, incluso antes del registro (propietario)',
                    'Invitaciones',
                    [projectParam],
                    ref('Invitation'),
                ),
                responses: { ...responses, '201': { description: 'Invitación creada.' } },
            },
        },
        '/api/v1/projects/{projectId}/invitations/{invitationId}': {
            delete: operation('Cancelar invitación pendiente (propietario)', 'Invitaciones', [
                projectParam,
                parameter('invitationId'),
            ]),
        },
        '/api/v1/projects/{projectId}/tags': {
            post: {
                ...operation(
                    'Crear etiqueta con color (propietario)',
                    'Etiquetas',
                    [projectParam],
                    ref('Tag'),
                ),
                responses: {
                    ...responses,
                    '201': {
                        description:
                            'Etiqueta creada; se devuelven todas las etiquetas del proyecto.',
                    },
                },
            },
        },
        '/api/v1/projects/{projectId}/tags/{tagId}': {
            patch: operation(
                'Editar etiqueta (propietario)',
                'Etiquetas',
                [projectParam, parameter('tagId')],
                ref('Tag'),
            ),
            delete: operation(
                'Eliminar etiqueta y quitarla de las entradas (propietario)',
                'Etiquetas',
                [projectParam, parameter('tagId')],
            ),
        },
        '/api/v1/projects/{projectId}/entries': {
            get: operation('Listar entradas del proyecto; filtros combinables', 'Tiempo', [
                projectParam,
                ...['users', 'tags'].map((name) => ({
                    name,
                    in: 'query',
                    schema: string,
                    description:
                        'IDs separados por comas; coincide con cualquiera de los seleccionados.',
                })),
                {
                    name: 'from',
                    in: 'query',
                    schema: { ...string, format: 'date-time' },
                    description: 'Límite inferior excluyente para el fin de la entrada.',
                },
                {
                    name: 'to',
                    in: 'query',
                    schema: { ...string, format: 'date-time' },
                    description: 'Límite superior excluyente para el inicio de la entrada.',
                },
                {
                    name: 'search',
                    in: 'query',
                    schema: { ...string, maxLength: 200 },
                    description: 'Texto literal de la descripción; ignora mayúsculas.',
                },
            ]),
            post: {
                ...operation(
                    'Crear entrada asignable a varios miembros',
                    'Tiempo',
                    [projectParam],
                    ref('Entry'),
                ),
                responses: { ...responses, '201': { description: 'Entrada creada.' } },
            },
        },
        '/api/v1/projects/{projectId}/entries/{entryId}': {
            patch: operation(
                'Editar entrada del proyecto',
                'Tiempo',
                [projectParam, parameter('entryId')],
                ref('Entry'),
            ),
            delete: operation('Eliminar entrada del proyecto', 'Tiempo', [
                projectParam,
                parameter('entryId'),
            ]),
        },
    },
};
