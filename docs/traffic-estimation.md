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

2. **Build Delivery Sequence**: Process depends on optimization setting:
   - **Without optimization**: Process targets in original order
   - **With optimization**: Use greedy re-optimization (see below)

3. **For Each Delivery**:
   - Calculate outbound route (depot → target) at current departure time
   - Calculate return route (target → depot) at arrival + unloading time
   - Compute round-trip traffic density (average of both legs)
   - Update next departure = return arrival time

4. **Return Delivery Plan**: Ordered list with:
   - Outbound and return routes for each delivery
   - Departure, arrival, and return times
   - Round-trip density for each delivery
   - Total and average metrics across all deliveries

### Greedy Re-Optimization Algorithm

When optimization is enabled, the system uses a **greedy re-optimization** approach that recalculates all remaining routes after each delivery is selected. The algorithm **favors time savings** by selecting the route with the shortest total travel time at each step.

#### How It Works

```
Start: 5 destinations, current time = 8:00 AM

Round 1: Calculate routes for all 5 destinations at 8:00 AM
  → Select shortest travel time (Destination B: 45 min round-trip)
  → Return time: 9:00 AM

Round 2: Calculate routes for remaining 4 destinations at 9:00 AM
  → Select shortest travel time (Destination D: 52 min round-trip)
  → Return time: 10:07 AM

Round 3: Calculate routes for remaining 3 destinations at 10:07 AM
  → Select shortest travel time (Destination A: 48 min round-trip)
  → Return time: 11:10 AM

... continue until all destinations assigned
```

#### Why Favor Time Savings?

By selecting the fastest round-trip at each step:

1. **Earlier returns**: The driver gets back to the depot sooner
2. **More deliveries per day**: Completing fast trips first maximizes throughput
3. **Adapts to conditions**: Traffic changes throughout the day; recalculating ensures each selection reflects current conditions

**Example**: Consider 3 destinations at 8:00 AM start:

| Destination | Round-Trip Time at 8:00 AM | Round-Trip Time at 10:00 AM |
|-------------|---------------------------|----------------------------|
| A (downtown) | 85 min (heavy traffic) | 55 min (post-rush) |
| B (nearby) | 45 min (short distance) | 50 min (school traffic) |
| C (highway) | 70 min (moderate) | 65 min (moderate) |

**Greedy by time savings**:
- 8:00 AM: B is fastest (45 min) → select B, return 9:00 AM
- 9:00 AM: Recalculate A and C → A is now 60 min, C is 68 min → select A, return 10:15 AM
- 10:15 AM: Only C remains (65 min) → select C, return 11:35 AM

**Total time**: 3 hours 35 minutes

**Without optimization** (original order A → B → C):
- A at 8:00 AM: 85 min → return 9:40 AM
- B at 9:40 AM: 48 min → return 10:43 AM
- C at 10:43 AM: 66 min → return 12:04 PM

**Total time**: 4 hours 4 minutes

**Time saved**: 29 minutes by optimizing for shortest travel time.

#### Route Calculations

| Approach | Destinations | Route Calculations |
|----------|--------------|-------------------|
| No optimization | N | 2N (one round-trip per destination) |
| Greedy optimization | N | N + (N-1) + (N-2) + ... + 1 = N(N+1)/2 round-trips |

**Example for 5 destinations**:

| Approach | Calculation | Total Routes |
|----------|-------------|--------------|
| No optimization | 5 × 2 | **10** |
| Greedy optimization | 5+4+3+2+1 = 15 round-trips × 2 | **30** |

The greedy approach uses more API calls but produces better optimization by accounting for how traffic changes throughout the day.

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

| Mode | Geocoding | Route Calculations | Total |
|------|-----------|-------------------|-------|
| No optimization | 1 + N | 2N | **1 + 3N** |
| Greedy optimization | 1 + N | N(N+1) | **1 + N + N(N+1)** |

**Route calculation formula for greedy optimization**:
- Round 1: Calculate N round-trips (2N routes)
- Round 2: Calculate N-1 round-trips (2(N-1) routes)
- Round 3: Calculate N-2 round-trips...
- Total: 2 × (N + N-1 + N-2 + ... + 1) = 2 × N(N+1)/2 = **N(N+1) routes**

### Typical Solution Example: 5 Delivery Targets

#### Without Optimization (10 route calls)

| Operation | API Calls |
|-----------|-----------|
| Geocoding (depot + 5 targets) | 6 |
| Route calculations (5 × 2 routes) | 10 |
| **Total** | **16** |

#### With Greedy Optimization (30 route calls)

| Round | Time | Remaining | Route Calculations |
|-------|------|-----------|-------------------|
| 1 | 8:00 AM | 5 targets | 10 routes (5 round-trips) |
| 2 | 9:15 AM | 4 targets | 8 routes (4 round-trips) |
| 3 | 10:30 AM | 3 targets | 6 routes (3 round-trips) |
| 4 | 11:45 AM | 2 targets | 4 routes (2 round-trips) |
| 5 | 1:00 PM | 1 target | 2 routes (1 round-trip) |
| **Total** | | | **30 routes** |

