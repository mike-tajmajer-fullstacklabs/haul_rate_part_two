import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { cacheStore } from '../storage/cache-store.js';
import {
  GeocodedAddress,
  RouteSegment,
  AddressInput,
  Coordinates,
} from '../types/index.js';
import {
  IRoutingProvider,
  RouteRequest,
  LocationSearchResult,
  RoutingProviderType,
} from './routing-provider.js';

// HERE API response schemas
const HereRouteResponseSchema = z.object({
  routes: z.array(
    z.object({
      id: z.string(),
      sections: z.array(
        z.object({
          id: z.string(),
          type: z.string(),
          departure: z.object({
            time: z.string(),
            place: z.object({
              location: z.object({
                lat: z.number(),
                lng: z.number(),
              }),
            }),
          }),
          arrival: z.object({
            time: z.string(),
            place: z.object({
              location: z.object({
                lat: z.number(),
                lng: z.number(),
              }),
            }),
          }),
          summary: z.object({
            duration: z.number(), // seconds
            length: z.number(), // meters
            baseDuration: z.number().optional(), // seconds without traffic
            typicalDuration: z.number().optional(), // typical duration with traffic
          }),
        })
      ),
    })
  ),
});

const HereGeocodeResponseSchema = z.object({
  items: z.array(
    z.object({
      title: z.string(),
      id: z.string(),
      resultType: z.string().optional(),
      address: z.object({
        label: z.string(),
        countryCode: z.string(),
        countryName: z.string(),
        state: z.string().optional(),
        county: z.string().optional(),
        city: z.string().optional(),
        street: z.string().optional(),
        postalCode: z.string().optional(),
        houseNumber: z.string().optional(),
      }),
      position: z.object({
        lat: z.number(),
        lng: z.number(),
      }),
      scoring: z.object({
        queryScore: z.number().optional(),
        fieldScore: z.object({}).passthrough().optional(),
      }).optional(),
    })
  ),
});

const HereReverseGeocodeResponseSchema = z.object({
  items: z.array(
    z.object({
      title: z.string(),
      id: z.string(),
      resultType: z.string().optional(),
      address: z.object({
        label: z.string(),
        countryCode: z.string(),
        countryName: z.string(),
        state: z.string().optional(),
        county: z.string().optional(),
        city: z.string().optional(),
        street: z.string().optional(),
        postalCode: z.string().optional(),
        houseNumber: z.string().optional(),
      }),
      position: z.object({
        lat: z.number(),
        lng: z.number(),
      }),
    })
  ),
});

const HereAutosuggestResponseSchema = z.object({
  items: z.array(
    z.object({
      title: z.string(),
      id: z.string(),
      resultType: z.string().optional(),
      address: z.object({
        label: z.string(),
        countryCode: z.string().optional(),
        countryName: z.string().optional(),
        state: z.string().optional(),
        city: z.string().optional(),
      }).optional(),
      position: z.object({
        lat: z.number(),
        lng: z.number(),
      }).optional(),
      highlights: z.unknown().optional(),
    })
  ),
});

