import { v4 as uuidv4 } from 'uuid';
import { holidayService } from './holidays.js';
import { providerManager } from './provider-manager.js';
import { config } from '../config.js';
import {
  AddressInput,
  GeocodedAddress,
  DeliveryPlan,
  OptimizedDelivery,
  RouteSegment,
  DeliveryTarget,
  GoogleTrafficModel,
} from '../types/index.js';
import { RoutingProviderType, IRoutingProvider } from './routing-provider.js';

interface OptimizeOptions {
  depot: AddressInput;
  targets: AddressInput[];
  firstDepartureTime: string;
  deliveryDurationMinutes?: number;
  provider?: RoutingProviderType;
  sortByTrafficDensity?: boolean;
  googleTrafficModel?: GoogleTrafficModel;
}

interface RoundTripRoute {
  target: GeocodedAddress;
  outboundRoute: RouteSegment;
  returnRoute: RouteSegment;
  roundTripTrafficDensity: number;
}

export class DeliveryOptimizer {
  async optimize(options: OptimizeOptions): Promise<DeliveryPlan> {
    const {
      depot,
      targets,
      firstDepartureTime,
      deliveryDurationMinutes = config.defaults.deliveryDurationMinutes,
      provider: providerType,
      sortByTrafficDensity = false,
      googleTrafficModel,
    } = options;

    // Get the routing provider
    const provider = providerManager.getProvider(providerType);

    // Step 1: Geocode depot and all targets
    const allAddresses = [depot, ...targets];
    const geocoded = await provider.geocodeMultiple(allAddresses);

    const depotGeocoded = geocoded.get(depot.address);
    if (!depotGeocoded) {
      throw new Error(`Failed to geocode depot address: ${depot.address}`);
    }

    const targetAddresses: GeocodedAddress[] = [];
    for (const target of targets) {
      const geocodedTarget = geocoded.get(target.address);
      if (!geocodedTarget) {
        throw new Error(`Failed to geocode target address: ${target.address}`);
      }
      targetAddresses.push(geocodedTarget);
    }

    // Step 2: Calculate round-trip routes (depot→target and target→depot) at first departure time
    // For initial sorting, estimate return departure as: departure + outbound travel + delivery duration
    const roundTripRoutes: RoundTripRoute[] = [];

    for (const target of targetAddresses) {
      // Calculate outbound route (depot → target)
      const outboundRoute = await provider.calculateRoute({
        origin: depotGeocoded,
        destination: target,
        departureTime: firstDepartureTime,
        googleTrafficModel,
      });

      // Estimate return departure time
      const outboundArrival = new Date(outboundRoute.arrivalTime);
      const returnDepartureTime = new Date(
        outboundArrival.getTime() + deliveryDurationMinutes * 60 * 1000
      );

      // Calculate return route (target → depot)
      const returnRoute = await provider.calculateRoute({
        origin: target,
        destination: depotGeocoded,
        departureTime: returnDepartureTime.toISOString(),
        googleTrafficModel,
      });

      // Calculate round-trip traffic density (average of both legs)
      const roundTripTrafficDensity =
        (outboundRoute.trafficDensity + returnRoute.trafficDensity) / 2;

      roundTripRoutes.push({
        target,
        outboundRoute,
        returnRoute,
        roundTripTrafficDensity: Math.round(roundTripTrafficDensity * 1000) / 1000,
      });
    }

    // Step 3: Optionally sort targets by round-trip traffic density (lowest first)
    if (sortByTrafficDensity) {
      roundTripRoutes.sort((a, b) => a.roundTripTrafficDensity - b.roundTripTrafficDensity);
    }

    // Step 4: Build optimized delivery sequence with recalculated times
    const deliveries: OptimizedDelivery[] = [];
    let currentDepartureTime = new Date(firstDepartureTime);

    for (let i = 0; i < roundTripRoutes.length; i++) {
      const { target } = roundTripRoutes[i];

      // Recalculate outbound route with actual departure time
      const outboundRoute = await provider.calculateRoute({
        origin: depotGeocoded,
        destination: target,
        departureTime: currentDepartureTime.toISOString(),
        googleTrafficModel,
      });

      const departureTime = new Date(currentDepartureTime);
      const arrivalTime = new Date(outboundRoute.arrivalTime);

      // Calculate delivery end time
      const deliveryEndTime = new Date(
        arrivalTime.getTime() + deliveryDurationMinutes * 60 * 1000
      );

      // Recalculate return route with actual departure time
      const returnRoute = await provider.calculateRoute({
        origin: target,
        destination: depotGeocoded,
        departureTime: deliveryEndTime.toISOString(),
        googleTrafficModel,
      });

      const returnTime = new Date(returnRoute.arrivalTime);

      // Calculate actual round-trip traffic density
      const roundTripTrafficDensity =
        (outboundRoute.trafficDensity + returnRoute.trafficDensity) / 2;

      const deliveryTarget: DeliveryTarget = {
        address: target,
        deliveryDurationMinutes,
      };

      const optimizedDelivery: OptimizedDelivery = {
        order: i + 1,
        target: deliveryTarget,
        route: outboundRoute,
        returnRoute: returnRoute,
        roundTripTrafficDensity: Math.round(roundTripTrafficDensity * 1000) / 1000,
        estimatedDepartureTime: departureTime.toISOString(),
        estimatedArrivalTime: arrivalTime.toISOString(),
        estimatedReturnTime: returnTime.toISOString(),
      };

      deliveries.push(optimizedDelivery);

      // Update current departure time for next delivery (after return to depot)
      currentDepartureTime = returnTime;
    }

    // Step 5: Calculate totals (including both outbound and return trips)
    const totalDistanceMeters = deliveries.reduce(
      (sum, d) => sum + d.route.distanceMeters + d.returnRoute.distanceMeters,
      0
    );
    const totalTravelTimeSeconds = deliveries.reduce(
      (sum, d) => sum + d.route.travelTimeSeconds + d.returnRoute.travelTimeSeconds,
      0
    );
    const totalNoTrafficTravelTimeSeconds = deliveries.reduce(
      (sum, d) => sum + d.route.noTrafficTravelTimeSeconds + d.returnRoute.noTrafficTravelTimeSeconds,
      0
    );
    const cumulativeTrafficDensity = deliveries.reduce(
      (sum, d) => sum + d.roundTripTrafficDensity,
      0
    );
    // Average traffic density = total travel time / total free-flow time
    // This is a time-weighted average that reflects the true overall traffic impact
    const averageTrafficDensity =
      totalNoTrafficTravelTimeSeconds > 0
        ? totalTravelTimeSeconds / totalNoTrafficTravelTimeSeconds
        : 1;

    // Determine day type
    const departureDate = new Date(firstDepartureTime);
    const { type: dayType } = await holidayService.getDayType(departureDate);

    const plan: DeliveryPlan = {
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      provider: provider.name,
      depot: depotGeocoded,
      firstDepartureTime,
      dayType,
      deliveries,
      totalDistanceMeters,
      totalTravelTimeSeconds,
      totalNoTrafficTravelTimeSeconds,
      cumulativeTrafficDensity: Math.round(cumulativeTrafficDensity * 1000) / 1000,
      averageTrafficDensity: Math.round(averageTrafficDensity * 1000) / 1000,
    };

    return plan;
  }
}

// Singleton instance
export const deliveryOptimizer = new DeliveryOptimizer();
