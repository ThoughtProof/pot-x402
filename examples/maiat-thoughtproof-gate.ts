/**
 * Combined Trust Gate: Maiat Reputation + ThoughtProof Decision Verification
 *
 * Before an agent transacts, this gate checks TWO layers:
 *   1. Maiat: Is this agent trustworthy? (behavioral reputation, 0-100)
 *   2. ThoughtProof: Is this specific decision well-justified? (reasoning quality)
 *
 * Both must pass. Reputation without decision quality is a name tag.
 * Decision quality without reputation is a ghost.
 *
 * Usage:
 *   npx tsx examples/maiat-thoughtproof-gate.ts
 *
 * Requires:
 *   - ANTHROPIC_API_KEY
 *   - DEEPSEEK_API_KEY (or any second provider)
 */

import { verify } from 'pot-sdk';

// ── Maiat Trust Check ──────────────────────────────────────────────────────

interface MaiatVerdict {
  address: string;
  score: number;
  verdict: 'proceed' | 'caution' | 'block';
  reviewCount?: number;
  contractAge?: number;
}

async function checkMaiatTrust(agentAddress: string): Promise<MaiatVerdict> {
  // Maiat API v2: app.maiat.io/api/v1/agent/{address}
  // Returns: { trustScore, verdict, dataSource, breakdown, erc8004 }
  const res = await fetch(
    `https://app.maiat.io/api/v1/agent/${agentAddress}`,
    { redirect: 'follow' },
  );

  if (!res.ok) {
    return { address: agentAddress, score: 0, verdict: 'block' };
  }

  const data = await res.json();
  return {
    address: agentAddress,
    score: data.trustScore ?? 0,
    verdict: data.verdict ?? 'unknown',
    reviewCount: data.breakdown?.reviewCount,
    contractAge: data.breakdown?.contractAge,
  };
}

// ── ThoughtProof Decision Verification ─────────────────────────────────────

interface DecisionContext {
  action: string;        // what the agent wants to do
  amount: string;        // how much
  counterparty: string;  // who they're transacting with
  reasoning: string;     // agent's stated reasoning
}

interface CombinedGateResult {
  // Layer 1: Maiat
  reputation: {
    score: number;
    verdict: string;
    passed: boolean;
  };
  // Layer 2: ThoughtProof
  decision: {
    confidence: number;
    verdict: string;
    passed: boolean;
    materiality?: {
      materialCount: number;
      notableCount: number;
      overallAssessment: string;
    };
  };
  // Combined
  allowed: boolean;
  reason: string;
}

async function combinedTrustGate(
  agentAddress: string,
  decision: DecisionContext,
  options: {
    reputationThreshold?: number;  // default 60
    stakeLevel?: 'micro' | 'low' | 'medium' | 'high' | 'critical';
    providers: Array<{ name: string; model: string; apiKey: string }>;
  }
): Promise<CombinedGateResult> {
  const repThreshold = options.reputationThreshold ?? 60;

  // ── Layer 1: Maiat Reputation ──────────────────────────────────────────
  console.log(`\n🔍 Layer 1: Checking Maiat reputation for ${agentAddress.slice(0, 10)}...`);
  const maiat = await checkMaiatTrust(agentAddress);

  const repPassed = maiat.score >= repThreshold;
  console.log(`   Score: ${maiat.score}/100 | Verdict: ${maiat.verdict} | ${repPassed ? '✅ PASS' : '❌ FAIL'}`);

  // If reputation fails, don't even check decision quality
  if (!repPassed) {
    return {
      reputation: { score: maiat.score, verdict: maiat.verdict, passed: false },
      decision: { confidence: 0, verdict: 'SKIPPED', passed: false },
      allowed: false,
      reason: `Agent reputation ${maiat.score}/100 below threshold ${repThreshold}. Transaction blocked.`,
    };
  }

  // ── Layer 2: ThoughtProof Decision Verification ────────────────────────
  console.log(`\n🧠 Layer 2: Verifying decision quality with ThoughtProof...`);

  const output = `AGENT TRANSACTION DECISION

Agent: ${agentAddress}
Maiat Reputation: ${maiat.score}/100 (${maiat.verdict})
Action: ${decision.action}
Amount: ${decision.amount}
Counterparty: ${decision.counterparty}

Agent's Stated Reasoning:
"${decision.reasoning}"`;

  // SECURITY: claim is a fixed template. Agent input (action, amount) goes into context only.
  const claim = `Is this agent's transaction decision well-justified? Evaluate the reasoning quality — not the reputation, which has already been checked.`;

  const stakeLevel = options.stakeLevel ?? 'medium';
  const thresholds: Record<string, number> = {
    micro: 0.40, low: 0.50, medium: 0.60, high: 0.75, critical: 0.85,
  };

  const result = await verify(output, {
    claim,
    domain: 'financial',
    providers: options.providers,
    stakeLevel,
    classifyMateriality: true,
    requireCitation: true,
    classifyObjections: true,
    context: {
      trusted: `Agent address: ${agentAddress}. Maiat trust score: ${maiat.score}/100 (${maiat.verdict}). Reputation check passed.`,
      toVerify: decision.reasoning,
    },
  });

  const threshold = thresholds[stakeLevel];
  const decPassed = result.confidence >= threshold;
  const mat = (result as any).materiality;

  console.log(`   Confidence: ${result.confidence} | Threshold: ${threshold} | ${decPassed ? '✅ ALLOW' : '⚠️ HOLD'}`);
  if (mat) {
    console.log(`   Materiality: ${mat.materialCount} material, ${mat.notableCount} notable | ${mat.overallAssessment}`);
  }

  return {
    reputation: { score: maiat.score, verdict: maiat.verdict, passed: true },
    decision: {
      confidence: result.confidence,
      verdict: decPassed ? 'ALLOW' : 'HOLD',
      passed: decPassed,
      materiality: mat ? {
        materialCount: mat.materialCount,
        notableCount: mat.notableCount,
        overallAssessment: mat.overallAssessment,
      } : undefined,
    },
    allowed: repPassed && decPassed,
    reason: decPassed
      ? `Reputation ✅ (${maiat.score}/100) + Decision ✅ (confidence ${result.confidence}). Transaction allowed.`
      : `Reputation ✅ (${maiat.score}/100) but Decision ⚠️ (confidence ${result.confidence} < ${threshold}). Transaction held for review.`,
  };
}

