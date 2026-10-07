import express from 'express';
import helmet from 'helmet';
import { trackingRoutes } from './routes/tracking.routes.js';
import { healthRoutes } from './routes/health.routes.js';
import { errorHandler } from './middlewares/errorHandler.js';
import swaggerUi from 'swagger-ui-express';
import { swaggerDocument } from './docs/openapi.js';

const app = express();

app.use(helmet());
app.use(express.json({ limit: '64kb' }));
app.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        req.body ??= {};
        if (typeof req.body !== 'object' || Array.isArray(req.body))
            return res
                .status(400)
                .json({ message: 'El cuerpo de la petición debe ser un objeto JSON.' });
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
        const allowed = (process.env.APP_ORIGIN || 'http://localhost:3000')
            .split(',')
            .map((value) => value.trim());
        if (!allowed.includes(req.headers.origin))
            return res.status(403).json({ message: 'Origen no permitido.' });
    }
    next();
});

// Swagger setup
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.use(healthRoutes);
app.use('/api/v1', trackingRoutes);
app.use(errorHandler);

export default app;
