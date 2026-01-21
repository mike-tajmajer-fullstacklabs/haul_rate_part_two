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

// Google API response schemas
const GoogleDirectionsResponseSchema = z.object({
  status: z.string(),
  routes: z.array(
    z.object({
      legs: z.array(
        z.object({
          distance: z.object({
            value: z.number(), // meters
            text: z.string(),
          }),
          duration: z.object({
            value: z.number(), // seconds
            text: z.string(),
          }),
          duration_in_traffic: z
            .object({
              value: z.number(), // seconds with traffic
              text: z.string(),
            })
            .optional(),
          start_address: z.string(),
          end_address: z.string(),
          start_location: z.object({
            lat: z.number(),
            lng: z.number(),
          }),
          end_location: z.object({
            lat: z.number(),
            lng: z.number(),
          }),
        })
      ),
    })
  ),
  error_message: z.string().optional(),
});

const GoogleGeocodeResponseSchema = z.object({
  status: z.string(),
  results: z.array(
    z.object({
      place_id: z.string(),
      formatted_address: z.string(),
      geometry: z.object({
        location: z.object({
          lat: z.number(),
          lng: z.number(),
        }),
        location_type: z.string().optional(),
      }),
      address_components: z.array(
        z.object({
          long_name: z.string(),
          short_name: z.string(),
          types: z.array(z.string()),
        })
      ),
      types: z.array(z.string()).optional(),
    })
  ),
  error_message: z.string().optional(),
});

const GooglePlacesAutocompleteResponseSchema = z.object({
  status: z.string(),
  predictions: z.array(
    z.object({
      place_id: z.string(),
      description: z.string(),
      structured_formatting: z
        .object({
          main_text: z.string(),
          secondary_text: z.string().optional(),
        })
        .optional(),
      types: z.array(z.string()).optional(),
    })
  ),
  error_message: z.string().optional(),
});

const GooglePlaceDetailsResponseSchema = z.object({
  status: z.string(),
  result: z
    .object({
      place_id: z.string(),
      name: z.string().optional(),
      formatted_address: z.string(),
      geometry: z.object({
        location: z.object({
          lat: z.number(),
          lng: z.number(),
        }),
      }),
      address_components: z
        .array(
          z.object({
            long_name: z.string(),
            short_name: z.string(),
            types: z.array(z.string()),
          })
        )
        .optional(),
    })
    .optional(),
  error_message: z.string().optional(),
});