// Rate limiting helper
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class HereProvider implements IRoutingProvider {
  readonly name: RoutingProviderType = 'here';
  private apiKey: string;
  private lastRequestTime: number = 0;
  private minRequestInterval: number = 250;

  constructor() {
    if (!config.here.enabled) {
      throw new Error('HERE API is not configured. Please set HERE_API_KEY.');
    }
    this.apiKey = config.here.apiKey;
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
    const cacheKey = {
      provider: 'here',
      origin: request.origin.coordinates,
      destination: request.destination.coordinates,
      departureTime: request.departureTime,
    };

    const cached = await cacheStore.get<RouteSegment>('route', cacheKey);
    if (cached) {
      return cached;
    }

    await this.rateLimit();

    const url = new URL(`${config.here.routingBaseUrl}/v8/routes`);
    url.searchParams.set('apiKey', this.apiKey);
    url.searchParams.set('transportMode', 'car');
    url.searchParams.set(
      'origin',
      `${request.origin.coordinates.lat},${request.origin.coordinates.lng}`
    );
    url.searchParams.set(
      'destination',
      `${request.destination.coordinates.lat},${request.destination.coordinates.lng}`
    );
    url.searchParams.set('departureTime', request.departureTime);
    url.searchParams.set('return', 'summary,typicalDuration');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(config.here.requestTimeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HERE Routing API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const parsed = HereRouteResponseSchema.parse(data);

    if (parsed.routes.length === 0) {
      throw new Error('No route found between the specified locations');
    }

    const route = parsed.routes[0];
    const section = route.sections[0];
    const summary = section.summary;

    // Calculate traffic density
    // HERE provides baseDuration (without traffic) or typicalDuration
    // baseDuration is the free-flow time
    const noTrafficTime = summary.baseDuration ?? summary.typicalDuration ?? summary.duration;
    const trafficDensity = summary.duration / noTrafficTime;

    const segment: RouteSegment = {
      id: uuidv4(),
      origin: request.origin,
      destination: request.destination,
      distanceMeters: summary.length,
      travelTimeSeconds: summary.duration,
      noTrafficTravelTimeSeconds: noTrafficTime,
      trafficDensity: Math.round(trafficDensity * 1000) / 1000,
      departureTime: section.departure.time,
      arrivalTime: section.arrival.time,
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
    const cacheKey = { provider: 'here', ...input };
    const cached = await cacheStore.get<GeocodedAddress>('geocode', cacheKey);
    if (cached) {
      return cached;
    }

    await this.rateLimit();

    const url = new URL(`${config.here.geocodingBaseUrl}/v1/geocode`);
    url.searchParams.set('apiKey', this.apiKey);
    url.searchParams.set('q', input.address);
    url.searchParams.set('in', 'countryCode:USA');
    url.searchParams.set('limit', '1');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(config.here.requestTimeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HERE Geocoding API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const parsed = HereGeocodeResponseSchema.parse(data);

    if (parsed.items.length === 0) {
      throw new Error(`No geocoding results found for address: ${input.address}`);
    }

    const result = parsed.items[0];

    if (result.address.countryCode !== 'USA') {
      throw new Error(
        `Address is not in the US: ${input.address} (found: ${result.address.countryName})`
      );
    }

    const geocoded: GeocodedAddress = {
      address: input.address,
      label: input.label,
      coordinates: {
        lat: result.position.lat,
        lng: result.position.lng,
      },
      formattedAddress: result.address.label,
      confidence: result.scoring?.queryScore ?? 1,
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
    const cacheKey = { provider: 'here', type: 'reverse', ...coordinates };
    const cached = await cacheStore.get<GeocodedAddress>('geocode', cacheKey);
    if (cached) {
      return { ...cached, label };
    }

    await this.rateLimit();

    const url = new URL(`${config.here.reverseGeocodeBaseUrl}/v1/revgeocode`);
    url.searchParams.set('apiKey', this.apiKey);
    url.searchParams.set('at', `${coordinates.lat},${coordinates.lng}`);
    url.searchParams.set('limit', '1');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(config.here.requestTimeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HERE Reverse Geocoding API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const parsed = HereReverseGeocodeResponseSchema.parse(data);

    if (parsed.items.length === 0) {
      throw new Error(
        `No address found for coordinates: ${coordinates.lat}, ${coordinates.lng}`
      );
    }

    const result = parsed.items[0];

    if (result.address.countryCode !== 'USA') {
      throw new Error(`Location is not in the US (found: ${result.address.countryName})`);
    }

    const geocoded: GeocodedAddress = {
      address: result.address.label,
      label,
      coordinates,
      formattedAddress: result.address.label,
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

    const url = new URL(`${config.here.searchBaseUrl}/v1/autosuggest`);
    url.searchParams.set('apiKey', this.apiKey);
    url.searchParams.set('q', query);
    url.searchParams.set('in', 'countryCode:USA');
    url.searchParams.set('limit', String(limit));

    if (center) {
      url.searchParams.set('at', `${center.lat},${center.lng}`);
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(config.here.requestTimeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HERE Autosuggest API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const parsed = HereAutosuggestResponseSchema.parse(data);

    return parsed.items
      .filter((r) => r.position && r.address?.countryCode === 'USA')
      .map((result) => ({
        id: result.id,
        name: result.address?.city || result.title,
        address: result.address?.label || result.title,
        coordinates: {
          lat: result.position!.lat,
          lng: result.position!.lng,
        },
        type: result.resultType || 'place',
      }));
  }
}
