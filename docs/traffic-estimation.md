# Traffic Estimation Methodology

This document explains how the Traffic Density Forecasting POC estimates and uses traffic data to optimize delivery order.

## Overview

The application uses the **TomTom Routing API** to obtain traffic-aware travel time estimates. By specifying a future departure time, TomTom returns predicted travel times based on historical traffic patterns for that time of day and day of week.

## Data Source: TomTom Routing API

### API Endpoint
```
GET /routing/1/calculateRoute/{origin}:{destination}/json
```

### Key Parameters

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `traffic` | `true` | Enable traffic-aware routing |
| `departAt` | ISO 8601 timestamp | Specify departure time for prediction |
| `computeTravelTimeFor` | `all` | Return both traffic and no-traffic times |
| `routeType` | `fastest` | Optimize for shortest travel time |

### Response Data Used

The API returns a route summary containing:

```json
{
  "summary": {
    "travelTimeInSeconds": 1847,
    "noTrafficTravelTimeInSeconds": 1200,
    "trafficDelayInSeconds": 647,
    "departureTime": "2024-01-15T08:00:00",
    "arrivalTime": "2024-01-15T08:30:47"
  }
}
```

## Traffic Density Metric

### Definition

**Traffic Density** is the ratio of actual (traffic-affected) travel time to free-flow (no traffic) travel time:

```
Traffic Density = travelTimeInSeconds / noTrafficTravelTimeInSeconds
```

### Interpretation

| Density Value | Meaning | Traffic Level |
|---------------|---------|---------------|
| 1.00 | Travel time equals free-flow time | No traffic (free flow) |
| 1.10 | 10% longer than free-flow | Light traffic |
| 1.30 | 30% longer than free-flow | Moderate traffic |
| 1.50 | 50% longer than free-flow | Heavy traffic |
| 2.00+ | Double or more the free-flow time | Severe congestion |

### Example Calculation

For a route with:
- `travelTimeInSeconds`: 1847 (30 min 47 sec)
- `noTrafficTravelTimeInSeconds`: 1200 (20 min)

```
Traffic Density = 1847 / 1200 = 1.539
```

This indicates **heavy traffic** with ~54% delay compared to free-flow conditions.

## Predictive Traffic (departAt Parameter)

### How It Works

When you specify a future `departAt` time, TomTom uses:

1. **Historical Traffic Patterns**: Aggregated data from millions of connected devices showing typical traffic conditions for that time slot
2. **Day Type Awareness**: Different patterns for weekdays vs weekends
3. **Seasonal Adjustments**: Accounts for time-of-year variations

### Prediction Accuracy

- **Same day**: High accuracy (uses current conditions + historical patterns)
- **1-7 days ahead**: Good accuracy (based on historical patterns for that day/time)
- **Further ahead**: Moderate accuracy (relies entirely on historical averages)

### Limitations

- Does not predict unusual events (accidents, construction, special events)
- Based on historical patterns which may not reflect recent changes
- Weather impacts are not included in predictions

## Routing Model: Hub-and-Spoke Round Trips

This application uses a **hub-and-spoke** model where:
- The depot is the central hub
- Each delivery is a complete **round trip**: depot → target → depot
- The driver returns to the depot after each delivery before starting the next

This differs from a traveling salesman approach (depot → A → B → C → depot) and is appropriate for scenarios where:
- Vehicles need to reload at the depot between deliveries
- Deliveries are dispatched individually (e.g., dump trucks, dedicated vehicles)
- Scheduling flexibility is needed for each delivery

## Round-Trip Traffic Density

### Calculation

For each delivery target, we calculate traffic density for both legs:

```
Outbound Density = outbound travelTime / outbound noTrafficTravelTime
Return Density = return travelTime / return noTrafficTravelTime

Round-Trip Density = (Outbound Density + Return Density) / 2
```

### Why Average Both Legs?

Traffic conditions often differ significantly between outbound and return trips:
- **Morning rush**: Outbound to suburbs may be light, return to city may be heavy
- **Evening rush**: Opposite pattern
- **Directional routes**: Highways often have asymmetric traffic patterns

By averaging both directions, we capture the **total traffic impact** of the complete round trip.

### Example

| Leg | Travel Time | No-Traffic Time | Density |
|-----|-------------|-----------------|---------|
| Depot → Target | 45 min | 30 min | 1.50 |
| Target → Depot | 35 min | 30 min | 1.17 |
| **Round Trip** | 80 min | 60 min | **1.34** (avg) |

## Optimization Algorithm

### Objective

Minimize cumulative round-trip traffic density across all deliveries to reduce total delay time.

### Process

1. **Geocode Addresses**: Convert depot and target addresses to coordinates

2. **Calculate Initial Round-Trip Routes**: For each target at the first departure time:
   - Calculate outbound route (depot → target)
   - Estimate return departure (arrival + unloading duration)
   - Calculate return route (target → depot)
   - Compute round-trip traffic density (average of both legs)

3. **Sort by Round-Trip Density**: Order targets from lowest to highest round-trip density
   - Delivers to low-traffic round trips first
   - Pushes high-traffic round trips to potentially better times

4. **Recalculate with Actual Timing**: For each delivery in sorted order:
   - Calculate outbound route at actual departure time
   - Calculate return route at estimated return departure time
   - Update next departure = return arrival time
   - Update cumulative metrics (distance, time, density)

