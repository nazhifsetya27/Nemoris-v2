import './config/loadEnv.js';
import express from 'express';
import { logger } from './utils/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import webhookRoutes from './routes/webhook.js';
import apiRoutes from './routes/api.js';
import { healthCheck } from './services/health.js';
import { initScheduler } from './services/reminder.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

app.get('/health', healthCheck);
app.use('/webhook', webhookRoutes);
app.use('/api', apiRoutes);

app.use(errorHandler);

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Nemoris server running on port ${PORT}`);
  initScheduler();
});

export default app;
