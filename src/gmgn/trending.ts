import { gmgnGet } from './client.js';
import { TRENDING_PLATFORMS } from '../config.js';
import type { GmgnTrendingToken } from '../types/index.js';

interface GmgnTrendingResponse {
  code: number;
  data?: {
    code?: number;
    data?: {
      rank?: GmgnTrendingToken[];
    };
    rank?: GmgnTrendingToken[];
  };
  rank?: GmgnTrendingToken[];
}

export async function fetchTrending5m(): Promise<GmgnTrendingToken[]> {
  try {
    const data = await gmgnGet<GmgnTrendingResponse>('/v1/market/rank', {
      chain: 'sol',
      interval: '5m',
      limit: '80',
      order_by: 'volume',
      direction: 'desc',
    });

    let items = (data as any)?.data?.data?.rank || data?.data?.rank || data?.rank || [];
    if (!Array.isArray(items)) items = [];

    if (TRENDING_PLATFORMS.length > 0) {
      items = (items as any[]).filter((t: any) => {
        const platform = (t.launchpad_platform || '').toLowerCase();
        return TRENDING_PLATFORMS.some(p => platform.includes(p.toLowerCase()));
      });
    }

    return items;
  } catch (err) {
    console.error(`[trending] fetch failed: ${(err as Error).message}`);
    return [];
  }
}
