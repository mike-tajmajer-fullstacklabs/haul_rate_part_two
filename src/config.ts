import { z } from 'zod';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Environment schema
const EnvSchema = z.object({
  TOMTOM_API_KEY: z.string().optional(),
  HERE_API_KEY: z.string().optional(),
  PORT: z.string().default('3000').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CACHE_ENABLED: z.string().default('true').transform((v) => v === 'true'),
  CACHE_TTL_HOURS: z.string().default('24').transform(Number),
});

// Parse and validate environment
const envResult = EnvSchema.safeParse(process.env);

if (!envResult.success) {
  console.error('Environment validation failed:');
  for (const error of envResult.error.errors) {
    console.error(`  - ${error.path.join('.')}: ${error.message}`);
  }
  process.exit(1);
}

const env = envResult.data;

// Validate at least one API key is provided
if (!env.TOMTOM_API_KEY && !env.HERE_API_KEY) {
  console.error('At least one API key is required: TOMTOM_API_KEY or HERE_API_KEY');
  process.exit(1);
}

// Application configuration
export const config = {
  // Server
  port: env.PORT,
  nodeEnv: env.NODE_ENV,
  isDevelopment: env.NODE_ENV === 'development',
  isProduction: env.NODE_ENV === 'production',

  // TomTom API
  tomtom: {
    apiKey: env.TOMTOM_API_KEY || '',
    enabled: !!env.TOMTOM_API_KEY,
    baseUrl: 'https://api.tomtom.com',
    geocodingEndpoint: '/search/2/geocode',
    routingEndpoint: '/routing/1/calculateRoute',
    requestTimeoutMs: 30000,
  },

  // HERE API
  here: {
    apiKey: env.HERE_API_KEY || '',
    enabled: !!env.HERE_API_KEY,
    routingBaseUrl: 'https://router.hereapi.com',
    geocodingBaseUrl: 'https://geocode.search.hereapi.com',
    searchBaseUrl: 'https://autosuggest.search.hereapi.com',
    reverseGeocodeBaseUrl: 'https://revgeocode.search.hereapi.com',
    requestTimeoutMs: 30000,
  },

  // Caching
  cache: {
    enabled: env.CACHE_ENABLED,
    ttlHours: env.CACHE_TTL_HOURS,
  },

  // Paths
  paths: {
    root: join(__dirname, '..'),
    config: join(__dirname, '..', 'config'),
    data: join(__dirname, '..', 'data'),
    cache: join(__dirname, '..', 'data', 'cache'),
    plans: join(__dirname, '..', 'data', 'plans'),
  },

  // Defaults
  defaults: {
    deliveryDurationMinutes: 15,
    maxTargets: 50,
    countrySet: 'US',
    defaultProvider: (env.TOMTOM_API_KEY ? 'tomtom' : 'here') as 'tomtom' | 'here',
  },
} as const;

export type Config = typeof config;
