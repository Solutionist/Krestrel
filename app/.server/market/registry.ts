// Provider registry (ADR 0009). Adding a data source = a new folder implementing
// MarketDataProvider + one line here. Hub, database, routes, and UI stay unchanged.
import { ConfigError } from "../env-schema";
import { createAlpacaProvider } from "./alpaca/provider";
import { createMockProvider } from "./mock/provider";
import type { MarketDataProvider, ProviderContext, ProviderFactory } from "./provider";

const PROVIDERS: Record<string, ProviderFactory> = {
  alpaca: createAlpacaProvider,
  mock: createMockProvider,
};

export function createProvider(id: string, context: ProviderContext): MarketDataProvider {
  const factory = Object.hasOwn(PROVIDERS, id) ? PROVIDERS[id] : undefined;
  if (!factory) {
    throw new ConfigError(
      `Unknown MARKET_PROVIDER "${id}". Available: ${Object.keys(PROVIDERS).join(", ")}.`,
    );
  }
  return factory(context);
}
