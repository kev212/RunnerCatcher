import {
  ENABLE_LLM, LLM_BASE_URL, LLM_API_KEY,
  LLM_MODEL, LLM_TIMEOUT_MS, LLM_MIN_CONFIDENCE,
} from '../config.js';
import type { Candidate, LlmDecision } from '../types/index.js';
import { setting } from '../db/connection.js';
import { buildLearningContext } from '../learning/advisor.js';

function numSetting(key: string, fallback: number): number {
  const v = setting(key);
  return v ? Number(v) : fallback;
}

function buildSystemPrompt(): string {
  const learningBlock = buildLearningContext();
  const learningSection = learningBlock
    ? `\n\n── LEARNED FROM PAST TRADES ──\nUse these patterns to guide your decision:\n${learningBlock}\n` +
      `IMPORTANT: Weight learned patterns heavily. If a pattern matches this token and has LOW WIN RATE, strongly consider SKIP.`
    : '';

  return `You are a Solana memecoin sniper evaluator. You analyze tokens that already passed volume, market cap, age, and fee criteria. Your job is the FINAL gate: decide whether to BUY, WATCH, or SKIP based on risk signals and social proof.${learningSection}

Rules:
- BUY: strong signal combination with low risk. Smart money present, safe contract, genuine social activity, creator closed or transparent.
- WATCH: mixed signals. Some red flags but potential. Do not execute yet.
- SKIP: clear red flags. Wash trading, rug ratio high, dev still holding large %, no social proof, bot activity.

Factors that indicate STRONG BUY:
- smart_degen_count >= 3 (smart money accumulating)
- rug_ratio < 0.1
- top_10_holder_rate < 0.20 (decentralized holders)
- creator_token_status = creator_close (dev exited)
- cto_flag = 1 (community takeover - bullish)
- is_wash_trading = false
- bundler_rate < 0.3
- has social presence (twitter with followers)
- hot_level high

Factors that indicate SKIP:
- smart_degen_count = 0 (no smart money)
- rug_ratio > 0.2
- creator_token_status = creator_hold (dev still holds)
- is_wash_trading = true
- bundler_rate > 0.5
- no social links at all
- top_10_holder_rate > 0.50

Return JSON only: { "verdict": "BUY" | "WATCH" | "SKIP", "confidence": 0-100, "reason": "brief reason" }`;
}

function buildUserPrompt(c: Candidate): string {
  return `Token: $${c.symbol} (${c.mint.slice(0, 8)}...)
Launchpad: ${c.launchpad}
Age: ${c.ageSec}s | MC: $${fmt(c.marketCapUsd)} | Vol 1m: $${fmt(c.volume1mUsd)} | Fees: ${c.totalFeeSol.toFixed(1)} SOL

Risk:
- Rug ratio: ${c.rugRatio.toFixed(2)}
- Top 10 holder rate: ${(c.top10HolderRate * 100).toFixed(1)}%
- Bundler rate: ${(c.bundlerRate * 100).toFixed(1)}%
- Wash trading: ${c.isWashTrading}
- Creator status: ${c.creatorTokenStatus} ${c.creatorClose ? '(closed)' : ''}
- CTO: ${c.ctoFlag ? 'Yes' : 'No'}
- Bot/degen count: ${c.smartDegenCount}

Social:
- Twitter: ${c.twitter || 'none'}
- Website: ${c.website || 'none'}
- Telegram: ${c.telegram || 'none'}
- Holders: ${c.holderCount}
- Hot level: ${c.hotLevel}

Decision (BUY / WATCH / SKIP):`;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

export async function evaluateWithLlm(candidate: Candidate): Promise<LlmDecision | null> {
  if (!ENABLE_LLM) {
    return { verdict: 'BUY', confidence: 100, reason: 'LLM disabled' };
  }

  const minConfidence = numSetting('llm_min_confidence', LLM_MIN_CONFIDENCE);
  const apiKey = LLM_API_KEY || setting('llm_api_key');
  const baseUrl = LLM_BASE_URL || setting('llm_base_url', 'https://api.deepseek.com/v1');
  const model = LLM_MODEL || setting('llm_model', 'deepseek-v4-flash');

  if (!apiKey) {
    console.log('[llm] no API key; defaulting to BUY');
    return { verdict: 'BUY', confidence: 100, reason: 'No LLM key configured' };
  }

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: buildUserPrompt(candidate) },
        ],
        temperature: 0.1,
        max_tokens: 200,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[llm] API error ${res.status}: ${text}`);
      return null;
    }

    const body = await res.json() as any;
    const content = body?.choices?.[0]?.message?.content || '';

    const jsonMatch = content.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
      console.error(`[llm] no JSON in response: ${content}`);
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]) as LlmDecision;

    if (!['BUY', 'WATCH', 'SKIP'].includes(parsed.verdict)) {
      parsed.verdict = 'WATCH';
    }
    parsed.confidence = Math.max(0, Math.min(100, parsed.confidence || 0));

    return parsed;
  } catch (err) {
    console.error(`[llm] error: ${(err as Error).message}`);
    return null;
  }
}
