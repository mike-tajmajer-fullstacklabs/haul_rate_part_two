# Traffic Estimation Methodology

This document explains how the Traffic Density Forecasting POC estimates and uses traffic data to optimize delivery order.

## Overview

The application supports multiple routing providers for traffic-aware travel time estimates:
- **TomTom Routing API** - Primary provider
- **HERE Routing API** - Alternative provider

Both providers return predicted travel times based on historical traffic patterns when you specify a future departure time. The provider can be selected in the UI before running an optimization.

## Supported Routing Providers

### TomTom
- Website: https://developer.tomtom.com/
- Free tier: 2,500 requests/day
- Provides: Routing, geocoding, traffic, search

### HERE
- Website: https://developer.here.com/
- Free tier: 250,000 transactions/month (~8,300/day)
- Provides: Routing, geocoding, traffic, search

Both providers offer similar capabilities for this POC. You can configure one or both by setting the respective API keys in `.env`.

## Data Source: Routing APIs

### TomTom API Endpoint
```
GET /routing/1/calculateRoute/{origin}:{destination}/json
```

### HERE API Endpoint
```
GET /v8/routes
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

### Two-Phase Computation: Why Routes Are Recalculated

The optimization uses a **two-phase approach** because traffic density varies by time of day:

#### Phase 1: Initial Sorting (All at First Departure Time)

All routes are calculated assuming departure at the user-specified first departure time. This provides a baseline for sorting:

```
All targets calculated at 8:00 AM departure:
  Target A: density 1.65
  Target B: density 1.12
  Target C: density 1.38

Sorted order: B, C, A (lowest density first)
```

#### Phase 2: Recalculation with Actual Departure Times

After sorting, each route is **recalculated using the actual departure time** for that delivery. This is critical because:

1. **Traffic patterns change throughout the day**: A route with density 1.65 at 8:00 AM might have density 1.25 at 10:15 AM
2. **Return trips happen at different times**: The return leg departs after unloading, which could be during different traffic conditions
3. **Cumulative timing matters**: Each delivery's return time becomes the next delivery's departure time

```
Phase 2 recalculation:
  Delivery 1 (Target B): Depart 8:00 AM → recalculate route → return 9:00 AM
  Delivery 2 (Target C): Depart 9:00 AM → recalculate route → return 10:15 AM
  Delivery 3 (Target A): Depart 10:15 AM → recalculate route → return 11:30 AM
