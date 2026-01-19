import { config } from '../config.js';
import { IRoutingProvider, RoutingProviderType } from './routing-provider.js';
import { TomTomProvider } from './tomtom-provider.js';
import { HereProvider } from './here-provider.js';

class ProviderManager {
  private providers: Map<RoutingProviderType, IRoutingProvider> = new Map();

  getProvider(type?: RoutingProviderType): IRoutingProvider {
    const providerType = type || config.defaults.defaultProvider;

    // Check if provider is enabled
    if (providerType === 'tomtom' && !config.tomtom.enabled) {
      throw new Error('TomTom API is not configured. Please set TOMTOM_API_KEY.');
    }
    if (providerType === 'here' && !config.here.enabled) {
      throw new Error('HERE API is not configured. Please set HERE_API_KEY.');
    }

    // Return cached provider if available
    if (this.providers.has(providerType)) {
      return this.providers.get(providerType)!;
    }

    // Create new provider instance
    let provider: IRoutingProvider;
    switch (providerType) {
      case 'tomtom':
        provider = new TomTomProvider();
        break;
      case 'here':
        provider = new HereProvider();
        break;
      default:
        throw new Error(`Unknown provider type: ${providerType}`);
    }

    this.providers.set(providerType, provider);
    return provider;
  }

  getAvailableProviders(): RoutingProviderType[] {
    const available: RoutingProviderType[] = [];
    if (config.tomtom.enabled) {
      available.push('tomtom');
    }
    if (config.here.enabled) {
      available.push('here');
    }
    return available;
  }

  getDefaultProvider(): RoutingProviderType {
    return config.defaults.defaultProvider;
  }

  isProviderAvailable(type: RoutingProviderType): boolean {
    if (type === 'tomtom') return config.tomtom.enabled;
    if (type === 'here') return config.here.enabled;
    return false;
  }
}

// Singleton instance
export const providerManager = new ProviderManager();