Plus 6 geocoding calls = **36 total API calls**

#### Greedy Optimization Walkthrough

**Round 1** (8:00 AM) - Calculate all 5 targets:

| Target | Round-Trip Time | Density |
|--------|-----------------|---------|
| Target 1 | 72 min | 1.42 |
| Target 2 | **38 min** ← Selected (fastest) | 1.15 |
| Target 3 | 85 min | 1.59 |
| Target 4 | 55 min | 1.32 |
| Target 5 | 95 min | 1.70 |

→ Select Target 2 (fastest), return at 8:53 AM

**Round 2** (8:53 AM) - Recalculate remaining 4 targets:

| Target | Round-Trip Time | Density |
|--------|-----------------|---------|
| Target 1 | 65 min | 1.28 |
| Target 3 | 78 min | 1.45 |
| Target 4 | **50 min** ← Selected (fastest) | 1.22 |
| Target 5 | 88 min | 1.55 |

→ Select Target 4 (fastest), return at 9:58 AM

**Round 3** (9:58 AM) - Recalculate remaining 3 targets:

| Target | Round-Trip Time | Density |
|--------|-----------------|---------|
| Target 1 | **58 min** ← Selected (fastest) | 1.18 |
| Target 3 | 70 min | 1.32 |
| Target 5 | 80 min | 1.38 |

→ Select Target 1 (fastest), return at 11:11 AM

**Round 4** (11:11 AM) - Recalculate remaining 2 targets:

| Target | Round-Trip Time | Density |
|--------|-----------------|---------|
| Target 3 | **62 min** ← Selected (fastest) | 1.25 |
| Target 5 | 75 min | 1.30 |

→ Select Target 3 (fastest), return at 12:28 PM

**Round 5** (12:28 PM) - Only Target 5 remains:

→ Select Target 5, return at 1:40 PM

**Final order**: Target 2 → Target 4 → Target 1 → Target 3 → Target 5

**Total time**: 5 hours 40 minutes (8:00 AM to 1:40 PM)

Note how the algorithm always picks the fastest option at each decision point, and travel times change based on time of day (Target 1 improved from 72 min to 58 min as rush hour ended).

### API Call Summary by Scenario

| Scenario | Targets | No Optimization | Greedy Optimization |
|----------|---------|-----------------|---------------------|
| Small | 5 | 16 calls | 36 calls |
| Medium | 10 | 31 calls | 116 calls |
| Large | 20 | 61 calls | 426 calls |

### Cost per Run (5 Targets)

| Mode | API Calls | TomTom | HERE | Google |
|------|-----------|--------|------|--------|
| No optimization | 16 | $0.012 | $0.008 | $0.080 |
| Greedy optimization | 36 | $0.027 | $0.018 | $0.180 |

**With caching on subsequent runs:**
- Geocoding: 0 calls (cached)
- Routes with same departure times: 0 calls (cached)
- **Re-run cost: $0** if inputs unchanged

### Example Cost Calculations

#### TomTom Costs

| Scenario | Targets | No Optimization | Greedy Optimization | Free Tier Runs/Day |
|----------|---------|-----------------|---------------------|-------------------|
| Small | 5 | 16 calls / $0.012 | 36 calls / $0.027 | 69-156/day |
| Medium | 10 | 31 calls / $0.023 | 116 calls / $0.087 | 21-80/day |
| Large | 20 | 61 calls / $0.046 | 426 calls / $0.320 | 5-40/day |

*TomTom pricing: ~$0.75 per 1,000 requests. Free tier: 2,500 requests/day.*

#### HERE Costs

| Scenario | Targets | No Optimization | Greedy Optimization | Free Tier Runs/Day |
|----------|---------|-----------------|---------------------|-------------------|
| Small | 5 | 16 calls / $0.008 | 36 calls / $0.018 | 230-518/day |
| Medium | 10 | 31 calls / $0.015 | 116 calls / $0.057 | 71-267/day |
| Large | 20 | 61 calls / $0.030 | 426 calls / $0.209 | 19-136/day |

*HERE pricing: ~$0.49 per 1,000 transactions. Free tier: 250,000/month (~8,300/day).*

#### Google Costs

| Scenario | Targets | No Optimization | Greedy Optimization | $200 Credit Runs/Month |
|----------|---------|-----------------|---------------------|------------------------|
| Small | 5 | 16 calls / $0.080 | 36 calls / $0.180 | 1,111-2,500/month |
| Medium | 10 | 31 calls / $0.155 | 116 calls / $0.580 | 344-1,290/month |
| Large | 20 | 61 calls / $0.305 | 426 calls / $2.130 | 93-655/month |
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
