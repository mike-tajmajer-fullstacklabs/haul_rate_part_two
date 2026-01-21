# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context

Traffic Density Forecasting POC for optimizing delivery order based on predicted traffic conditions. Part of the West Coast Sand & Gravel (WCSG) application ecosystem.

## Technology Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript (strict mode, ES2022 target, NodeNext modules)
- **Backend Framework**: Express.js
- **Frontend**: React + Vite
- **Validation**: Zod for runtime schema validation
- **External APIs**: TomTom, HERE, and Google Maps Platform (Directions, Geocoding, Places)
- **Mapping**: Leaflet + react-leaflet for interactive maps

## Build Commands

### Backend
```bash
npm install              # Install dependencies
npm run dev              # Development with hot reload (tsx watch)
npm run build            # TypeScript compilation
npm start                # Run production build
```

### Frontend
```bash
cd frontend
npm install              # Install dependencies
npm run dev              # Development server (port 5173)
npm run build            # Production build
```

## Architecture Pattern

The codebase follows a service-oriented structure:

```
src/
├── index.ts              # Entry point, server setup
├── config.ts             # Environment and config loading
├── types/                # Zod schemas and TypeScript types
├── api/                  # Express route handlers
├── services/             # Business logic
│   ├── provider-manager.ts    # Multi-provider management
│   ├── routing-provider.ts    # Provider interface definition
│   ├── tomtom-provider.ts     # TomTom API client
│   ├── here-provider.ts       # HERE API client
│   ├── google-provider.ts     # Google Maps API client
│   ├── optimizer.ts           # Delivery order optimization
│   └── holidays.ts            # Day type detection (weekday/weekend/holiday)
└── storage/
    ├── cache-store.ts    # File-based API response caching
    └── plan-store.ts     # Delivery plan persistence

config/
└── holidays.json         # US federal holidays + user-defined holidays

frontend/
└── src/
    ├── App.tsx           # Main application
    ├── api/client.ts     # API client
    └── components/
        ├── DeliveryForm.tsx   # Address input with text/map modes
        ├── AddressList.tsx    # Dynamic address list
        ├── MapView.tsx        # Leaflet map with click-to-select
        ├── LocationSearch.tsx # Location search with autocomplete
        ├── ResultsPanel.tsx   # Optimized delivery results
        └── DensityChart.tsx   # Traffic density visualization
```

**Data Flow**: Input addresses → Geocode (via selected provider) → Calculate routes at departure time (via selected provider) → Sort by traffic density → Return optimized delivery order

## Key Patterns

- **Schema-driven**: Use Zod schemas for all external data and API contracts
- **Configuration-driven**: JSON config files for holidays, .env for secrets
- **File-based caching**: JSON cache to reduce API costs (provider-aware)
- **Hub-and-spoke routing**: Each delivery is a separate depot→target→depot trip
- **Traffic density**: Ratio of actual travel time to no-traffic time (1.0 = free flow)
- **Graceful shutdown**: Handle SIGINT/SIGTERM for clean server termination

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/delivery/optimize | Main optimization endpoint |
| GET | /api/delivery/plans | List saved plans |
| GET | /api/delivery/plans/:id | Get specific plan |
| DELETE | /api/delivery/plans/:id | Delete a plan |
| GET | /api/delivery/day-type | Get day type for date |
| GET | /api/delivery/holidays | List holidays |
| POST | /api/delivery/holidays | Add user holiday |
| DELETE | /api/delivery/holidays/:date | Remove user holiday |
| POST | /api/delivery/reverse-geocode | Convert coordinates to address |
| GET | /api/delivery/search-locations | Search for locations by name |
| GET | /api/delivery/providers | List available routing providers |

## Environment Variables

Required in `.env` (at least one API key required):
- `TOMTOM_API_KEY` - TomTom API key (https://developer.tomtom.com/)
- `HERE_API_KEY` - HERE API key (https://developer.here.com/)
- `GOOGLE_API_KEY` - Google Maps API key (https://console.cloud.google.com/)
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (development/production)
- `CACHE_ENABLED` - Enable/disable caching (default: true)
- `CACHE_TTL_HOURS` - Cache TTL in hours (default: 24)

## Routing Providers

The application supports three routing providers. At least one API key must be configured.

### TomTom
- **Setup**: https://developer.tomtom.com/
- **APIs Used**: Routing API, Geocoding API, Search API
- **Pricing**: ~$0.42 per 1,000 routing requests, ~$0.42 per 1,000 geocoding requests
- **Free Tier**: 2,500 free transactions/day

### HERE
- **Setup**: https://developer.here.com/
- **APIs Used**: Routing v8, Geocoding, Autosuggest
- **Pricing**: ~$0.49 per 1,000 routing requests, ~$1.00 per 1,000 geocoding requests
- **Free Tier**: 250,000 transactions/month

### Google Maps Platform
- **Setup**: https://console.cloud.google.com/google/maps-apis
- **APIs Used**: Directions API, Geocoding API, Places API (Autocomplete + Details)
- **Pricing** (pay-as-you-go):
  - Directions API: $5.00 per 1,000 requests
  - Geocoding API: $5.00 per 1,000 requests
  - Places Autocomplete: $2.83 per 1,000 requests
  - Places Details: $17.00 per 1,000 requests
- **Free Tier**: $200/month credit (covers ~40,000 direction requests or ~40,000 geocoding requests)
- **Note**: Location search uses Places Autocomplete + Details (2 API calls per search result)

### Cost Comparison (per 1,000 optimization runs with 10 targets each)

| Provider | Geocoding | Routing | Search | Total Est. |
|----------|-----------|---------|--------|------------|
| TomTom   | ~$4.62    | ~$8.82  | ~$0.42 | ~$14/1K    |
| HERE     | ~$11.00   | ~$10.29 | ~$1.00 | ~$22/1K    |
| Google   | ~$55.00   | ~$105.00| ~$99.15| ~$259/1K   |

*Estimates based on: 11 geocodes, 21 routes (outbound + return), 5 searches per optimization run*

**Recommendation**: TomTom or HERE for cost-sensitive deployments. Google for maximum accuracy or existing Google Cloud integration.
