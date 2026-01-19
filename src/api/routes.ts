import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { deliveryOptimizer } from '../services/optimizer.js';
import { holidayService } from '../services/holidays.js';
import { providerManager } from '../services/provider-manager.js';
import { planStore } from '../storage/plan-store.js';
import { OptimizeRequestSchema, UserHolidaySchema, CoordinatesSchema, RoutingProviderSchema } from '../types/index.js';
import { RoutingProviderType } from '../services/routing-provider.js';

const router = Router();

// Error handler helper
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// POST /api/delivery/optimize - Main optimization endpoint
router.post(
  '/optimize',
  asyncHandler(async (req, res) => {
    const parseResult = OptimizeRequestSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid request body',
        details: parseResult.error.errors,
      });
      return;
    }

    const plan = await deliveryOptimizer.optimize(parseResult.data);

    // Save the plan
    await planStore.save(plan);

    res.json({
      success: true,
      plan,
    });
  })
);

// GET /api/delivery/plans - List saved plans
router.get(
  '/plans',
  asyncHandler(async (req, res) => {
    const plans = await planStore.list();

    // Return summary info only
    const summaries = plans.map((plan) => ({
      id: plan.id,
      createdAt: plan.createdAt,
      depot: plan.depot.formattedAddress,
      targetCount: plan.deliveries.length,
      firstDepartureTime: plan.firstDepartureTime,
      dayType: plan.dayType,
      averageTrafficDensity: plan.averageTrafficDensity,
    }));

    res.json({
      success: true,
      plans: summaries,
    });
  })
);

// GET /api/delivery/plans/:id - Get specific plan
router.get(
  '/plans/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const plan = await planStore.get(id);

    if (!plan) {
      res.status(404).json({
        success: false,
        error: `Plan not found: ${id}`,
      });
      return;
    }

    res.json({
      success: true,
      plan,
    });
  })
);

// DELETE /api/delivery/plans/:id - Delete a plan
router.delete(
  '/plans/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const deleted = await planStore.delete(id);

    if (!deleted) {
      res.status(404).json({
        success: false,
        error: `Plan not found: ${id}`,
      });
      return;
    }

    res.json({
      success: true,
      message: 'Plan deleted',
    });
  })
);

// GET /api/delivery/day-type - Get day type for date
router.get(
  '/day-type',
  asyncHandler(async (req, res) => {
    const dateParam = req.query.date as string;

    if (!dateParam) {
      res.status(400).json({
        success: false,
        error: 'date query parameter is required (YYYY-MM-DD format)',
      });
      return;
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dateParam)) {
      res.status(400).json({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD',
      });
      return;
    }

    const date = new Date(dateParam + 'T12:00:00Z');
    const { type, holidayName } = await holidayService.getDayType(date);

    res.json({
      success: true,
      date: dateParam,
      dayType: type,
      holidayName,
    });
  })
);

// GET /api/delivery/holidays - List holidays
router.get(
  '/holidays',
  asyncHandler(async (req, res) => {
    const yearParam = req.query.year as string;
    const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();

    if (isNaN(year) || year < 2000 || year > 2100) {
      res.status(400).json({
        success: false,
        error: 'Invalid year parameter',
      });
      return;
    }

    const holidays = await holidayService.getHolidaysForYear(year);

    res.json({
      success: true,
      year,
      holidays,
    });
  })
);

// POST /api/delivery/holidays - Add user holiday
router.post(
  '/holidays',
  asyncHandler(async (req, res) => {
    const parseResult = UserHolidaySchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid request body',
        details: parseResult.error.errors,
      });
      return;
    }

    try {
      await holidayService.addUserHoliday(parseResult.data);

      res.status(201).json({
        success: true,
        message: 'Holiday added',
        holiday: parseResult.data,
      });
    } catch (error) {
      res.status(409).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add holiday',
      });
    }
  })
);

// DELETE /api/delivery/holidays/:date - Remove user holiday
router.delete(
  '/holidays/:date',
  asyncHandler(async (req, res) => {
    const { date } = req.params;

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      res.status(400).json({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD',
      });
      return;
    }

    const removed = await holidayService.removeUserHoliday(date);

    if (!removed) {
      res.status(404).json({
        success: false,
        error: `User holiday not found for date: ${date}`,
      });
      return;
    }

    res.json({
      success: true,
      message: 'Holiday removed',
    });
  })
);

// Helper to get provider from query param
function getProviderFromQuery(req: Request): RoutingProviderType | undefined {
  const providerParam = req.query.provider as string | undefined;
  if (providerParam) {
    const result = RoutingProviderSchema.safeParse(providerParam);
    if (result.success) {
      return result.data;
    }
  }
  return undefined;
}

// GET /api/delivery/providers - Get available routing providers
router.get('/providers', (req, res) => {
  const available = providerManager.getAvailableProviders();
  const defaultProvider = providerManager.getDefaultProvider();

  res.json({
    success: true,
    providers: available,
    default: defaultProvider,
  });
});

// POST /api/delivery/reverse-geocode - Reverse geocode coordinates to address
router.post(
  '/reverse-geocode',
  asyncHandler(async (req, res) => {
    const parseResult = CoordinatesSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid coordinates',
        details: parseResult.error.errors,
      });
      return;
    }

    const label = req.body.label as string | undefined;
    const providerType = getProviderFromQuery(req) || (req.body.provider as RoutingProviderType | undefined);
    const provider = providerManager.getProvider(providerType);
    const geocoded = await provider.reverseGeocode(parseResult.data, label);

    res.json({
      success: true,
      address: geocoded,
    });
  })
);

// GET /api/delivery/search-locations - Search for locations
router.get(
  '/search-locations',
  asyncHandler(async (req, res) => {
    const query = req.query.q as string;

    if (!query || query.length < 2) {
      res.status(400).json({
        success: false,
        error: 'Query parameter "q" must be at least 2 characters',
      });
      return;
    }

    const lat = req.query.lat ? parseFloat(req.query.lat as string) : undefined;
    const lng = req.query.lng ? parseFloat(req.query.lng as string) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 5;
    const providerType = getProviderFromQuery(req);

    const center = lat !== undefined && lng !== undefined ? { lat, lng } : undefined;

    const provider = providerManager.getProvider(providerType);
    const results = await provider.searchLocations(query, center, limit);

    res.json({
      success: true,
      results,
    });
  })
);

// Health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

export default router;
