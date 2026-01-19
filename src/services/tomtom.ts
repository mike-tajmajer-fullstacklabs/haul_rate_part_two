import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { cacheStore } from '../storage/cache-store.js';
import {
  GeocodedAddress,
  RouteSegment,
  TomTomRouteResultSchema,
} from '../types/index.js';

// TomTom Routing API response schema
const TomTomRouteResponseSchema = z.object({
  formatVersion: z.string(),
  routes: z.array(
    z.object({
      summary: z.object({
        lengthInMeters: z.number(),
        travelTimeInSeconds: z.number(),
        trafficDelayInSeconds: z.number(),
        trafficLengthInMeters: z.number(),
        departureTime: z.string(),
        arrivalTime: z.string(),
        noTrafficTravelTimeInSeconds: z.number().optional(),
      }),
      legs: z.array(z.unknown()).optional(),
    })
  ),
});

interface RouteRequest {
  origin: GeocodedAddress;
  destination: GeocodedAddress;
  departureTime: string;
}

// Rate limiting helper
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class TomTomRoutingService {
  private apiKey: string;
  private baseUrl: string;
  private lastRequestTime: number = 0;
  private minRequestInterval: number = 250; // 250ms between requests (4 req/sec max)

  constructor() {
    this.apiKey = config.tomtom.apiKey;
    this.baseUrl = config.tomtom.baseUrl;
  }

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.minRequestInterval) {
      await delay(this.minRequestInterval - timeSinceLastRequest);
    }
    this.lastRequestTime = Date.now();
  }

  async calculateRoute(request: RouteRequest): Promise<RouteSegment> {
    // Create cache key from request
    const cacheKey = {
      origin: request.origin.coordinates,
      destination: request.destination.coordinates,
      departureTime: request.departureTime,
    };

    // Check cache first
    const cached = await cacheStore.get<RouteSegment>('route', cacheKey);
    if (cached) {
      return cached;
    }

    // Rate limit before making API call
    await this.rateLimit();

    // Format coordinates for TomTom API
    const locations = `${request.origin.coordinates.lat},${request.origin.coordinates.lng}:${request.destination.coordinates.lat},${request.destination.coordinates.lng}`;

    const url = new URL(
      `${this.baseUrl}${config.tomtom.routingEndpoint}/${locations}/json`
    );
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('traffic', 'true');
    url.searchParams.set('departAt', request.departureTime);
    url.searchParams.set('computeTravelTimeFor', 'all');
    url.searchParams.set('routeType', 'fastest');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(config.tomtom.requestTimeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `TomTom Routing API error: ${response.status} - ${errorText}`
      );
    }

    const data = await response.json();
    const parsed = TomTomRouteResponseSchema.parse(data);

    if (parsed.routes.length === 0) {
      throw new Error('No route found between the specified locations');
    }

    const routeData = parsed.routes[0];
    const summary = routeData.summary;

    // Calculate traffic density (ratio of actual travel time to no-traffic time)
    const noTrafficTime =
      summary.noTrafficTravelTimeInSeconds ?? summary.travelTimeInSeconds;
    const trafficDensity = summary.travelTimeInSeconds / noTrafficTime;

    const segment: RouteSegment = {
      id: uuidv4(),
      origin: request.origin,
      destination: request.destination,
      distanceMeters: summary.lengthInMeters,
      travelTimeSeconds: summary.travelTimeInSeconds,
      noTrafficTravelTimeSeconds: noTrafficTime,
      trafficDensity: Math.round(trafficDensity * 1000) / 1000, // Round to 3 decimal places
      departureTime: summary.departureTime,
      arrivalTime: summary.arrivalTime,
    };

    // Cache the result
    await cacheStore.set('route', cacheKey, segment);

    return segment;
  }

  async calculateMultipleRoutes(
    requests: RouteRequest[]
  ): Promise<RouteSegment[]> {
    // Process sequentially to respect rate limits
    const results: RouteSegment[] = [];

    for (const request of requests) {
      try {
        const result = await this.calculateRoute(request);
        results.push(result);
      } catch (error) {
        throw new Error(
          `Failed to calculate route from "${request.origin.address}" to "${request.destination.address}": ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    return results;
  }
}

// Singleton instance
export const tomtomRoutingService = new TomTomRoutingService();
