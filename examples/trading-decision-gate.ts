/**
 * Trading Decision Gate — Verify reasoning before autonomous trades execute
 *
 * The problem:
 *   An agent placed 6 Polymarket trades at 3:47AM while the user slept.
 *   $12K → $43K. Impressive. But no one verified whether the reasoning
 *   behind each trade was strong enough to justify autonomous execution.
 *
 * The solution:
 *   Before any trade executes, run pot-sdk to verify:
 *   - Is the trade thesis well-supported?
 *   - Were alternatives considered?
 *   - Is the position size proportional to conviction?
 *   - Are the risks acknowledged and acceptable?
 *
 * Optional: combine with Maiat (behavioral trust) and RNWY (sybil check)
 * for a complete trust stack before execution.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... DEEPSEEK_API_KEY=... npx tsx examples/trading-decision-gate.ts
 */

import { verify } from 'pot-sdk';
import type { StakeLevel } from 'pot-sdk';

// ── Types ───────────────────────────────────────────────────────────────────

interface TradeDecision {
  /** What the agent wants to do */
  action: 'buy' | 'sell' | 'swap' | 'provide_liquidity';
  /** Asset to trade */
  asset: string;
  /** Amount in USD equivalent */
  amountUsd: number;
  /** Platform (Binance, Polymarket, Uniswap, etc.) */
  platform: string;
  /** Agent's stated reasoning */
  reasoning: string;
  /** Optional: time of decision */
  timestamp?: string;
  /** Optional: is this during off-hours (user likely asleep)? */
  offHours?: boolean;
}

interface TradeVerificationResult {
  allowed: boolean;
  confidence: number;
  stakeLevel: StakeLevel;
  threshold: number;
  reasoning: string;
  materiality?: {
    materialCount: number;
    notableCount: number;
    minorCount: number;
    hasMaterialDefect: boolean;
    overallAssessment: string;
  };
  durationMs: number;
}

// ── Stake Level Detection ───────────────────────────────────────────────────

function detectTradeStakeLevel(trade: TradeDecision): StakeLevel {
  // Higher stakes for off-hours trades (no human oversight available)
  const offHoursMultiplier = trade.offHours ? 1.5 : 1.0;
  const effectiveAmount = trade.amountUsd * offHoursMultiplier;

  if (effectiveAmount <= 50) return 'micro';
  if (effectiveAmount <= 500) return 'low';
  if (effectiveAmount <= 5000) return 'medium';
  if (effectiveAmount <= 25000) return 'high';
  return 'critical';
}

const STAKE_THRESHOLDS: Record<StakeLevel, number> = {
  micro: 0.40,
  low: 0.50,
  medium: 0.60,
  high: 0.75,
  critical: 0.85,
};

// ── Verification ────────────────────────────────────────────────────────────

async function verifyTradeDecision(
  trade: TradeDecision,
  providers: Array<{ name: string; model: string; apiKey: string }>,
): Promise<TradeVerificationResult> {
  const startTime = Date.now();
  const stakeLevel = detectTradeStakeLevel(trade);
  const threshold = STAKE_THRESHOLDS[stakeLevel];

  const output = `TRADING DECISION REVIEW

Action: ${trade.action} ${trade.asset}
Amount: $${trade.amountUsd.toLocaleString()}
Platform: ${trade.platform}
Time: ${trade.timestamp || 'now'}
Off-hours: ${trade.offHours ? 'YES — user likely not monitoring' : 'no'}

Agent's reasoning:
"${trade.reasoning}"`;

  const claim = `Is this trading decision justified strongly enough to execute${trade.offHours ? ' autonomously while the user is not monitoring' : ''}?

Evaluate:
- Is the trade thesis supported by evidence, not just pattern or sentiment?
- Were alternatives considered (different asset, different size, wait)?
- Is the position size proportional to the strength of the reasoning?
- Are downside risks acknowledged?
- For off-hours trades: is the reasoning strong enough to justify execution without human review?`;

  const result = await verify(output, {
    claim,
    domain: 'financial',
    providers,
    stakeLevel,
    classifyMateriality: true,
    requireCitation: true,
    context: {
      trusted: `Platform: ${trade.platform}. Amount: $${trade.amountUsd}. Asset: ${trade.asset}.`,
      toVerify: trade.reasoning,
    },
  });

  const mat = (result as any).materiality;

  return {
    allowed: result.confidence >= threshold,
    confidence: result.confidence,
    stakeLevel,
    threshold,
    reasoning: typeof result.synthesis === 'string'
      ? result.synthesis.slice(0, 500)
      : (result.synthesis as any)?.content?.slice(0, 500) || '',
    materiality: mat ? {
      materialCount: mat.materialCount,
      notableCount: mat.notableCount,
      minorCount: mat.minorCount,
      hasMaterialDefect: mat.hasMaterialDefect,
      overallAssessment: mat.overallAssessment,
    } : undefined,
    durationMs: Date.now() - startTime,
  };
}

