import { GeocodedAddress, RouteSegment, AddressInput, Coordinates } from '../types/index.js';

// Provider types
export type RoutingProviderType = 'tomtom' | 'here';

// Common interfaces for all routing providers
export interface RouteRequest {
  origin: GeocodedAddress;
  destination: GeocodedAddress;
  departureTime: string;
}

export interface LocationSearchResult {
  id: string;
  name: string;
  address: string;
  coordinates: Coordinates;
  type: string;
}

// Abstract routing provider interface
export interface IRoutingProvider {
  readonly name: RoutingProviderType;

  // Routing methods
  calculateRoute(request: RouteRequest): Promise<RouteSegment>;
  calculateMultipleRoutes(requests: RouteRequest[]): Promise<RouteSegment[]>;

  // Geocoding methods
  geocode(input: AddressInput): Promise<GeocodedAddress>;
  geocodeMultiple(inputs: AddressInput[]): Promise<Map<string, GeocodedAddress>>;
  reverseGeocode(coordinates: Coordinates, label?: string): Promise<GeocodedAddress>;
  searchLocations(query: string, center?: Coordinates, limit?: number): Promise<LocationSearchResult[]>;
}

// Provider factory function type
export type ProviderFactory = () => IRoutingProvider;