5. **Return Optimized Plan**: Ordered list with:
   - Outbound and return routes for each delivery
   - Departure, arrival, and return times
   - Round-trip density for each delivery
   - Total and average metrics across all deliveries

### Sorting Logic Explained

**Why sort by lowest density first?**

1. **Early slots are fixed**: The first departure time is set by the user and cannot be shifted
2. **Low-density routes are time-insensitive**: Routes with little traffic impact can be done anytime
3. **High-density routes may improve**: By pushing congested routes later, they may encounter:
   - Post-rush-hour conditions (if starting during rush hour)
   - Midday lull between morning and evening peaks
   - Different traffic patterns at different times

**Example scenario** (8:00 AM start, 3 deliveries):

| Target | Round-Trip Density at 8 AM | Sorted Order |
|--------|---------------------------|--------------|
| A | 1.65 (heavy) | 3rd |
| B | 1.12 (light) | 1st |
| C | 1.38 (moderate) | 2nd |

Execution order: B → C → A

- **B** (8:00 AM): Light traffic, done quickly, return ~9:00 AM
- **C** (9:00 AM): Moderate traffic, return ~10:15 AM
- **A** (10:15 AM): Originally heavy at 8 AM, but 10 AM may be post-rush with better conditions

### Why This Works

- **Rush hour avoidance**: High-density routes pushed past peak congestion windows
- **Time shifting**: Later departures may encounter different (often better) traffic conditions
- **Round-trip awareness**: Both outbound and return traffic impact is considered
- **Cumulative benefit**: Small improvements per route compound across multiple deliveries

## Day Type Classification

Traffic patterns vary significantly by day type:

| Day Type | Characteristics |
|----------|-----------------|
| **Weekday** | Morning rush (7-9 AM), evening rush (4-7 PM), lower midday |
| **Weekend** | Later morning peak, more consistent throughout day |
| **Holiday** | Similar to weekend, often lighter overall |

The application detects day type using:
- US Federal holidays (fixed and floating dates)
- User-defined custom holidays
- Standard weekend detection (Saturday/Sunday)

## Caching Strategy

To reduce API costs and improve performance:

- **Geocoding results**: Cached for 24 hours (addresses rarely change)
- **Route calculations**: Cached by origin + destination + departure time
- **Cache key includes time**: Different departure times = different cache entries

This means:
- Repeated optimizations with same inputs are fast
- Changing departure time triggers new API calls
- Adding/removing targets only fetches data for changed routes

## Accuracy Considerations

### Factors Affecting Accuracy

1. **Time of prediction**: Further ahead = less accurate
2. **Route familiarity**: Well-traveled routes have better historical data
3. **Day type**: Holidays/special days may deviate from patterns
4. **Location**: Urban areas have more data than rural

### Recommendations for Best Results

- Run optimization closer to actual departure date
- Verify results for critical deliveries
- Consider re-running if conditions change significantly
- Use as guidance, not absolute truth

## Cost Estimate

### TomTom API Pricing

| Tier | Allowance | Cost |
|------|-----------|------|
| Free | 2,500 requests/day | $0 |
| Paid | Per 1,000 requests | ~$0.50-0.75 |

### API Calls Per Optimization

For an optimization with **N delivery targets** (hub-and-spoke round-trip model):

| Operation | API Calls | Notes |
|-----------|-----------|-------|
| Geocode depot | 1 | Cached after first use |
| Geocode targets | N | Cached after first use |
| Initial outbound routes (depot→target) | N | For initial sorting |
| Initial return routes (target→depot) | N | For round-trip density calculation |
| Recalculated outbound routes | N | With actual departure times |
| Recalculated return routes | N | With actual return departure times |

**Total per optimization**: ~1 + N + N + N + N + N = **1 + 5N calls** (worst case, no cache)

### Example Cost Calculations

| Scenario | Targets | API Calls (1+5N) | Free Tier Runs/Day | Paid Cost |
|----------|---------|------------------|-------------------|-----------|
| Small batch | 5 | ~26 | 96/day | $0.020 |
| Medium batch | 10 | ~51 | 49/day | $0.038 |
| Large batch | 20 | ~101 | 24/day | $0.076 |
| Max batch | 50 | ~251 | 9/day | $0.188 |

### Cost Reduction with Caching

Caching significantly reduces costs for repeated operations:

- **Same addresses**: Geocoding cached for 24 hours
- **Same routes + times**: Route calculations cached
- **Re-running optimization**: Only new/changed data fetched

**Typical savings**: 50-80% reduction after initial optimization run

### Monthly Cost Projections

| Usage Level | Optimizations/Day | Targets/Opt | Monthly Cost |
|-------------|-------------------|-------------|--------------|
| Light | 10 | 10 | Free tier sufficient |
| Moderate | 50 | 10 | ~$30-50 |
| Heavy | 200 | 15 | ~$200-300 |

### Cost Optimization Tips

1. **Enable caching**: Reduces repeat API calls
2. **Batch similar deliveries**: Run optimization once for the day
3. **Reuse depot addresses**: Cached geocoding saves calls
4. **Avoid unnecessary re-runs**: Only re-optimize when inputs change

## References

- [TomTom Routing API Documentation](https://developer.tomtom.com/routing-api/documentation/routing/calculate-route)
- [TomTom Traffic Flow](https://developer.tomtom.com/traffic-api/documentation/traffic-flow/raster-flow-tiles)
- [TomTom Pricing](https://developer.tomtom.com/store/maps-api)
