import { z } from 'zod';
import { config } from '../config.js';
import { cacheStore } from '../storage/cache-store.js';
import {
  AddressInput,
  Coordinates,
  GeocodedAddress,
  TomTomGeocodeResultSchema,
} from '../types/index.js';

// TomTom Geocoding API response schema
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

// TomTom Reverse Geocoding API response schema
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

// Location search result
export interface LocationSearchResult {
  id: string;
  name: string;
  address: string;
  coordinates: Coordinates;
  type: string;
}

// Rate limiting helper
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class GeocodingService {
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

  async geocode(input: AddressInput): Promise<GeocodedAddress> {
    // Check cache first
    const cached = await cacheStore.get<GeocodedAddress>('geocode', input);
    if (cached) {
      return cached;
    }

    // Rate limit before making API call
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
      headers: {
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(config.tomtom.requestTimeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `TomTom Geocoding API error: ${response.status} - ${errorText}`
      );
    }

    const data = await response.json();
    const parsed = TomTomGeocodeResponseSchema.parse(data);

    if (parsed.results.length === 0) {
      throw new Error(`No geocoding results found for address: ${input.address}`);
    }

    const result = parsed.results[0];

    // Filter to US addresses only
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

    // Cache the result
    await cacheStore.set('geocode', input, geocoded);

    return geocoded;
  }

  async geocodeMultiple(
    inputs: AddressInput[]
  ): Promise<Map<string, GeocodedAddress>> {
    const results = new Map<string, GeocodedAddress>();

    // Process sequentially to respect rate limits
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

  async reverseGeocode(
    coordinates: Coordinates,
    label?: string
  ): Promise<GeocodedAddress> {
    // Check cache first
    const cacheKey = { type: 'reverse', ...coordinates };
    const cached = await cacheStore.get<GeocodedAddress>('geocode', cacheKey);
    if (cached) {
      return { ...cached, label };
    }

    // Rate limit before making API call
    await this.rateLimit();

    const url = new URL(
      `${this.baseUrl}/search/2/reverseGeocode/${coordinates.lat},${coordinates.lng}.json`
    );
    url.searchParams.set('key', this.apiKey);

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
        `TomTom Reverse Geocoding API error: ${response.status} - ${errorText}`
      );
    }

    const data = await response.json();
    const parsed = TomTomReverseGeocodeResponseSchema.parse(data);

    if (parsed.addresses.length === 0) {
      throw new Error(
        `No address found for coordinates: ${coordinates.lat}, ${coordinates.lng}`
      );
    }

    const result = parsed.addresses[0];

    // Filter to US addresses only
    if (result.address.countryCode !== 'US') {
      throw new Error(
        `Location is not in the US (found: ${result.address.country})`
      );
    }

    const geocoded: GeocodedAddress = {
      address: result.address.freeformAddress,
      label,
      coordinates,
      formattedAddress: result.address.freeformAddress,
      confidence: 1,
    };

    // Cache the result
    await cacheStore.set('geocode', cacheKey, geocoded);

    return geocoded;
  }

  async searchLocations(
    query: string,
    center?: Coordinates,
    limit: number = 5
  ): Promise<LocationSearchResult[]> {
    // Rate limit before making API call
    await this.rateLimit();

    const encodedQuery = encodeURIComponent(query);
    const url = new URL(
      `${this.baseUrl}/search/2/search/${encodedQuery}.json`
    );
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
      headers: {
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(config.tomtom.requestTimeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `TomTom Search API error: ${response.status} - ${errorText}`
      );
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

// Singleton instance
export const geocodingService = new GeocodingService();
