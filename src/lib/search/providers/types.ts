import type { User } from '@prisma/client';
import type { SearchProviderId, SearchProviderResult, SearchProviderRateLimit } from '@/lib/search/types';

export interface ProviderSearchContext {
  user: User;
  query: string;
  limit: number;
}

export interface ProviderHandlerResult {
  results: SearchProviderResult[];
  rateLimited?: SearchProviderRateLimit;
}

export type ProviderHandler = (ctx: ProviderSearchContext) => Promise<ProviderHandlerResult>;

export interface ServerProviderEntry {
  id: SearchProviderId;
  handler: ProviderHandler;
}