// ── Demo ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Trading Decision Gate — Verify Before Execute');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const providers = [
    { name: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: process.env.ANTHROPIC_API_KEY! },
    { name: 'deepseek', model: 'deepseek-chat', apiKey: process.env.DEEPSEEK_API_KEY! },
  ];

  // ── Case 1: Weak reasoning, off-hours ────────────────────────────────
  console.log('📋 CASE 1: Weak reasoning, off-hours trade');
  console.log('─────────────────────────────────────────\n');

  const weak: TradeDecision = {
    action: 'buy',
    asset: 'ETH',
    amountUsd: 5000,
    platform: 'Binance',
    timestamp: '3:47 AM',
    offHours: true,
    reasoning: 'ETH has been trending up for 3 days. Social sentiment is very positive. Several influencers mentioned it will hit $4K soon. Buying before it goes higher.',
  };

  console.log(`  ${weak.action} $${weak.amountUsd} ${weak.asset} on ${weak.platform} at ${weak.timestamp}`);
  console.log(`  Off-hours: ${weak.offHours ? '⚠️ YES' : 'no'}`);
  console.log(`  Reasoning: "${weak.reasoning.slice(0, 80)}..."\n`);

  if (process.env.ANTHROPIC_API_KEY) {
    const r1 = await verifyTradeDecision(weak, providers);
    console.log(`  Stake: ${r1.stakeLevel} (off-hours multiplier applied)`);
    console.log(`  Confidence: ${r1.confidence} | Threshold: ${r1.threshold}`);
    console.log(`  Verdict: ${r1.allowed ? '✅ ALLOW' : '⚠️ HOLD'}`);
    if (r1.materiality) {
      console.log(`  Materiality: ${r1.materialCount} material | ${r1.overallAssessment}`);
    }
  } else {
    const stakeLevel = detectTradeStakeLevel(weak);
    console.log(`  [DRY RUN — no API keys]`);
    console.log(`  Stake: ${stakeLevel} (off-hours: $5K × 1.5 = $7.5K effective → high)`);
    console.log(`  Threshold: ${STAKE_THRESHOLDS[stakeLevel]}`);
    console.log(`  Expected: HOLD — reasoning is sentiment-based, no evidence`);
  }

  // ── Case 2: Strong reasoning, normal hours ───────────────────────────
  console.log('\n\n📋 CASE 2: Strong reasoning, normal hours');
  console.log('─────────────────────────────────────────\n');

  const strong: TradeDecision = {
    action: 'swap',
    asset: 'USDC → ETH',
    amountUsd: 2000,
    platform: 'Uniswap',
    offHours: false,
    reasoning: 'ETH/USDC at $2,850, below 200-day MA ($3,100). RSI 32 (oversold). On-chain metrics: exchange reserves at 6-month low, whale accumulation up 12% in 7 days. Funding rates negative (shorts crowded). Position: 4% of portfolio, within risk budget. Stop loss at $2,650 (-7%). Target $3,200 (+12%). Risk/reward: 1.7:1.',
  };

  console.log(`  ${strong.action} $${strong.amountUsd} ${strong.asset} on ${strong.platform}`);
  console.log(`  Off-hours: ${strong.offHours ? '⚠️ YES' : 'no'}`);
  console.log(`  Reasoning: "${strong.reasoning.slice(0, 80)}..."\n`);

  if (process.env.ANTHROPIC_API_KEY) {
    const r2 = await verifyTradeDecision(strong, providers);
    console.log(`  Stake: ${r2.stakeLevel}`);
    console.log(`  Confidence: ${r2.confidence} | Threshold: ${r2.threshold}`);
    console.log(`  Verdict: ${r2.allowed ? '✅ ALLOW' : '⚠️ HOLD'}`);
    if (r2.materiality) {
      console.log(`  Materiality: ${r2.materialCount} material | ${r2.overallAssessment}`);
    }
  } else {
    const stakeLevel = detectTradeStakeLevel(strong);
    console.log(`  [DRY RUN — no API keys]`);
    console.log(`  Stake: ${stakeLevel}`);
    console.log(`  Threshold: ${STAKE_THRESHOLDS[stakeLevel]}`);
    console.log(`  Expected: ALLOW — thesis supported by data, risk managed, sized proportionally`);
  }

  // ── Summary ──────────────────────────────────────────────────────────
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('  KEY INSIGHT');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  Both trades are authorized. Both are within spending limits.');
  console.log('  Both pass identity and fraud checks.');
  console.log('');
  console.log('  The difference is reasoning quality.');
  console.log('');
  console.log('  Case 1: "influencers said buy" → HOLD');
  console.log('  Case 2: data-backed thesis + risk management → ALLOW');
  console.log('');
  console.log('  Off-hours trades get higher scrutiny because');
  console.log('  no human is watching to catch a bad decision.');
  console.log('');
  console.log('  Right outcome + unverified reasoning = luck, not trust.');
  console.log('═══════════════════════════════════════════════════════════════');
}

main().catch(console.error);
