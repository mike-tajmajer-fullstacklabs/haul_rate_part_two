import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { cacheStore } from '../storage/cache-store.js';
import {
  GeocodedAddress,
  RouteSegment,
  AddressInput,
  Coordinates,
  TomTomGeocodeResultSchema,
} from '../types/index.js';
import {
  IRoutingProvider,
  RouteRequest,
  LocationSearchResult,
  RoutingProviderType,
} from './routing-provider.js';

// TomTom API response schemas
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

const TomTomGeocodeResponseSchema = z.object({
  summary: z.object({
    query: z.string(),
    queryType: z.string(),
    queryTime: z.number(),
    numResults: z.number(),
    totalResults: z.number(),
  }),
  results: z.array(TomTomGeocodeResultSchema),
});

const TomTomReverseGeocodeResponseSchema = z.object({
  summary: z.object({
    queryTime: z.number(),
    numResults: z.number(),
  }),
  addresses: z.array(
    z.object({
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
      position: z.string(),
    })
  ),
});

// Rate limiting helper
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class TomTomProvider implements IRoutingProvider {
  readonly name: RoutingProviderType = 'tomtom';
  private apiKey: string;
  private baseUrl: string;
  private lastRequestTime: number = 0;
  private minRequestInterval: number = 250;

  constructor() {
    if (!config.tomtom.enabled) {
      throw new Error('TomTom API is not configured. Please set TOMTOM_API_KEY.');
    }
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

  private getCacheKey(type: string, data: unknown): string {
    return `tomtom:${type}:${JSON.stringify(data)}`;
  }

  async calculateRoute(request: RouteRequest): Promise<RouteSegment> {
    const cacheKey = {
      provider: 'tomtom',
      origin: request.origin.coordinates,
      destination: request.destination.coordinates,
      departureTime: request.departureTime,
    };

    const cached = await cacheStore.get<RouteSegment>('route', cacheKey);
    if (cached) {
      return cached;
    }

    await this.rateLimit();

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
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(config.tomtom.requestTimeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`TomTom Routing API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const parsed = TomTomRouteResponseSchema.parse(data);

    if (parsed.routes.length === 0) {
      throw new Error('No route found between the specified locations');
    }

    const routeData = parsed.routes[0];
    const summary = routeData.summary;

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
      trafficDensity: Math.round(trafficDensity * 1000) / 1000,
      departureTime: summary.departureTime,
      arrivalTime: summary.arrivalTime,
    };

    await cacheStore.set('route', cacheKey, segment);

    return segment;
  }

  async calculateMultipleRoutes(requests: RouteRequest[]): Promise<RouteSegment[]> {
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

  async geocode(input: AddressInput): Promise<GeocodedAddress> {
    const cacheKey = { provider: 'tomtom', ...input };
    const cached = await cacheStore.get<GeocodedAddress>('geocode', cacheKey);
    if (cached) {
      return cached;
    }

    await this.rateLimit();

    const encodedAddress = encodeURIComponent(input.address);
    const url = new URL(
      `${this.baseUrl}${config.tomtom.geocodingEndpoint}/${encodedAddress}.json`
    );
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('countrySet', config.defaults.countrySet);
    url.searchParams.set('limit', '1');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(config.tomtom.requestTimeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`TomTom Geocoding API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const parsed = TomTomGeocodeResponseSchema.parse(data);

    if (parsed.results.length === 0) {
      throw new Error(`No geocoding results found for address: ${input.address}`);
    }

    const result = parsed.results[0];

    if (result.address.countryCode !== 'US') {
      throw new Error(
        `Address is not in the US: ${input.address} (found: ${result.address.country})`
      );
    }

    const geocoded: GeocodedAddress = {
      address: input.address,
      label: input.label,
      coordinates: {
        lat: result.position.lat,
        lng: result.position.lon,
      },
      formattedAddress: result.address.freeformAddress,
      confidence: Math.min(result.score / 100, 1),
    };

    await cacheStore.set('geocode', cacheKey, geocoded);

    return geocoded;
  }

  async geocodeMultiple(inputs: AddressInput[]): Promise<Map<string, GeocodedAddress>> {
    const results = new Map<string, GeocodedAddress>();

    for (const input of inputs) {
      try {
        const geocoded = await this.geocode(input);
        results.set(input.address, geocoded);
      } catch (error) {
        throw new Error(
          `Failed to geocode address "${input.address}": ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    return results;
  }

  async reverseGeocode(coordinates: Coordinates, label?: string): Promise<GeocodedAddress> {
    const cacheKey = { provider: 'tomtom', type: 'reverse', ...coordinates };
    const cached = await cacheStore.get<GeocodedAddress>('geocode', cacheKey);
    if (cached) {
      return { ...cached, label };
    }

    await this.rateLimit();

    const url = new URL(
      `${this.baseUrl}/search/2/reverseGeocode/${coordinates.lat},${coordinates.lng}.json`
    );
    url.searchParams.set('key', this.apiKey);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(config.tomtom.requestTimeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`TomTom Reverse Geocoding API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const parsed = TomTomReverseGeocodeResponseSchema.parse(data);

    if (parsed.addresses.length === 0) {
      throw new Error(
        `No address found for coordinates: ${coordinates.lat}, ${coordinates.lng}`
      );
    }

    const result = parsed.addresses[0];

    if (result.address.countryCode !== 'US') {
      throw new Error(`Location is not in the US (found: ${result.address.country})`);
    }

    const geocoded: GeocodedAddress = {
      address: result.address.freeformAddress,
      label,
      coordinates,
      formattedAddress: result.address.freeformAddress,
      confidence: 1,
    };

    await cacheStore.set('geocode', cacheKey, geocoded);

    return geocoded;
  }

  async searchLocations(
    query: string,
    center?: Coordinates,
    limit: number = 5
  ): Promise<LocationSearchResult[]> {
    await this.rateLimit();

    const encodedQuery = encodeURIComponent(query);
    const url = new URL(`${this.baseUrl}/search/2/search/${encodedQuery}.json`);
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('countrySet', config.defaults.countrySet);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('typeahead', 'true');

    if (center) {
      url.searchParams.set('lat', String(center.lat));
      url.searchParams.set('lon', String(center.lng));
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(config.tomtom.requestTimeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`TomTom Search API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const parsed = TomTomGeocodeResponseSchema.parse(data);

    return parsed.results
      .filter((r) => r.address.countryCode === 'US')
      .map((result) => ({
        id: result.id,
        name: result.address.municipality || result.address.freeformAddress,
        address: result.address.freeformAddress,
        coordinates: {
          lat: result.position.lat,
          lng: result.position.lon,
        },
        type: result.type,
      }));
  }
}
