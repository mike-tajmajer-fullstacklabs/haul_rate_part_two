import express from 'express';
import { config } from './config.js';
import { cacheStore } from './storage/cache-store.js';
import { planStore } from './storage/plan-store.js';
import { holidayService } from './services/holidays.js';
import deliveryRoutes from './api/routes.js';

const app = express();

// Middleware
app.use(express.json());

// CORS for frontend development
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }

  next();
});

// Routes
app.use('/api/delivery', deliveryRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Traffic Density Forecasting API',
    version: '1.0.0',
    endpoints: {
      optimize: 'POST /api/delivery/optimize',
      listPlans: 'GET /api/delivery/plans',
      getPlan: 'GET /api/delivery/plans/:id',
      deletePlan: 'DELETE /api/delivery/plans/:id',
      dayType: 'GET /api/delivery/day-type?date=YYYY-MM-DD',
      listHolidays: 'GET /api/delivery/holidays?year=YYYY',
      addHoliday: 'POST /api/delivery/holidays',
      removeHoliday: 'DELETE /api/delivery/holidays/:date',
      health: 'GET /api/delivery/health',
    },
  });
});

// Error handling middleware
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error('Error:', err.message);

    if (config.isDevelopment) {
      console.error(err.stack);
    }

    res.status(500).json({
      success: false,
      error: err.message,
      ...(config.isDevelopment && { stack: err.stack }),
    });
  }
);

// Initialize services and start server
async function start() {
  try {
    // Initialize storage
    await cacheStore.init();
    await planStore.init();
    await holidayService.init();

    console.log('Services initialized');

    // Start server
    const server = app.listen(config.port, () => {
      console.log(`Server running at http://localhost:${config.port}`);
      console.log(`Environment: ${config.nodeEnv}`);
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`\nReceived ${signal}, shutting down gracefully...`);

      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });

      // Force exit after timeout
      setTimeout(() => {
        console.error('Forcing exit...');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
