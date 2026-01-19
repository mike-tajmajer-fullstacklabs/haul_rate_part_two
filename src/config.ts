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
  TOMTOM_API_KEY: z.string().min(1, 'TOMTOM_API_KEY is required'),
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

// Application configuration
export const config = {
  // Server
  port: env.PORT,
  nodeEnv: env.NODE_ENV,
  isDevelopment: env.NODE_ENV === 'development',
  isProduction: env.NODE_ENV === 'production',

  // TomTom API
  tomtom: {
    apiKey: env.TOMTOM_API_KEY,
    baseUrl: 'https://api.tomtom.com',
    geocodingEndpoint: '/search/2/geocode',
    routingEndpoint: '/routing/1/calculateRoute',
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
  },
} as const;

export type Config = typeof config;