// Rate limiting helper
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class GoogleProvider implements IRoutingProvider {
  readonly name: RoutingProviderType = 'google';
  private apiKey: string;
  private lastRequestTime: number = 0;
  private minRequestInterval: number = 250;

  constructor() {
    if (!config.google.enabled) {
      throw new Error('Google API is not configured. Please set GOOGLE_API_KEY.');
    }
    this.apiKey = config.google.apiKey;
  }

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.minRequestInterval) {
      await delay(this.minRequestInterval - timeSinceLastRequest);
    }
    this.lastRequestTime = Date.now();
  }

  private getCountryCode(
    addressComponents: Array<{ long_name: string; short_name: string; types: string[] }>
  ): string | undefined {
    const country = addressComponents.find((c) => c.types.includes('country'));
    return country?.short_name;
  }

  async calculateRoute(request: RouteRequest): Promise<RouteSegment> {
    const trafficModel = request.googleTrafficModel || 'best_guess';
    const cacheKey = {
      provider: 'google',
      origin: request.origin.coordinates,
      destination: request.destination.coordinates,
      departureTime: request.departureTime,
      trafficModel,
    };

    const cached = await cacheStore.get<RouteSegment>('route', cacheKey);
    if (cached) {
      return cached;
    }

    await this.rateLimit();

    const origin = `${request.origin.coordinates.lat},${request.origin.coordinates.lng}`;
    const destination = `${request.destination.coordinates.lat},${request.destination.coordinates.lng}`;

    // Convert ISO 8601 departure time to Unix timestamp
    const departureTimestamp = Math.floor(new Date(request.departureTime).getTime() / 1000);

    const url = new URL(`${config.google.directionsBaseUrl}/json`);
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('origin', origin);
    url.searchParams.set('destination', destination);
    url.searchParams.set('departure_time', String(departureTimestamp));
    url.searchParams.set('traffic_model', trafficModel);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(config.google.requestTimeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Directions API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const parsed = GoogleDirectionsResponseSchema.parse(data);

    if (parsed.status !== 'OK') {
      throw new Error(
        `Google Directions API error: ${parsed.status}${parsed.error_message ? ` - ${parsed.error_message}` : ''}`
      );
    }

    if (parsed.routes.length === 0 || parsed.routes[0].legs.length === 0) {
      throw new Error('No route found between the specified locations');
    }

    const leg = parsed.routes[0].legs[0];

    // Google provides duration (historical average) and duration_in_traffic (with predicted traffic)
    // NOTE: Google's "duration" is NOT true free-flow time - it's based on historical averages.
    // This means duration_in_traffic can be LESS than duration when predicted conditions are
    // better than typical (e.g., off-peak hours, optimistic traffic model).
    // We clamp to minimum 1.0 for consistency with TomTom/HERE which use true free-flow baselines.
    const travelTimeWithTraffic = leg.duration_in_traffic?.value ?? leg.duration.value;
    const noTrafficTime = leg.duration.value;
    const rawTrafficDensity = travelTimeWithTraffic / noTrafficTime;
    const trafficDensity = Math.max(1.0, rawTrafficDensity);

    // Calculate arrival time
    const departureDate = new Date(request.departureTime);
    const arrivalDate = new Date(departureDate.getTime() + travelTimeWithTraffic * 1000);

    const segment: RouteSegment = {
      id: uuidv4(),
      origin: request.origin,
      destination: request.destination,
      distanceMeters: leg.distance.value,
      travelTimeSeconds: travelTimeWithTraffic,
      noTrafficTravelTimeSeconds: noTrafficTime,
      trafficDensity: Math.round(trafficDensity * 1000) / 1000,
      departureTime: departureDate.toISOString(),
      arrivalTime: arrivalDate.toISOString(),
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
    const cacheKey = { provider: 'google', ...input };
    const cached = await cacheStore.get<GeocodedAddress>('geocode', cacheKey);
    if (cached) {
      return cached;
    }

    await this.rateLimit();

    const url = new URL(`${config.google.geocodingBaseUrl}/json`);
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('address', input.address);
    url.searchParams.set('components', 'country:US');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(config.google.requestTimeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Geocoding API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const parsed = GoogleGeocodeResponseSchema.parse(data);

    if (parsed.status !== 'OK') {
      if (parsed.status === 'ZERO_RESULTS') {
        throw new Error(`No geocoding results found for address: ${input.address}`);
      }
      throw new Error(
        `Google Geocoding API error: ${parsed.status}${parsed.error_message ? ` - ${parsed.error_message}` : ''}`
      );
    }

    if (parsed.results.length === 0) {
      throw new Error(`No geocoding results found for address: ${input.address}`);
    }

    const result = parsed.results[0];
    const countryCode = this.getCountryCode(result.address_components);

    if (countryCode !== 'US') {
      throw new Error(
        `Address is not in the US: ${input.address} (found: ${countryCode || 'unknown'})`
      );
    }

    // Calculate confidence based on location_type
    let confidence = 1;
    if (result.geometry.location_type === 'ROOFTOP') {
      confidence = 1;
    } else if (result.geometry.location_type === 'RANGE_INTERPOLATED') {
      confidence = 0.9;
    } else if (result.geometry.location_type === 'GEOMETRIC_CENTER') {
      confidence = 0.7;
    } else if (result.geometry.location_type === 'APPROXIMATE') {
      confidence = 0.5;
    }

    const geocoded: GeocodedAddress = {
      address: input.address,
      label: input.label,
      coordinates: {
        lat: result.geometry.location.lat,
        lng: result.geometry.location.lng,
      },
      formattedAddress: result.formatted_address,
      confidence,
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
    const cacheKey = { provider: 'google', type: 'reverse', ...coordinates };
    const cached = await cacheStore.get<GeocodedAddress>('geocode', cacheKey);
    if (cached) {
      return { ...cached, label };
    }

    await this.rateLimit();

    const url = new URL(`${config.google.geocodingBaseUrl}/json`);
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('latlng', `${coordinates.lat},${coordinates.lng}`);
    url.searchParams.set('result_type', 'street_address|route|locality');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(config.google.requestTimeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Reverse Geocoding API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const parsed = GoogleGeocodeResponseSchema.parse(data);

    if (parsed.status !== 'OK') {
      if (parsed.status === 'ZERO_RESULTS') {
        throw new Error(
          `No address found for coordinates: ${coordinates.lat}, ${coordinates.lng}`
        );
      }
      throw new Error(
        `Google Reverse Geocoding API error: ${parsed.status}${parsed.error_message ? ` - ${parsed.error_message}` : ''}`
      );
    }

    if (parsed.results.length === 0) {
      throw new Error(
        `No address found for coordinates: ${coordinates.lat}, ${coordinates.lng}`
      );
    }

    const result = parsed.results[0];
    const countryCode = this.getCountryCode(result.address_components);

    if (countryCode !== 'US') {
      throw new Error(`Location is not in the US (found: ${countryCode || 'unknown'})`);
    }

    const geocoded: GeocodedAddress = {
      address: result.formatted_address,
      label,
      coordinates,
      formattedAddress: result.formatted_address,
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

    // Use Places Autocomplete API
    const url = new URL(`${config.google.placesBaseUrl}/autocomplete/json`);
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('input', query);
    url.searchParams.set('components', 'country:us');
    url.searchParams.set('types', 'geocode|establishment');

    if (center) {
      url.searchParams.set('location', `${center.lat},${center.lng}`);
      url.searchParams.set('radius', '50000'); // 50km radius bias
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(config.google.requestTimeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google Places Autocomplete API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const parsed = GooglePlacesAutocompleteResponseSchema.parse(data);

    if (parsed.status !== 'OK' && parsed.status !== 'ZERO_RESULTS') {
      throw new Error(
        `Google Places Autocomplete API error: ${parsed.status}${parsed.error_message ? ` - ${parsed.error_message}` : ''}`
      );
    }

    // Limit results
    const predictions = parsed.predictions.slice(0, limit);

    // Get details for each prediction to get coordinates
    const results: LocationSearchResult[] = [];

    for (const prediction of predictions) {
      try {
        await this.rateLimit();

        const detailsUrl = new URL(`${config.google.placesBaseUrl}/details/json`);
        detailsUrl.searchParams.set('key', this.apiKey);
        detailsUrl.searchParams.set('place_id', prediction.place_id);
        detailsUrl.searchParams.set('fields', 'place_id,name,formatted_address,geometry');

        const detailsResponse = await fetch(detailsUrl.toString(), {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(config.google.requestTimeoutMs),
        });

        if (!detailsResponse.ok) {
          continue;
        }

        const detailsData = await detailsResponse.json();
        const detailsParsed = GooglePlaceDetailsResponseSchema.parse(detailsData);

        if (detailsParsed.status === 'OK' && detailsParsed.result) {
          const details = detailsParsed.result;
          results.push({
            id: details.place_id,
            name: prediction.structured_formatting?.main_text || details.name || prediction.description,
            address: details.formatted_address,
            coordinates: {
              lat: details.geometry.location.lat,
              lng: details.geometry.location.lng,
            },
            type: prediction.types?.[0] || 'place',
          });
        }
      } catch {
        // Skip this result if we can't get details
        continue;
      }
    }

    return results;
  }
}