```

**Why not just use Phase 1 results?**

The Phase 1 calculation assumes all deliveries depart at 8:00 AM, which is physically impossible for sequential deliveries. Phase 2 provides accurate timing and traffic predictions for when each delivery actually occurs.

**Example of density change due to recalculation:**

| Target | Phase 1 (8:00 AM) | Phase 2 (Actual Time) | Change |
|--------|-------------------|----------------------|--------|
| B | 1.12 | 1.12 (8:00 AM) | Same |
| C | 1.38 | 1.28 (9:00 AM) | Improved |
| A | 1.65 | 1.22 (10:15 AM) | Significantly improved |

In this example, Target A benefits most from being pushed later—its density drops from 1.65 to 1.22 because 10:15 AM is past the morning rush hour.

### Why This Works

- **Rush hour avoidance**: High-density routes pushed past peak congestion windows
- **Time shifting**: Later departures may encounter different (often better) traffic conditions
- **Round-trip awareness**: Both outbound and return traffic impact is considered
- **Accurate predictions**: Phase 2 recalculation ensures traffic estimates match actual departure times
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

### HERE API Pricing

| Tier | Allowance | Cost |
|------|-----------|------|
| Free | 250,000 transactions/month (~8,300/day) | $0 |
| Paid | Per 1,000 transactions | ~$0.49-1.00 |

**Note**: HERE's free tier is significantly more generous than TomTom's, making it a good choice for development and light production use.

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

### Typical Solution Example: 5 Delivery Targets

Here's a detailed breakdown of API calls for a typical optimization with **1 depot and 5 delivery targets**, starting at 8:00 AM with 15-minute unloading time per stop:

#### Phase 1: Geocoding (6 calls)

| Call # | Operation | Input | Cached? |
|--------|-----------|-------|---------|
| 1 | Geocode depot | "123 Main St, Los Angeles, CA" | No (first run) |
| 2 | Geocode target 1 | "456 Oak Ave, Pasadena, CA" | No |
| 3 | Geocode target 2 | "789 Pine St, Glendale, CA" | No |
| 4 | Geocode target 3 | "321 Elm Dr, Burbank, CA" | No |
| 5 | Geocode target 4 | "654 Cedar Ln, Santa Monica, CA" | No |
| 6 | Geocode target 5 | "987 Maple Rd, Long Beach, CA" | No |

#### Phase 2: Initial Round-Trip Routes for Sorting (10 calls)

All calculated at 8:00 AM departure to determine sort order:

| Call # | Operation | Route | Result |
|--------|-----------|-------|--------|
| 7 | Route | Depot → Target 1 | Density: 1.45 |
| 8 | Route | Target 1 → Depot | Density: 1.38 |
| 9 | Route | Depot → Target 2 | Density: 1.12 |
| 10 | Route | Target 2 → Depot | Density: 1.18 |
| 11 | Route | Depot → Target 3 | Density: 1.55 |
| 12 | Route | Target 3 → Depot | Density: 1.62 |
| 13 | Route | Depot → Target 4 | Density: 1.28 |
| 14 | Route | Target 4 → Depot | Density: 1.35 |
| 15 | Route | Depot → Target 5 | Density: 1.72 |
| 16 | Route | Target 5 → Depot | Density: 1.68 |

**Round-trip densities calculated:**
- Target 1: (1.45 + 1.38) / 2 = 1.42
- Target 2: (1.12 + 1.18) / 2 = **1.15** ← Lowest, deliver first
- Target 3: (1.55 + 1.62) / 2 = 1.59
- Target 4: (1.28 + 1.35) / 2 = **1.32** ← Second
- Target 5: (1.72 + 1.68) / 2 = 1.70 ← Highest, deliver last

**Sorted order:** Target 2 → Target 4 → Target 1 → Target 3 → Target 5

#### Phase 3: Recalculate Routes with Actual Departure Times (10 calls)

| Call # | Delivery | Depart | Operation | Notes |
|--------|----------|--------|-----------|-------|
| 17 | 1st (Target 2) | 8:00 AM | Depot → Target 2 | Same as Phase 2 |
| 18 | 1st (Target 2) | 8:25 AM | Target 2 → Depot | After 25 min travel + 15 min unload |
| 19 | 2nd (Target 4) | 9:05 AM | Depot → Target 4 | After return from Target 2 |
| 20 | 2nd (Target 4) | 9:45 AM | Target 4 → Depot | Different traffic than 8 AM |
| 21 | 3rd (Target 1) | 10:30 AM | Depot → Target 1 | Post-rush hour |
| 22 | 3rd (Target 1) | 11:00 AM | Target 1 → Depot | Midday traffic |
| 23 | 4th (Target 3) | 11:40 AM | Depot → Target 3 | Midday traffic |
| 24 | 4th (Target 3) | 12:15 PM | Target 3 → Depot | Lunch hour |
| 25 | 5th (Target 5) | 12:55 PM | Depot → Target 5 | Early afternoon |
| 26 | 5th (Target 5) | 1:40 PM | Target 5 → Depot | Afternoon traffic |

#### Summary

| Phase | API Calls | Purpose |
|-------|-----------|---------|
| Geocoding | 6 | Convert addresses to coordinates |
| Initial routes | 10 | Calculate round-trip density for sorting |
| Recalculated routes | 10 | Accurate timing with actual departures |
| **Total** | **26** | Complete optimization |

**Cost per provider (26 calls):**
- **TomTom**: 26 × $0.00075 = **$0.020** (or free within 2,500/day limit)
- **HERE**: 26 × $0.00049 = **$0.013** (or free within ~8,300/day limit)

**With caching on subsequent runs:**
- Geocoding: 0 calls (cached)
- Routes with same times: 0 calls (cached)
- **Re-run cost: $0** if inputs unchanged

### Example Cost Calculations

#### TomTom Costs

| Scenario | Targets | API Calls (1+5N) | Free Tier Runs/Day | Paid Cost/Run |
|----------|---------|------------------|-------------------|---------------|
| Small batch | 5 | ~26 | 96/day | $0.020 |
| Medium batch | 10 | ~51 | 49/day | $0.038 |
| Large batch | 20 | ~101 | 24/day | $0.076 |
| Max batch | 50 | ~251 | 9/day | $0.188 |

*TomTom pricing: ~$0.75 per 1,000 requests. Free tier: 2,500 requests/day.*

#### HERE Costs

| Scenario | Targets | API Calls (1+5N) | Free Tier Runs/Day | Paid Cost/Run |
|----------|---------|------------------|-------------------|---------------|
| Small batch | 5 | ~26 | 319/day | $0.013 |
| Medium batch | 10 | ~51 | 162/day | $0.025 |
| Large batch | 20 | ~101 | 82/day | $0.049 |
| Max batch | 50 | ~251 | 33/day | $0.123 |

*HERE pricing: ~$0.49 per 1,000 transactions. Free tier: 250,000/month (~8,300/day).*

#### Provider Comparison

| Scenario | TomTom Cost | HERE Cost | HERE Savings |
|----------|-------------|-----------|--------------|
| Small batch (5) | $0.020 | $0.013 | 35% |
| Medium batch (10) | $0.038 | $0.025 | 34% |
| Large batch (20) | $0.076 | $0.049 | 36% |
| Max batch (50) | $0.188 | $0.123 | 35% |

**Recommendation**: HERE offers ~35% lower per-request costs and a significantly larger free tier (250,000/month vs 2,500/day), making it more cost-effective for most use cases.

### Cost Reduction with Caching

Caching significantly reduces costs for repeated operations:

- **Same addresses**: Geocoding cached for 24 hours
- **Same routes + times**: Route calculations cached
- **Re-running optimization**: Only new/changed data fetched

**Typical savings**: 50-80% reduction after initial optimization run

### Monthly Cost Projections

#### TomTom Monthly Costs

| Usage Level | Optimizations/Day | Targets/Opt | API Calls/Day | Monthly Cost |
|-------------|-------------------|-------------|---------------|--------------|
| Light | 10 | 10 | ~510 | Free tier sufficient |
| Moderate | 50 | 10 | ~2,550 | ~$38 |
| Heavy | 200 | 15 | ~15,200 | ~$342 |

*TomTom free tier: 2,500 requests/day*

#### HERE Monthly Costs

| Usage Level | Optimizations/Day | Targets/Opt | API Calls/Day | Monthly Cost |
|-------------|-------------------|-------------|---------------|--------------|
| Light | 10 | 10 | ~510 | Free tier sufficient |
| Moderate | 50 | 10 | ~2,550 | Free tier sufficient |
| Heavy | 200 | 15 | ~15,200 | ~$102 |

*HERE free tier: ~8,300 requests/day (250,000/month)*

#### Monthly Cost Comparison

| Usage Level | TomTom | HERE | Savings with HERE |
|-------------|--------|------|-------------------|
| Light (10/day) | $0 | $0 | - |
| Moderate (50/day) | ~$38 | $0 | 100% (free tier) |
| Heavy (200/day) | ~$342 | ~$102 | 70% |

### Cost Optimization Tips

1. **Use HERE for cost savings**: HERE offers lower per-request costs and a larger free tier
2. **Enable caching**: Reduces repeat API calls
3. **Batch similar deliveries**: Run optimization once for the day
4. **Reuse depot addresses**: Cached geocoding saves calls
5. **Avoid unnecessary re-runs**: Only re-optimize when inputs change

## References

### TomTom
- [TomTom Routing API Documentation](https://developer.tomtom.com/routing-api/documentation/routing/calculate-route)
- [TomTom Traffic Flow](https://developer.tomtom.com/traffic-api/documentation/traffic-flow/raster-flow-tiles)
- [TomTom Pricing](https://developer.tomtom.com/store/maps-api)

### HERE
- [HERE Routing API Documentation](https://developer.here.com/documentation/routing-api/dev_guide/index.html)
- [HERE Geocoding & Search](https://developer.here.com/documentation/geocoding-search-api/dev_guide/index.html)
- [HERE Pricing](https://www.here.com/platform/pricing)
