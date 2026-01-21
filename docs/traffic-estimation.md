# Traffic Estimation Methodology

This document explains how the Traffic Density Forecasting POC estimates and uses traffic data to optimize delivery order.

## Overview

The application supports multiple routing providers for traffic-aware travel time estimates:
- **TomTom Routing API** - Cost-effective option with good accuracy
- **HERE Routing API** - Generous free tier, good for development
- **Google Maps Platform** - Premium accuracy, higher cost

All providers return predicted travel times based on historical traffic patterns when you specify a future departure time. The provider can be selected in the UI before running an optimization.

## Supported Routing Providers

### TomTom
- Website: https://developer.tomtom.com/
- Free tier: 2,500 requests/day
- Provides: Routing, geocoding, traffic, search

### HERE
- Website: https://developer.here.com/
- Free tier: 250,000 transactions/month (~8,300/day)
- Provides: Routing, geocoding, traffic, search

### Google Maps Platform
- Website: https://console.cloud.google.com/google/maps-apis
- Free tier: $200/month credit (~40,000 direction requests)
- Provides: Directions (routing), geocoding, Places (search/autocomplete)
- Note: Generally considered the most accurate, but significantly more expensive

All three providers offer similar capabilities for this POC. You can configure one or more by setting the respective API keys in `.env`.

## Data Source: Routing APIs

### TomTom API Endpoint
```
GET /routing/1/calculateRoute/{origin}:{destination}/json
```

### HERE API Endpoint
```
GET /v8/routes
```

### Google Directions API Endpoint
```
GET /maps/api/directions/json
```

### Key Parameters

**TomTom & HERE:**

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `traffic` | `true` | Enable traffic-aware routing |
| `departAt` | ISO 8601 timestamp | Specify departure time for prediction |
| `computeTravelTimeFor` | `all` | Return both traffic and no-traffic times |
| `routeType` | `fastest` | Optimize for shortest travel time |

**Google Directions API:**

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `departure_time` | Unix timestamp | Specify departure time for traffic prediction |
| `traffic_model` | `best_guess` | Use best estimate based on historical data |
| `origin` | lat,lng or address | Starting point |
| `destination` | lat,lng or address | End point |

### Response Data Used

**TomTom/HERE Response:**

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

**Google Directions Response:**

```json
{
  "routes": [{
    "legs": [{
      "duration": {
        "value": 1200,
        "text": "20 mins"
      },
      "duration_in_traffic": {
        "value": 1847,
        "text": "31 mins"
      },
      "distance": {
        "value": 15000,
        "text": "15 km"
      }
    }]
  }]
}
```

### Important: Baseline Time Differences Between Providers

The providers differ in how they define "no traffic" or baseline travel time:

| Provider | Baseline Field | What It Represents |
|----------|---------------|-------------------|
| **TomTom** | `noTrafficTravelTimeInSeconds` | True free-flow time (speed limit conditions) |
| **HERE** | `baseDuration` | True free-flow time (speed limit conditions) |
| **Google** | `duration` | **Historical average** (typical conditions) |

**Why this matters**: Google's `duration` is NOT true free-flow time. It represents travel time under typical historical conditions. This means:

- **TomTom/HERE**: Traffic density is always ≥ 1.0 (you can't drive faster than speed limits)
- **Google**: Traffic density can be < 1.0 when predicted conditions are better than the historical average

**When Google returns density < 1.0**:
- Off-peak hours (late night, early morning) with lighter-than-typical traffic
- Using `traffic_model=optimistic` which returns best-case scenarios
- Predicted conditions simply better than the historical baseline

**How this application handles it**: To maintain consistency across providers, Google traffic density values are **clamped to a minimum of 1.0**. This ensures the density metric has the same meaning regardless of provider: "1.0 = best possible conditions".

### How Departure Time Predictions Work

When you specify a future departure time (`departAt` or `departure_time`), the routing APIs use **historical traffic data** to predict travel times. This section explains the methodology each provider uses.

#### Data Collection Sources

All three providers collect traffic data from similar sources:

| Provider | Primary Data Sources | Scale |
|----------|---------------------|-------|
| **TomTom** | Navigation devices, in-dash systems, mobile apps (Floating Car Data) | 600+ million devices worldwide |
| **HERE** | Connected car probes, mobile devices, fleet vehicles | Trillions of GPS probe points |
| **Google** | Android devices, Google Maps users, Waze, connected vehicles | Billions of data points daily |

This crowdsourced data is anonymized and aggregated to build comprehensive traffic pattern models.

#### Factors Used in Traffic Prediction

The historical data is analyzed and stored with multiple dimensions that influence predictions:

| Factor | How It's Used | Example |
|--------|---------------|---------|
| **Day of Week** | Traffic patterns differ significantly between weekdays | Monday 8 AM vs Saturday 8 AM |
| **Time of Day** | Rush hours, midday lulls, overnight periods | 8 AM (rush) vs 2 PM (lighter) |
| **Time Intervals** | Data stored in 15-60 minute granularity | 8:00-8:15 AM, 8:15-8:30 AM, etc. |
| **Seasonal Patterns** | Summer vs winter, school year vs vacation | July traffic vs September traffic |
| **Holidays** | Special traffic patterns for holidays and events | Christmas Eve, July 4th, etc. |
| **Road Segment** | Each road link has its own historical profile | Highway I-405 vs local street |
| **Direction** | Inbound vs outbound traffic differs | Morning: suburbs→city heavy |

#### Provider-Specific Methodologies

**TomTom:**
- Stores historical averages for every road segment in their map database
- When you use `departAt`, the routing engine looks up the historical speed data for that specific day-of-week and time-of-day
- Can predict travel times for any day up to one year in the future
- Combines historical patterns with any known long-term road closures
- Setting `computeTravelTimeFor=all` returns both historical and no-traffic travel times

**HERE:**
- Maintains 3-year rolling averages of historical observations
- Data granularity: 15-minute intervals for each day of the week
- Includes a "holiday appendix" with guidance for unusual traffic days
- Refreshed regularly to account for seasonal trends and weekday/weekend variations
- For past departure times, only historical data is applied (no real-time)
- For future times, uses historical patterns plus any scheduled road closures
- Setting `departureTime=any` disables traffic consideration entirely ("planning mode")

**Google:**
- Uses machine learning models trained on historical time-of-day and day-of-week patterns
- Offers three prediction models via the `traffic_model` parameter:
  - `best_guess` (default): Combines historical data with live traffic (weighted by how far in the future)
  - `pessimistic`: Returns longer estimates (worst-case historical patterns)
  - `optimistic`: Returns shorter estimates (best-case historical patterns)
- Live traffic data is weighted more heavily for near-future departure times
- For far-future times, relies primarily on historical averages

#### How Day Type Affects Predictions

Traffic patterns fall into distinct categories:

```
┌─────────────────────────────────────────────────────────────────┐
│                    TYPICAL WEEKDAY PATTERN                       │
│                                                                  │
│  Traffic │        ████                          ████             │
│  Density │      ██    ██                      ██    ██           │
│          │    ██        ██                  ██        ██         │
│          │  ██            ████████████████ ██           ██       │
│          │██                                              ██     │
│          └──────────────────────────────────────────────────────│
│            6AM   8AM   10AM  12PM  2PM   4PM   6PM   8PM   10PM  │
│                  ↑ Morning Rush            ↑ Evening Rush        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    TYPICAL WEEKEND PATTERN                       │
│                                                                  │
│  Traffic │                    ████████████                       │
│  Density │                  ██            ██                     │
│          │                ██                ██                   │
│          │              ██                    ██                 │
│          │████████████ ██                       ██████████████   │
│          └──────────────────────────────────────────────────────│
│            6AM   8AM   10AM  12PM  2PM   4PM   6PM   8PM   10PM  │
│                              ↑ Midday Peak                       │
└─────────────────────────────────────────────────────────────────┘
```

| Day Type | Traffic Characteristics | Peak Times |
|----------|------------------------|------------|
| **Weekday (Mon-Fri)** | Bi-modal with morning and evening rush hours | 7-9 AM, 4-7 PM |
| **Weekend (Sat-Sun)** | Single midday peak, later start, more even distribution | 11 AM - 4 PM |
| **Holiday** | Similar to weekend but often lighter overall | Varies by holiday |
| **Holiday Eve** | Can have unusual patterns (early departures) | Often heavy 2-6 PM |
| **Special Events** | Localized spikes near event venues | Event-specific |

#### Data Freshness and Updates

| Provider | Historical Data Refresh | Real-Time Integration |
|----------|------------------------|----------------------|
| **TomTom** | Continuously updated with new observations | Blended with live data for near-future |
| **HERE** | Regular updates, 3-year rolling average | Live traffic for current/near-future |
| **Google** | Continuously updated ML models | Strong live weighting for near-future |

#### Prediction Accuracy by Time Horizon

| Time Until Departure | Data Used | Accuracy Level |
|---------------------|-----------|----------------|
| **0-30 minutes** | Live traffic + historical | Highest (current conditions known) |
| **30 min - 2 hours** | Live trends + historical | Very high |
| **2-24 hours** | Historical patterns | High (same-day patterns reliable) |
| **1-7 days** | Historical day-of-week patterns | Good |
| **1-4 weeks** | Historical patterns + seasonal | Moderate |
| **1+ months** | Historical averages only | Lower (no event awareness) |

#### Limitations of Historical Predictions

The departure time predictions **cannot account for**:

| Factor | Why It's Unpredictable | Impact |
|--------|----------------------|--------|
| **Accidents** | Random, unpredictable events | Can cause severe delays |
| **Road Construction** | May not be in historical data | Variable delays |
| **Weather** | Not included in standard predictions | Rain/snow adds 10-30% |
| **Special Events** | Concerts, sports games, protests | Localized severe congestion |
| **School Schedules** | Summer break vs school year differs | Different rush hour patterns |
| **Pandemic/Unusual Periods** | Historical data may be outdated | Patterns may have shifted |

#### Best Practices for Accurate Predictions

1. **Run predictions closer to departure**: Same-day predictions are most accurate
2. **Account for day type**: Ensure your departure date matches the expected traffic pattern
3. **Consider time sensitivity**: Rush hour predictions are more variable than midday
4. **Re-run for critical deliveries**: If conditions may have changed, refresh the prediction
5. **Use appropriate traffic model (Google)**: `pessimistic` for time-critical deliveries
6. **Enable caching wisely**: Cache for repeated same-time queries, but refresh for different times

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

## Predictive Traffic (departAt / departure_time Parameter)

### How It Works

When you specify a future departure time, all providers use similar approaches:

**TomTom & HERE** use the `departAt` parameter with:
1. **Historical Traffic Patterns**: Aggregated data from millions of connected devices showing typical traffic conditions for that time slot
2. **Day Type Awareness**: Different patterns for weekdays vs weekends
3. **Seasonal Adjustments**: Accounts for time-of-year variations

**Google** uses the `departure_time` parameter (Unix timestamp) with:
1. **Historical Traffic Data**: Leverages Google's extensive traffic data from Android devices, Google Maps users, and Waze
2. **Machine Learning Models**: Advanced prediction models trained on billions of data points
3. **Traffic Model Options**: `best_guess` (default), `pessimistic`, or `optimistic` predictions

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

## Average Traffic Density (Plan-Level)

### Definition

The **Average Traffic Density** represents the overall traffic impact across all deliveries in a plan. It is calculated as the ratio of total actual travel time to total free-flow travel time:

```
                          Total Travel Time (with traffic)
Average Traffic Density = ─────────────────────────────────
                          Total Free-Flow Travel Time
```

Or mathematically:

```
                    Σ (outbound_time[i] + return_time[i])
Average Density = ──────────────────────────────────────────
                  Σ (outbound_freeflow[i] + return_freeflow[i])
```

Where the sums are over all deliveries in the plan.

### Calculation Example

For a delivery plan with 3 targets:

| Delivery | Outbound Time | Return Time | Total Time | Outbound Free-Flow | Return Free-Flow | Total Free-Flow |
|----------|---------------|-------------|------------|-------------------|-----------------|-----------------|
| 1 | 25 min | 22 min | 47 min | 20 min | 20 min | 40 min |
| 2 | 38 min | 35 min | 73 min | 30 min | 30 min | 60 min |
| 3 | 18 min | 20 min | 38 min | 15 min | 15 min | 30 min |
| **Total** | | | **158 min** | | | **130 min** |

```
Average Density = 158 / 130 = 1.215
```

This means overall, the deliveries took 21.5% longer than they would under free-flow conditions.

### Why Time-Weighted (Not Simple Average)?

The average is **weighted by travel time**, meaning longer routes contribute more to the overall average. This approach:

1. **Reflects true time impact**: A 60-minute route with 1.5 density adds more delay (30 min) than a 10-minute route with the same density (5 min)
2. **Accurate total delay**: The formula `(Average Density - 1) × Total Free-Flow Time` gives the exact total delay
3. **Meaningful for planning**: Tells you the overall traffic multiplier for your entire delivery operation

### Comparison: Time-Weighted vs Simple Average

Consider a plan with 2 deliveries:

| Delivery | Travel Time | Free-Flow Time | Route Density |
|----------|-------------|----------------|---------------|
| 1 (short) | 12 min | 10 min | 1.20 |
| 2 (long) | 90 min | 60 min | 1.50 |
| **Total** | **102 min** | **70 min** | |

**Simple Average** (mean of densities):
```
(1.20 + 1.50) / 2 = 1.35
```

**Time-Weighted Average** (total time / total free-flow):
```
102 / 70 = 1.457
```

The time-weighted average (1.457) is higher because it correctly reflects that most of the driving time was spent on the heavily congested route. The simple average (1.35) underestimates the true traffic impact.

**Verification**: Total delay = 102 - 70 = 32 minutes
- Time-weighted: (1.457 - 1) × 70 = 32 min ✓
- Simple average: (1.35 - 1) × 70 = 24.5 min ✗

### Interpretation Guide

| Average Density | Overall Traffic Conditions | Typical Scenario |
|-----------------|---------------------------|------------------|
| 1.00 - 1.10 | Excellent | Free-flow conditions, off-peak hours |
| 1.10 - 1.20 | Good | Light traffic, early morning or midday |
| 1.20 - 1.35 | Moderate | Typical business hours, some congestion |
| 1.35 - 1.50 | Poor | Rush hour conditions, significant delays |
| 1.50+ | Severe | Heavy congestion, major delays throughout |

### Display in the Application

The Average Density is displayed in two places:

1. **Summary Section**: Shows the numeric value with color coding
2. **Density Chart**: A horizontal blue line indicates the average level relative to individual delivery bars

The chart visualization helps identify:
- How individual deliveries compare to the average
- Whether there are outliers (very high or low density routes)
- The overall traffic impact at a glance

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

### Google Maps Platform Pricing

| API | Cost per 1,000 requests |
|-----|------------------------|
| Directions API | $5.00 |
| Geocoding API | $5.00 |
| Places Autocomplete | $2.83 |
| Places Details | $17.00 |

**Free tier**: $200/month credit applied automatically to all usage.

**Important notes**:
- Google is significantly more expensive than TomTom or HERE
- Location search requires 2 API calls per result (Autocomplete + Details)
- The $200/month credit covers approximately:
  - 40,000 direction requests, OR
  - 40,000 geocoding requests, OR
  - ~10,000 location searches (Autocomplete + Details combined)

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
- **Google**: 26 × $0.005 = **$0.130** (or free within $200/month credit)

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

#### Google Costs

| Scenario | Targets | API Calls (1+5N) | $200 Credit Runs/Month | Paid Cost/Run |
|----------|---------|------------------|------------------------|---------------|
| Small batch | 5 | ~26 | ~1,538/month | $0.130 |
| Medium batch | 10 | ~51 | ~784/month | $0.255 |
| Large batch | 20 | ~101 | ~396/month | $0.505 |
| Max batch | 50 | ~251 | ~159/month | $1.255 |

*Google pricing: $5.00 per 1,000 requests (Directions/Geocoding). Free tier: $200/month credit.*

#### Provider Comparison

| Scenario | TomTom Cost | HERE Cost | Google Cost | Best Value |
|----------|-------------|-----------|-------------|------------|
| Small batch (5) | $0.020 | $0.013 | $0.130 | HERE (85% cheaper than Google) |
| Medium batch (10) | $0.038 | $0.025 | $0.255 | HERE (90% cheaper than Google) |
| Large batch (20) | $0.076 | $0.049 | $0.505 | HERE (90% cheaper than Google) |
| Max batch (50) | $0.188 | $0.123 | $1.255 | HERE (90% cheaper than Google) |

**Recommendation**:
- **Cost-sensitive**: HERE offers the best value with ~35% lower costs than TomTom and ~90% lower than Google
- **Accuracy-focused**: Google may provide better predictions due to larger data coverage, but at 6-10x the cost
- **Development**: HERE's generous free tier (250,000/month) is ideal for testing and development

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

#### Google Monthly Costs

| Usage Level | Optimizations/Day | Targets/Opt | API Calls/Day | Monthly Cost |
|-------------|-------------------|-------------|---------------|--------------|
| Light | 10 | 10 | ~510 | $200 credit covers (~13 days) |
| Moderate | 50 | 10 | ~2,550 | ~$183 (after $200 credit) |
| Heavy | 200 | 15 | ~15,200 | ~$2,080 (after $200 credit) |

*Google free tier: $200/month credit. Directions/Geocoding: $5.00 per 1,000 requests.*

#### Monthly Cost Comparison

| Usage Level | TomTom | HERE | Google | Best Value |
|-------------|--------|------|--------|------------|
| Light (10/day) | $0 | $0 | ~$0* | TomTom or HERE |
| Moderate (50/day) | ~$38 | $0 | ~$183 | HERE |
| Heavy (200/day) | ~$342 | ~$102 | ~$2,080 | HERE |

*\*Google $200 credit covers ~13 days at light usage*

### Cost Optimization Tips

1. **Use HERE or TomTom for cost savings**: Both offer significantly lower costs than Google (~90% cheaper)
2. **HERE for development**: Best free tier (250,000/month) for testing and development
3. **Google for accuracy-critical use**: Consider Google only when maximum accuracy justifies the cost
4. **Enable caching**: Reduces repeat API calls by 50-80%
5. **Batch similar deliveries**: Run optimization once for the day
6. **Reuse depot addresses**: Cached geocoding saves calls
7. **Avoid unnecessary re-runs**: Only re-optimize when inputs change

## References

### TomTom
- [TomTom Routing API Documentation](https://developer.tomtom.com/routing-api/documentation/routing/calculate-route)
- [TomTom Traffic Flow](https://developer.tomtom.com/traffic-api/documentation/traffic-flow/raster-flow-tiles)
- [TomTom Pricing](https://developer.tomtom.com/store/maps-api)

### HERE
- [HERE Routing API Documentation](https://developer.here.com/documentation/routing-api/dev_guide/index.html)
- [HERE Geocoding & Search](https://developer.here.com/documentation/geocoding-search-api/dev_guide/index.html)
- [HERE Pricing](https://www.here.com/platform/pricing)

### Google Maps Platform
- [Google Directions API Documentation](https://developers.google.com/maps/documentation/directions/overview)
- [Google Geocoding API Documentation](https://developers.google.com/maps/documentation/geocoding/overview)
- [Google Places API Documentation](https://developers.google.com/maps/documentation/places/web-service/overview)
- [Google Maps Platform Pricing](https://developers.google.com/maps/billing-and-pricing/pricing)
- [Google Maps Platform Console](https://console.cloud.google.com/google/maps-apis)