// ── Demo ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Maiat × ThoughtProof — Combined Trust Gate Demo');
  console.log('  Reputation (WHO) + Decision Quality (WHY)');
  console.log('═══════════════════════════════════════════════════════════════');

  const providers = [
    { name: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: process.env.ANTHROPIC_API_KEY! },
    { name: 'deepseek', model: 'deepseek-chat', apiKey: process.env.DEEPSEEK_API_KEY! },
  ];

  // ── Case 1: Good reputation + weak reasoning ──────────────────────────
  console.log('\n\n📋 CASE 1: Trusted agent, weak reasoning');
  console.log('─────────────────────────────────────────');

  // Use a well-known Base address for demo (Coinbase deployer)
  const result1 = await combinedTrustGate(
    '0x4200000000000000000000000000000000000006', // WETH on Base
    {
      action: 'swap 500 USDC for TokenXYZ',
      amount: '500 USDC',
      counterparty: 'TokenXYZ DEX Pool',
      reasoning: 'TokenXYZ looks promising. It has been trending on social media and several influencers mentioned it. The price has been going up for the past 3 days. I want to buy before it goes higher.',
    },
    { providers, stakeLevel: 'medium' },
  );

  console.log(`\n📊 Result: ${result1.allowed ? '✅ ALLOWED' : '⚠️ BLOCKED'}`);
  console.log(`   ${result1.reason}`);

  // ── Case 2: Good reputation + strong reasoning ─────────────────────────
  console.log('\n\n📋 CASE 2: Trusted agent, strong reasoning');
  console.log('─────────────────────────────────────────');

  const result2 = await combinedTrustGate(
    '0x4200000000000000000000000000000000000006',
    {
      action: 'provide 1000 USDC liquidity to ETH/USDC pool',
      amount: '1000 USDC',
      counterparty: 'Uniswap v3 ETH/USDC Pool',
      reasoning: 'Adding liquidity to the ETH/USDC pool on Uniswap v3 within the 2800-3200 range. This pool has $45M TVL, 0.05% fee tier, and 24h volume of $12M. Expected APR based on current fee generation: 8-12%. Position is within my risk budget of 5% portfolio allocation. The concentrated range matches current volatility estimates from Deribit options (30-day IV: 45%).',
    },
    { providers, stakeLevel: 'medium' },
  );

  console.log(`\n📊 Result: ${result2.allowed ? '✅ ALLOWED' : '⚠️ BLOCKED'}`);
  console.log(`   ${result2.reason}`);

  // ── Summary ────────────────────────────────────────────────────────────
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Case 1 (weak reasoning):  ${result1.allowed ? 'ALLOWED ❌' : 'BLOCKED ✅'} — ${result1.decision.verdict}`);
  console.log(`  Case 2 (strong reasoning): ${result2.allowed ? 'ALLOWED ✅' : 'BLOCKED ❌'} — ${result2.decision.verdict}`);
  console.log('');
  console.log('  Maiat answers:       Is this agent trustworthy?');
  console.log('  ThoughtProof answers: Is this decision well-justified?');
  console.log('  Together:            Complete trust gate.');
  console.log('═══════════════════════════════════════════════════════════════');
}

main().catch(console.error);
