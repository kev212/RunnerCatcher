import axios from 'axios';
import bs58 from 'bs58';
import { Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import {
  JUPITER_SWAP_BASE_URL, JUPITER_API_KEY, JUPITER_SLIPPAGE_BPS,
  SOLANA_PRIVATE_KEY, WSOL_MINT, SOL_DECIMALS, BUY_AMOUNT_SOL,
  LIVE_MIN_SOL_RESERVE, TRADING_MODE, JSON_HEADERS,
} from '../config.js';
import type { Candidate } from '../types/index.js';
import { loadKeypair } from '../utils/wallet.js';

let wallet: Keypair | null = null;

export function initWallet() {
  if (SOLANA_PRIVATE_KEY) {
    wallet = loadKeypair(SOLANA_PRIVATE_KEY);
    if (wallet) {
      console.log(`[wallet] loaded ${wallet.publicKey.toBase58()}`);
    }
  }
}

export function getWalletPubkey(): string | null {
  return wallet?.publicKey?.toBase58() || null;
}

interface JupiterOrderResult {
  inputMint: string;
  outputMint?: string;
  inAmount: string;
  outAmount?: string;
  otherAmountThreshold: string;
  swapTransaction?: string;
  transaction?: string;
  requestId?: string;
  error?: string;
  errorCode?: string;
  errorMessage?: string;
}

interface JupiterExecuteResult {
  signature?: string;
  txid?: string;
  status?: string;
  error?: string;
  outputAmountResult?: string;
  totalOutputAmount?: string;
}

export async function executeBuy(candidate: Candidate): Promise<{ success: boolean; signature?: string; error?: string }> {
  if (TRADING_MODE === 'dry_run') {
    console.log(`[buy] DRY RUN: would buy $${candidate.symbol} ${BUY_AMOUNT_SOL} SOL`);
    return { success: true, signature: 'dry_run' };
  }

  if (!wallet) {
    return { success: false, error: 'wallet not loaded' };
  }

  const amountLamports = Math.floor(BUY_AMOUNT_SOL * SOL_DECIMALS);

  try {
    // Step 1: Get quote and transaction from Jupiter
    const order = await getJupiterOrder(candidate.mint, amountLamports);
    if (!order) {
      return { success: false, error: 'failed to get Jupiter order' };
    }

    // Step 2: Sign the transaction
    const signedTx = signTransaction(order);

    // Step 3: Execute
    const result = await executeJupiterSigned(order, signedTx);

    if (!result || !result.signature) {
      return { success: false, error: result?.error || 'no signature returned' };
    }

    console.log(`[buy] executed ${candidate.symbol}: ${result.signature}`);
    return { success: true, signature: result.signature };
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[buy] error: ${msg}`);
    return { success: false, error: msg };
  }
}

async function getJupiterOrder(outputMint: string, amountLamports: number): Promise<JupiterOrderResult | null> {
  const url = new URL(`${JUPITER_SWAP_BASE_URL}/order`);
  url.searchParams.set('inputMint', WSOL_MINT);
  url.searchParams.set('outputMint', outputMint);
  url.searchParams.set('amount', String(amountLamports));
  url.searchParams.set('taker', wallet!.publicKey.toBase58());
  url.searchParams.set('slippageBps', String(JUPITER_SLIPPAGE_BPS));

  const res = await axios.get(url.toString(), {
    timeout: 15_000,
    headers: { ...JSON_HEADERS, ...(JUPITER_API_KEY ? { 'x-api-key': JUPITER_API_KEY } : {}) },
  });

  const order = res.data as JupiterOrderResult;
  if (order.errorCode || order.error) {
    console.error(`[jupiter] order error: ${order.errorMessage || order.error}`);
    return null;
  }
  return order;
}

function signTransaction(order: JupiterOrderResult): string {
  const txBase64 = order.transaction || order.swapTransaction;
  if (!txBase64) throw new Error('no transaction in Jupiter order');

  const tx = VersionedTransaction.deserialize(Buffer.from(txBase64, 'base64'));
  tx.sign([wallet!]);
  return Buffer.from(tx.serialize()).toString('base64');
}

async function executeJupiterSigned(order: JupiterOrderResult, signedTx: string): Promise<JupiterExecuteResult | null> {
  const res = await axios.post(
    `${JUPITER_SWAP_BASE_URL}/execute`,
    { signedTransaction: signedTx, requestId: order.requestId },
    {
      timeout: 30_000,
      headers: { ...JSON_HEADERS, 'content-type': 'application/json', ...(JUPITER_API_KEY ? { 'x-api-key': JUPITER_API_KEY } : {}) },
    },
  );

  return res.data as JupiterExecuteResult;
}

export async function executeSell(
  mint: string,
  tokenAmount: string,
  reason: string,
): Promise<{ success: boolean; signature?: string; error?: string; outputAmount?: string }> {
  if (TRADING_MODE === 'dry_run') {
    console.log(`[sell] DRY RUN: would sell ${tokenAmount} of ${mint.slice(0, 8)}... (${reason})`);
    return { success: true, signature: 'dry_run', outputAmount: '0' };
  }

  if (!wallet) {
    return { success: false, error: 'wallet not loaded' };
  }

  try {
    const url = new URL(`${JUPITER_SWAP_BASE_URL}/order`);
    url.searchParams.set('inputMint', mint);
    url.searchParams.set('outputMint', WSOL_MINT);
    url.searchParams.set('amount', tokenAmount);
    url.searchParams.set('taker', wallet!.publicKey.toBase58());
    url.searchParams.set('slippageBps', String(JUPITER_SLIPPAGE_BPS));

    const res = await axios.get(url.toString(), {
      timeout: 15_000,
      headers: { ...JSON_HEADERS, ...(JUPITER_API_KEY ? { 'x-api-key': JUPITER_API_KEY } : {}) },
    });

    const order = res.data as JupiterOrderResult;
    if (order.errorCode || order.error) {
      return { success: false, error: order.errorMessage || order.error };
    }

    const signedTx = signTransaction(order);

    const execRes = await axios.post(
      `${JUPITER_SWAP_BASE_URL}/execute`,
      { signedTransaction: signedTx, requestId: order.requestId },
      {
        timeout: 30_000,
        headers: { ...JSON_HEADERS, 'content-type': 'application/json', ...(JUPITER_API_KEY ? { 'x-api-key': JUPITER_API_KEY } : {}) },
      },
    );

    const execResult = execRes.data as JupiterExecuteResult;
    if (!execResult.signature) {
      return { success: false, error: execResult.error || 'no signature' };
    }

    const outputAmt = execResult.outputAmountResult || execResult.totalOutputAmount || order.outAmount || '0';

    console.log(`[sell] ${reason}: ${execResult.signature} (output: ${outputAmt})`);
    return { success: true, signature: execResult.signature, outputAmount: outputAmt };
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[sell] error: ${msg}`);
    return { success: false, error: msg };
  }
}
