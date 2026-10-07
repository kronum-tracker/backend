# Kronum backend

API de seguimiento de tiempo con Express 5, TypeScript y MongoDB. Requiere Node.js 24.

## Desarrollo

```powershell
npm ci
npm run dev:local
```

`dev:local` arranca MongoDB en 127.0.0.1 con almacenamiento persistente en `.data/mongo`, excluido de Git. Puede descargar el binario oficial en el primer arranque. Es una herramienta de desarrollo; no uses este modo para despliegues públicos.

Para MongoDB instalado o administrado, copia `.env.example` a `.env`, configura `MONGO_URI` y ejecuta `npm run dev`. La API escucha en el puerto 6200; la documentación está en http://localhost:6200/api-docs y la comprobación de disponibilidad en `/health`.

## API y permisos

- `/api/v1/auth/register`, `/login`, `/logout`, `/me` bajo `/auth`: cuentas y sesiones de 7 días. El registro exige `passwordConfirmation`. `/me` permite GET y PATCH; solo puede cambiarse la contraseña, con `currentPassword`, revocando las otras sesiones. El nombre y el correo son inmutables.
- `/api/v1/projects`: creación y listado de proyectos con `teamMilliseconds` de las entradas finalizadas; `/:projectId` permite consulta, edición y eliminación.
- `/api/v1/invitations`: bandeja personal; `/:invitationId/respond` acepta `accepted` o `declined`.
- `/api/v1/projects/:projectId/invitations`: invitaciones enviadas, creación y cancelación con `/:invitationId`.
- `/api/v1/projects/:projectId/invitees?query=...`: búsqueda de usuarios por nombre o correo, solo para propietarios. Las invitaciones aceptan `userId`, `recipient` (nombre exacto o correo) o `email`; los nombres duplicados requieren seleccionar un usuario o indicar su correo.
- `/api/v1/projects/:projectId/tags`: creación; `/:tagId` permite edición y eliminación.
- `/api/v1/projects/:projectId/members/:memberId`: retirada de miembros conservando las asignaciones históricas.
- `/api/v1/projects/:projectId/entries`: listado y creación; `/:entryId` permite edición y eliminación. Los filtros `users` y `tags` aceptan IDs separados por comas; `from` y `to` son fechas ISO con zona horaria; `search` busca texto literal.

Todos los miembros pueden gestionar las entradas del proyecto. Solo el propietario puede administrar el proyecto, etiquetas, invitaciones y miembros. Las contraseñas se derivan con scrypt; las cookies son HttpOnly y los tokens se almacenan como hashes. Las invitaciones aparecen en la cuenta con el correo indicado, aunque se registre posteriormente. No se envía correo electrónico.

Las respuestas de éxito contienen `{ data: ... }` y los errores muestran `message`. Las entradas requieren `description`, `start`, `end`, `assignees` (al menos un miembro); `tags` es opcional. Se almacenan fechas UTC y el filtro incluye los intervalos que se solapan.

## Temporizador e informes

- `GET /api/v1/timer` devuelve `{ data: { timer, serverNow } }` para el usuario autenticado.
- `POST /api/v1/projects/:projectId/timer` inicia desde la hora del servidor. Acepta `description`, `assignees` y `tags`; por defecto asigna al propio usuario. Un índice único parcial impide tener más de un temporizador activo por usuario, incluso con solicitudes concurrentes.
- `POST /api/v1/timer/:entryId/stop` finaliza el propio contador de forma idempotente. La entrada conserva su ID, inicio y asignaciones.
- `GET /api/v1/projects/:projectId/report?from=...&to=...` devuelve horas por persona, `teamMilliseconds`, `entryMilliseconds` y número de entradas. El inicio es inclusivo y el fin exclusivo, ambos ISO con zona horaria. Los intervalos se recortan al periodo y se excluyen los temporizadores en marcha.

Las entradas activas tienen `end: null`; no aparecen en el listado de entradas finalizadas ni se pueden editar o borrar por las rutas manuales. Retirar al usuario que inició un temporizador lo finaliza conservando el registro. El total del equipo suma las horas de los miembros: cada miembro asignado recibe la duración completa de una entrada compartida.

Para continuar una entrada, `POST /api/v1/projects/:projectId/timer` acepta `{ entryId }`: copia los datos desde una entrada finalizada del mismo proyecto, conserva miembros actuales y etiquetas existentes y fija un nuevo inicio. La entrada original se conserva. Los permisos y la restricción de un temporizador por usuario también se aplican a esta operación.

`GET /api/v1/me/entries?from=...&to=...` devuelve únicamente entradas finalizadas asignadas al usuario autenticado en proyectos de los que sigue siendo miembro. Las fechas requieren ISO con zona horaria, el fin es exclusivo y se incluyen intervalos que se solapan con el rango. Cada entrada incorpora su proyecto (`_id`, `name`, `color`) para el panel personal; el frontend recorta las duraciones al periodo.

## Verificación y producción

```powershell
npm run build
npm test
npm run lint
```

Las pruebas usan una base temporal independiente. Para producción usa MongoDB administrado/persistente, HTTPS, `APP_ORIGIN` con el origen público y `NODE_ENV=production` para activar cookies seguras. Compila con `npm run build` y arranca con `npm start`. El límite de autenticación es de 30 intentos por IP cada 15 minutos y se mantiene en memoria por proceso.

Consulta `../README.md` para el arranque de ambos repositorios y las decisiones funcionales.
