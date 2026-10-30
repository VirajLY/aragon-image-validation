import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import imageRoutes from './routes/imageRoutes';
import { errorHandler } from './middleware/errorHandler';
import { initBucket } from './services/storageService';
import { initSSESubscriber } from './utils/sse';
import { createValidationWorker } from './workers/validationWorker';

const app = express();

// Security middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// CORS configuration
app.use(
  cors({
    origin: config.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
  })
);

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Global rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { error: 'Too many requests from this IP, please try again later.' },
});
app.use('/api', limiter);

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'aragon-ai-backend',
  });
});

// API Routes
app.use('/api', imageRoutes);

// Global error handler
app.use(errorHandler);

/**
 * Initializes infrastructure services and starts HTTP server.
 */
async function startServer(): Promise<void> {
  try {
    // 1. Initialize Storage (MinIO or local fallback)
    await initBucket();

    // 2. Initialize SSE pub/sub subscriber
    initSSESubscriber();

    // 3. Initialize BullMQ validation worker (if Redis available)
    createValidationWorker();

    // 4. Start HTTP Server
    const port = config.PORT || 3001;
    const server = app.listen(port, () => {
      console.log(`🚀 Aragon AI Backend running on http://localhost:${port}`);
      console.log(`📡 SSE Stream available at /api/sessions/:id/events`);
    });

    // Graceful shutdown handling
    const shutdown = async (signal: string) => {
      console.log(`Received ${signal}. Shutting down gracefully...`);
      server.close(() => {
        console.log('HTTP server closed.');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err: any) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

// Start server if executed directly
if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export default app;
