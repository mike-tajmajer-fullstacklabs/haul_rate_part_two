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
  /**
   * Calculate round-trip route for a target at a given departure time
   */
  private async calculateRoundTrip(
    provider: IRoutingProvider,
    depotGeocoded: GeocodedAddress,
    target: GeocodedAddress,
    departureTime: string,
    deliveryDurationMinutes: number,
    googleTrafficModel?: GoogleTrafficModel
  ): Promise<RoundTripRoute> {
    // Calculate outbound route (depot → target)
    const outboundRoute = await provider.calculateRoute({
      origin: depotGeocoded,
      destination: target,
      departureTime,
      googleTrafficModel,
    });

    // Calculate return departure time (arrival + unloading)
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

    return {
      target,
      outboundRoute,
      returnRoute,
      roundTripTrafficDensity: Math.round(roundTripTrafficDensity * 1000) / 1000,
    };
  }

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

    const deliveries: OptimizedDelivery[] = [];
    let currentDepartureTime = new Date(firstDepartureTime);

    if (sortByTrafficDensity) {
      // Greedy re-optimization: recalculate all remaining routes after each selection
      // This produces better results because traffic conditions change throughout the day
      const remainingTargets = [...targetAddresses];

      while (remainingTargets.length > 0) {
        // Calculate routes for all remaining targets at current departure time
        const candidates: RoundTripRoute[] = [];
        for (const target of remainingTargets) {
          const roundTrip = await this.calculateRoundTrip(
            provider,
            depotGeocoded,
            target,
            currentDepartureTime.toISOString(),
            deliveryDurationMinutes,
            googleTrafficModel
          );
          candidates.push(roundTrip);
        }

        // Select the candidate with shortest round-trip travel time
        // This favors time savings over density - completing faster deliveries first
        // gets the driver back to the depot sooner for subsequent deliveries
        candidates.sort((a, b) => {
          const aTotalTime = a.outboundRoute.travelTimeSeconds + a.returnRoute.travelTimeSeconds;
          const bTotalTime = b.outboundRoute.travelTimeSeconds + b.returnRoute.travelTimeSeconds;
          return aTotalTime - bTotalTime;
        });
        const selected = candidates[0];

        // Remove selected target from remaining
        const selectedIndex = remainingTargets.findIndex(
          (t) => t.address === selected.target.address
        );
        remainingTargets.splice(selectedIndex, 1);

        // Build the delivery record
        const departureTime = new Date(currentDepartureTime);
        const arrivalTime = new Date(selected.outboundRoute.arrivalTime);
        const returnTime = new Date(selected.returnRoute.arrivalTime);

        const deliveryTarget: DeliveryTarget = {
          address: selected.target,
          deliveryDurationMinutes,
        };

        const optimizedDelivery: OptimizedDelivery = {
          order: deliveries.length + 1,
          target: deliveryTarget,
          route: selected.outboundRoute,
          returnRoute: selected.returnRoute,
          roundTripTrafficDensity: selected.roundTripTrafficDensity,
          estimatedDepartureTime: departureTime.toISOString(),
          estimatedArrivalTime: arrivalTime.toISOString(),
          estimatedReturnTime: returnTime.toISOString(),
        };

        deliveries.push(optimizedDelivery);

        // Update departure time for next iteration
        currentDepartureTime = returnTime;
      }
    } else {
      // No optimization: process targets in original order
      for (let i = 0; i < targetAddresses.length; i++) {
        const target = targetAddresses[i];

        const roundTrip = await this.calculateRoundTrip(
          provider,
          depotGeocoded,
          target,
          currentDepartureTime.toISOString(),
          deliveryDurationMinutes,
          googleTrafficModel
        );

        const departureTime = new Date(currentDepartureTime);
        const arrivalTime = new Date(roundTrip.outboundRoute.arrivalTime);
        const returnTime = new Date(roundTrip.returnRoute.arrivalTime);

        const deliveryTarget: DeliveryTarget = {
          address: target,
          deliveryDurationMinutes,
        };

        const optimizedDelivery: OptimizedDelivery = {
          order: i + 1,
          target: deliveryTarget,
          route: roundTrip.outboundRoute,
          returnRoute: roundTrip.returnRoute,
          roundTripTrafficDensity: roundTrip.roundTripTrafficDensity,
          estimatedDepartureTime: departureTime.toISOString(),
          estimatedArrivalTime: arrivalTime.toISOString(),
          estimatedReturnTime: returnTime.toISOString(),
        };

        deliveries.push(optimizedDelivery);

        // Update departure time for next delivery
        currentDepartureTime = returnTime;
      }
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
    // Clamp to minimum 1.0 because Google's baseline is historical average (not free-flow),
    // which can result in values < 1.0 when conditions are better than typical
    const rawAverageTrafficDensity =
      totalNoTrafficTravelTimeSeconds > 0
        ? totalTravelTimeSeconds / totalNoTrafficTravelTimeSeconds
        : 1;
    const averageTrafficDensity = Math.max(1.0, rawAverageTrafficDensity);

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
