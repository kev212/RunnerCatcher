import { gmgnGet } from './client.js';
import type { GmgnTokenInfo } from '../types/index.js';

interface GmgnTokenInfoResponse {
  code: number;
  data?: {
    data?: GmgnTokenInfo;
  };
}

export async function fetchTokenInfo(mint: string): Promise<GmgnTokenInfo | null> {
  try {
    const data = await gmgnGet<GmgnTokenInfoResponse>('/v1/token/info', {
      chain: 'sol',
      address: mint,
    });

    const token = data?.data?.data || data?.data || null;
    return token as GmgnTokenInfo | null;
  } catch (err) {
    console.error(`[token] fetch ${mint.slice(0, 8)}... ${(err as Error).message}`);
    return null;
  }
}
