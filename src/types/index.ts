import { z } from 'zod';

// Day type enum
export const DayTypeSchema = z.enum(['weekday', 'weekend', 'holiday']);
export type DayType = z.infer<typeof DayTypeSchema>;

// Routing provider enum
export const RoutingProviderSchema = z.enum(['tomtom', 'here']);
export type RoutingProvider = z.infer<typeof RoutingProviderSchema>;

// Coordinates
export const CoordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type Coordinates = z.infer<typeof CoordinatesSchema>;

// Address schemas
export const AddressInputSchema = z.object({
  address: z.string().min(1),
  label: z.string().optional(),
});
export type AddressInput = z.infer<typeof AddressInputSchema>;

export const GeocodedAddressSchema = z.object({
  address: z.string(),
  label: z.string().optional(),
  coordinates: CoordinatesSchema,
  formattedAddress: z.string(),
  confidence: z.number().min(0).max(1),
});
export type GeocodedAddress = z.infer<typeof GeocodedAddressSchema>;

// Route segment with traffic data
export const RouteSegmentSchema = z.object({
  id: z.string().uuid(),
  origin: GeocodedAddressSchema,
  destination: GeocodedAddressSchema,
  distanceMeters: z.number().positive(),
  travelTimeSeconds: z.number().positive(),
  noTrafficTravelTimeSeconds: z.number().positive(),
  trafficDensity: z.number().min(1), // 1.0 = free-flow, higher = delay
  departureTime: z.string().datetime(),
  arrivalTime: z.string().datetime(),
});
export type RouteSegment = z.infer<typeof RouteSegmentSchema>;

// Delivery target in the plan
export const DeliveryTargetSchema = z.object({
  address: GeocodedAddressSchema,
  deliveryDurationMinutes: z.number().positive().default(15),
});
export type DeliveryTarget = z.infer<typeof DeliveryTargetSchema>;

// Optimized delivery entry
export const OptimizedDeliverySchema = z.object({
  order: z.number().int().positive(),
  target: DeliveryTargetSchema,
  route: RouteSegmentSchema,
  returnRoute: RouteSegmentSchema, // Return trip (target → depot)
  roundTripTrafficDensity: z.number().min(1), // Average of outbound + return
  estimatedDepartureTime: z.string().datetime(),
  estimatedArrivalTime: z.string().datetime(),
  estimatedReturnTime: z.string().datetime(),
});
export type OptimizedDelivery = z.infer<typeof OptimizedDeliverySchema>;

// Complete delivery plan
export const DeliveryPlanSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  provider: RoutingProviderSchema,
  depot: GeocodedAddressSchema,
  firstDepartureTime: z.string().datetime(),
  dayType: DayTypeSchema,
  deliveries: z.array(OptimizedDeliverySchema),
  totalDistanceMeters: z.number().nonnegative(),
  totalTravelTimeSeconds: z.number().nonnegative(),
  totalNoTrafficTravelTimeSeconds: z.number().nonnegative(),
  cumulativeTrafficDensity: z.number().min(0),
  averageTrafficDensity: z.number().min(1),
});
export type DeliveryPlan = z.infer<typeof DeliveryPlanSchema>;

// API request schemas
export const OptimizeRequestSchema = z.object({
  depot: AddressInputSchema,
  targets: z.array(AddressInputSchema).min(1).max(50),
  firstDepartureTime: z.string().datetime(),
  deliveryDurationMinutes: z.number().positive().default(15),
  provider: RoutingProviderSchema.optional(),
});
export type OptimizeRequest = z.infer<typeof OptimizeRequestSchema>;

export const OptimizeResponseSchema = z.object({
  success: z.boolean(),
  plan: DeliveryPlanSchema.optional(),
  error: z.string().optional(),
});
export type OptimizeResponse = z.infer<typeof OptimizeResponseSchema>;

// Holiday schemas
export const FixedHolidaySchema = z.object({
  name: z.string(),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
  type: z.literal('fixed'),
});
export type FixedHoliday = z.infer<typeof FixedHolidaySchema>;

export const FloatingHolidaySchema = z.object({
  name: z.string(),
  month: z.number().int().min(1).max(12),
  weekday: z.number().int().min(0).max(6), // 0 = Sunday, 1 = Monday, etc.
  occurrence: z.number().int(), // 1 = first, 2 = second, -1 = last
  type: z.literal('floating'),
});
export type FloatingHoliday = z.infer<typeof FloatingHolidaySchema>;

export const HolidaySchema = z.discriminatedUnion('type', [
  FixedHolidaySchema,
  FloatingHolidaySchema,
]);
export type Holiday = z.infer<typeof HolidaySchema>;

export const UserHolidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string(),
});
export type UserHoliday = z.infer<typeof UserHolidaySchema>;

export const HolidaysConfigSchema = z.object({
  federalHolidays: z.array(HolidaySchema),
  userHolidays: z.array(UserHolidaySchema),
});
export type HolidaysConfig = z.infer<typeof HolidaysConfigSchema>;

// TomTom API response schemas (subset of fields we use)
export const TomTomGeocodeResultSchema = z.object({
  type: z.string(),
  id: z.string(),
  score: z.number(),
  address: z.object({
    streetNumber: z.string().optional(),
    streetName: z.string().optional(),
    municipality: z.string().optional(),
    countrySubdivision: z.string().optional(),
    postalCode: z.string().optional(),
    country: z.string(),
    countryCode: z.string(),
    freeformAddress: z.string(),
  }),
  position: z.object({
    lat: z.number(),
    lon: z.number(),
  }),
});
export type TomTomGeocodeResult = z.infer<typeof TomTomGeocodeResultSchema>;

export const TomTomRouteResultSchema = z.object({
  summary: z.object({
    lengthInMeters: z.number(),
    travelTimeInSeconds: z.number(),
    trafficDelayInSeconds: z.number(),
    trafficLengthInMeters: z.number(),
    departureTime: z.string(),
    arrivalTime: z.string(),
    noTrafficTravelTimeInSeconds: z.number().optional(),
  }),
});
export type TomTomRouteResult = z.infer<typeof TomTomRouteResultSchema>;

// Cache entry schema
export const CacheEntrySchema = z.object({
  key: z.string(),
  data: z.unknown(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type CacheEntry = z.infer<typeof CacheEntrySchema>;
