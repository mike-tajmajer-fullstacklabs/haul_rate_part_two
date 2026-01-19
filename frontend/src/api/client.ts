const API_BASE = '/api/delivery';

export type RoutingProvider = 'tomtom' | 'here';

export interface AddressInput {
  address: string;
  label?: string;
}

export interface OptimizeRequest {
  depot: AddressInput;
  targets: AddressInput[];
  firstDepartureTime: string;
  deliveryDurationMinutes?: number;
  provider?: RoutingProvider;
}

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface GeocodedAddress {
  address: string;
  label?: string;
  coordinates: Coordinates;
  formattedAddress: string;
  confidence: number;
}

export interface RouteSegment {
  id: string;
  origin: GeocodedAddress;
  destination: GeocodedAddress;
  distanceMeters: number;
  travelTimeSeconds: number;
  noTrafficTravelTimeSeconds: number;
  trafficDensity: number;
  departureTime: string;
  arrivalTime: string;
}

export interface DeliveryTarget {
  address: GeocodedAddress;
  deliveryDurationMinutes: number;
}

export interface OptimizedDelivery {
  order: number;
  target: DeliveryTarget;
  route: RouteSegment;
  returnRoute: RouteSegment;
  roundTripTrafficDensity: number;
  estimatedDepartureTime: string;
  estimatedArrivalTime: string;
  estimatedReturnTime: string;
}

export interface DeliveryPlan {
  id: string;
  createdAt: string;
  provider: RoutingProvider;
  depot: GeocodedAddress;
  firstDepartureTime: string;
  dayType: 'weekday' | 'weekend' | 'holiday';
  deliveries: OptimizedDelivery[];
  totalDistanceMeters: number;
  totalTravelTimeSeconds: number;
  totalNoTrafficTravelTimeSeconds: number;
  cumulativeTrafficDensity: number;
  averageTrafficDensity: number;
}

export interface PlanSummary {
  id: string;
  createdAt: string;
  depot: string;
  targetCount: number;
  firstDepartureTime: string;
  dayType: string;
  averageTrafficDensity: number;
}

export interface ApiResponse {
  success: boolean;
  error?: string;
  details?: unknown;
}

export interface OptimizeResponse extends ApiResponse {
  plan?: DeliveryPlan;
}

export interface PlansListResponse extends ApiResponse {
  plans?: PlanSummary[];
}

export interface PlanResponse extends ApiResponse {
  plan?: DeliveryPlan;
}

export interface DayTypeResponse extends ApiResponse {
  date?: string;
  dayType?: 'weekday' | 'weekend' | 'holiday';
  holidayName?: string;
}

export interface Holiday {
  date: string;
  name: string;
  type: 'federal' | 'user';
}

export interface HolidaysResponse extends ApiResponse {
  year?: number;
  holidays?: Holiday[];
}

export interface LocationSearchResult {
  id: string;
  name: string;
  address: string;
  coordinates: Coordinates;
  type: string;
}

export interface ReverseGeocodeResponse extends ApiResponse {
  address?: GeocodedAddress;
}

export interface SearchLocationsResponse extends ApiResponse {
  results?: LocationSearchResult[];
}

export interface ProvidersResponse extends ApiResponse {
  providers?: RoutingProvider[];
  default?: RoutingProvider;
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }

  return data;
}

export const api = {
  async optimize(request: OptimizeRequest): Promise<OptimizeResponse> {
    return fetchJson<OptimizeResponse>(`${API_BASE}/optimize`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },

  async listPlans(): Promise<PlansListResponse> {
    return fetchJson<PlansListResponse>(`${API_BASE}/plans`);
  },

  async getPlan(id: string): Promise<PlanResponse> {
    return fetchJson<PlanResponse>(`${API_BASE}/plans/${id}`);
  },

  async deletePlan(id: string): Promise<ApiResponse> {
    return fetchJson<ApiResponse>(`${API_BASE}/plans/${id}`, {
      method: 'DELETE',
    });
  },

  async getDayType(date: string): Promise<DayTypeResponse> {
    return fetchJson<DayTypeResponse>(`${API_BASE}/day-type?date=${date}`);
  },

  async getHolidays(year?: number): Promise<HolidaysResponse> {
    const url = year
      ? `${API_BASE}/holidays?year=${year}`
      : `${API_BASE}/holidays`;
    return fetchJson<HolidaysResponse>(url);
  },

  async addHoliday(date: string, name: string): Promise<ApiResponse> {
    return fetchJson<ApiResponse>(`${API_BASE}/holidays`, {
      method: 'POST',
      body: JSON.stringify({ date, name }),
    });
  },

  async removeHoliday(date: string): Promise<ApiResponse> {
    return fetchJson<ApiResponse>(`${API_BASE}/holidays/${date}`, {
      method: 'DELETE',
    });
  },

  async healthCheck(): Promise<ApiResponse> {
    return fetchJson<ApiResponse>(`${API_BASE}/health`);
  },

  async getProviders(): Promise<ProvidersResponse> {
    return fetchJson<ProvidersResponse>(`${API_BASE}/providers`);
  },

  async reverseGeocode(
    coordinates: Coordinates,
    label?: string,
    provider?: RoutingProvider
  ): Promise<ReverseGeocodeResponse> {
    return fetchJson<ReverseGeocodeResponse>(`${API_BASE}/reverse-geocode`, {
      method: 'POST',
      body: JSON.stringify({ ...coordinates, label, provider }),
    });
  },

  async searchLocations(
    query: string,
    center?: Coordinates,
    limit?: number,
    provider?: RoutingProvider
  ): Promise<SearchLocationsResponse> {
    const params = new URLSearchParams({ q: query });
    if (center) {
      params.set('lat', String(center.lat));
      params.set('lng', String(center.lng));
    }
    if (limit) {
      params.set('limit', String(limit));
    }
    if (provider) {
      params.set('provider', provider);
    }
    return fetchJson<SearchLocationsResponse>(
      `${API_BASE}/search-locations?${params.toString()}`
    );
  },
};
