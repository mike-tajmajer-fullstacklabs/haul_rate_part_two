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
- **External APIs**: TomTom Routing API, TomTom Geocoding API, TomTom Search API
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
│   ├── tomtom.ts         # TomTom Routing API client
│   ├── geocoding.ts      # TomTom Geocoding API client
│   ├── optimizer.ts      # Delivery order optimization
│   └── holidays.ts       # Day type detection (weekday/weekend/holiday)
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

**Data Flow**: Input addresses → Geocode (TomTom) → Calculate routes at departure time (TomTom) → Sort by traffic density → Return optimized delivery order

## Key Patterns

- **Schema-driven**: Use Zod schemas for all external data and API contracts
- **Configuration-driven**: JSON config files for holidays, .env for secrets
- **File-based caching**: JSON cache to reduce TomTom API costs
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

## Environment Variables

Required in `.env`:
- `TOMTOM_API_KEY` - TomTom API key
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (development/production)
- `CACHE_ENABLED` - Enable/disable caching (default: true)
- `CACHE_TTL_HOURS` - Cache TTL in hours (default: 24)
