import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';

export function loadKeypair(privateKey: string): Keypair | null {
  try {
    const value = String(privateKey || '').trim();
    if (!value) return null;
    if (value.startsWith('[')) {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(value)));
    }
    return Keypair.fromSecretKey(bs58.decode(value));
  } catch (err) {
    console.error(`[wallet] failed to load keypair: ${(err as Error).message}`);
    return null;
  }
}
