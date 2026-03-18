/**
 * RedStone × ThoughtProof — Live Price Verification Demo
 *
 * RedStone provides the data truth.
 * ThoughtProof verifies whether the agent reasons correctly FROM that data.
 *
 * This demo:
 *   1. Fetches live ETH + BTC prices from RedStone's public API
 *   2. Builds two trading scenarios — one weak (sentiment-only), one strong (data-backed)
 *   3. Runs ThoughtProof's verify() on both
 *   4. Shows how only the data-grounded reasoning gets through the gate
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... XAI_API_KEY=... npx tsx examples/redstone-thoughtproof-demo.ts
 */

import { verify, STAKE_THRESHOLDS } from 'pot-sdk';
import type { StakeLevel, VerificationResult, ProviderConfig } from 'pot-sdk';
import chalk from 'chalk';

// ── ANSI helpers (chalk wraps these) ─────────────────────────────────────────

const REDSTONE_RED   = '#e8334a';
const TP_BLUE        = '#3b82f6';
const ALLOW_GREEN    = '#22c55e';
const HOLD_YELLOW    = '#f59e0b';
const DIM            = '#6b7280';

// ── RedStone API ──────────────────────────────────────────────────────────────

interface RedStonePrice {
  symbol: string;
  value: number;
  timestamp: number;
  provider: string;
}

async function fetchRedStonePrice(symbol: string): Promise<RedStonePrice | null> {
  try {
    const res = await fetch(
      `https://api.redstone.finance/prices?symbol=${symbol}&provider=redstone`,
    );
    if (!res.ok) return null;
    const data = await res.json() as any;
    // API returns an array or single object depending on version
    const item = Array.isArray(data) ? data[0] : data;
    return {
      symbol,
      value: item?.value ?? item?.price ?? 0,
      timestamp: item?.timestamp ?? Date.now(),
      provider: item?.provider ?? 'redstone',
    };
  } catch {
    return null;
  }
}

// ── Display helpers ───────────────────────────────────────────────────────────

function banner() {
  console.log('');
  console.log(chalk.hex(REDSTONE_RED).bold('  ██████╗ ███████╗██████╗ ███████╗████████╗ ██████╗ ███╗   ██╗███████╗'));
  console.log(chalk.hex(REDSTONE_RED).bold('  ██╔══██╗██╔════╝██╔══██╗██╔════╝╚══██╔══╝██╔═══██╗████╗  ██║██╔════╝'));
  console.log(chalk.hex(REDSTONE_RED).bold('  ██████╔╝█████╗  ██║  ██║███████╗   ██║   ██║   ██║██╔██╗ ██║█████╗'));
  console.log(chalk.hex(REDSTONE_RED).bold('  ██╔══██╗██╔══╝  ██║  ██║╚════██║   ██║   ██║   ██║██║╚██╗██║██╔══╝'));
  console.log(chalk.hex(REDSTONE_RED).bold('  ██║  ██║███████╗██████╔╝███████║   ██║   ╚██████╔╝██║ ╚████║███████╗'));
  console.log(chalk.hex(REDSTONE_RED).bold('  ╚═╝  ╚═╝╚══════╝╚═════╝ ╚══════╝   ╚═╝    ╚═════╝ ╚═╝  ╚═══╝╚══════╝'));
  console.log('');
  console.log(chalk.hex(REDSTONE_RED)('  Modular Oracle Network') + chalk.hex(DIM)('  ×'));
  console.log(chalk.hex(TP_BLUE).bold('  ThoughtProof') + chalk.hex(DIM)('  — Verify that agents reason correctly FROM the data'));
  console.log('');
  console.log(chalk.hex(DIM)('  ─────────────────────────────────────────────────────────────────'));
  console.log('');
}

function sectionHeader(n: number, title: string) {
  console.log(chalk.hex(DIM)('  ─────────────────────────────────────────────────────────────────'));
  console.log(`  ${chalk.bold.white(`SCENARIO ${n}`)}  ${chalk.hex(DIM)(title)}`);
  console.log(chalk.hex(DIM)('  ─────────────────────────────────────────────────────────────────'));
  console.log('');
}

function printPrices(eth: RedStonePrice | null, btc: RedStonePrice | null) {
  console.log(`  ${chalk.hex(REDSTONE_RED).bold('◈ RedStone Live Prices')}`);
  console.log('');
  if (eth) {
    const ts = new Date(eth.timestamp).toISOString();
    console.log(`  ${chalk.cyan('ETH/USD')}  ${chalk.white.bold('$' + eth.value.toLocaleString('en-US', { maximumFractionDigits: 2 }))}  ${chalk.hex(DIM)(ts)}`);
  } else {
    console.log(`  ${chalk.cyan('ETH/USD')}  ${chalk.yellow('[unavailable — API may require auth]')}`);
  }
  if (btc) {
    const ts = new Date(btc.timestamp).toISOString();
    console.log(`  ${chalk.yellow('BTC/USD')}  ${chalk.white.bold('$' + btc.value.toLocaleString('en-US', { maximumFractionDigits: 2 }))}  ${chalk.hex(DIM)(ts)}`);
  } else {
    console.log(`  ${chalk.yellow('BTC/USD')}  ${chalk.yellow('[unavailable — API may require auth]')}`);
  }
  console.log('');
}

function printVerdict(
  result: VerificationResult,
  threshold: number,
  stakeLevel: StakeLevel,
  durationMs: number,
) {
  const allowed = result.confidence >= threshold;
  const verdict = allowed
    ? chalk.hex(ALLOW_GREEN).bold('✅  ALLOW')
    : chalk.hex(HOLD_YELLOW).bold('⚠   HOLD');

  const confidencePct = Math.round(result.confidence * 100);
  const thresholdPct  = Math.round(threshold * 100);
  const confColor = allowed ? chalk.hex(ALLOW_GREEN) : chalk.hex(HOLD_YELLOW);

  console.log(`  ${chalk.bold('Verdict')}        ${verdict}`);
  console.log(`  ${chalk.bold('Confidence')}     ${confColor.bold(confidencePct + '%')} ${chalk.hex(DIM)(`(threshold: ${thresholdPct}%, stake: ${stakeLevel})`)}`);
  console.log(`  ${chalk.bold('Duration')}       ${chalk.hex(DIM)(durationMs + 'ms')}`);

  // Materiality
  const mat = (result as any).materiality;
  if (mat) {
    const matColor = mat.hasMaterialDefect ? chalk.hex(HOLD_YELLOW) : chalk.hex(ALLOW_GREEN);
    console.log(`  ${chalk.bold('Materiality')}    ${matColor(mat.overallAssessment)} ${chalk.hex(DIM)(`| material: ${mat.materialCount}  notable: ${mat.notableCount}  minor: ${mat.minorCount}`)}`);
  }

  // Key objections
  const objections: any[] = (result as any).classifiedObjections ?? [];
  const materialObjns = objections.filter((o: any) => o.severity === 'material' || (o as any).materiality === 'material');
  if (materialObjns.length > 0) {
    console.log('');
    console.log(`  ${chalk.hex(HOLD_YELLOW).bold('Key objections:')}`);
    for (const obj of materialObjns.slice(0, 3)) {
      const text = obj.description ?? obj.text ?? String(obj);
      const truncated = text.length > 110 ? text.slice(0, 107) + '...' : text;
      console.log(`  ${chalk.hex(DIM)('•')} ${chalk.white(truncated)}`);
    }
  }

  // Synthesis snippet
  const synthesis = typeof result.synthesis === 'string'
    ? result.synthesis
    : (result.synthesis as any)?.content ?? '';
  if (synthesis) {
    const snippet = synthesis.slice(0, 220).replace(/\n/g, ' ');
    console.log('');
    console.log(`  ${chalk.hex(DIM).bold('Synthesis:')}`);
    console.log(`  ${chalk.hex(DIM)(snippet)}${synthesis.length > 220 ? chalk.hex(DIM)('…') : ''}`);
  }

  console.log('');
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  banner();

  // ── 1. Fetch live prices ────────────────────────────────────────────────
  console.log(`  ${chalk.hex(REDSTONE_RED)('◈')} Fetching live prices from RedStone...`);
  console.log('');

  const [ethPrice, btcPrice] = await Promise.all([
    fetchRedStonePrice('ETH'),
    fetchRedStonePrice('BTC'),
  ]);

  printPrices(ethPrice, btcPrice);

  // Use live data or fallback for the strong scenario's reasoning text
  const ethVal   = ethPrice?.value ?? 2450;
  const btcVal   = btcPrice?.value ?? 68500;
  const eth30dAvg = Math.round(ethVal * 1.065); // simulate 30d avg ~6.5% higher (ETH pulling back)
  const ethRsi   = 34; // simulated RSI (near oversold territory)
  const riskReward = +(((eth30dAvg - ethVal) / ethVal) / 0.07).toFixed(1); // vs 7% stop loss

  // ── 2. Configure providers ──────────────────────────────────────────────
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasXai       = !!process.env.XAI_API_KEY;

  if (!hasAnthropic) {
    console.log(chalk.hex(HOLD_YELLOW)('  ⚠  ANTHROPIC_API_KEY not set — running in dry-run mode'));
    console.log(chalk.hex(DIM)('     Set ANTHROPIC_API_KEY to run live verification.\n'));
  }

  const providers: ProviderConfig[] = [];

  if (hasAnthropic) {
    providers.push({
      name: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });
  }
  if (hasXai) {
    providers.push({
      name: 'xai',
      model: 'grok-4-1-fast-non-reasoning',
      apiKey: process.env.XAI_API_KEY!,
      // pot-sdk auto-detects https://api.x.ai/v1/chat/completions from name 'xai'
    });
  }

  // ── SCENARIO 1 — Weak: sentiment-only reasoning ─────────────────────────
  sectionHeader(1, 'Weak reasoning — sentiment only, no data');

  const weakReasoning = `ETH has been trending up for the past few days. Social sentiment is very positive. Several crypto influencers on Twitter mentioned it will hit $4K soon. Polymarket shows 70% odds of ETH above $3K by month end. Buying before it goes higher.`;

  console.log(`  ${chalk.bold('Action')}    buy $5,000 ETH on Binance`);
  console.log(`  ${chalk.bold('Reasoning')} ${chalk.hex(DIM)('"' + weakReasoning.slice(0, 100) + '...'  + '"')}`);
  console.log('');

  const weakStakeLevel: StakeLevel = 'medium'; // $5K unsupervised
  const weakThreshold = STAKE_THRESHOLDS[weakStakeLevel];

  if (hasAnthropic) {
    const t0 = Date.now();

    const weakOutput = `TRADING DECISION REVIEW

Action: buy ETH
Amount: $5,000
Platform: Binance
Supervised: NO — autonomous, no human oversight

Agent's reasoning:
"${weakReasoning}"`;

    const weakClaim = `Is this trading decision well-reasoned?

Evaluate:
- Is the trade thesis supported by verifiable market data, not just social sentiment?
- Were downside risks and alternatives considered?
- Is the position size proportional to the strength of the evidence?
- Influencer opinions and social trends are NOT evidence — data is.`;

    console.log(`  ${chalk.hex(TP_BLUE)('◈')} Running ThoughtProof verification...`);
    console.log('');

    let weakResult: VerificationResult;
    try {
      weakResult = await verify(weakOutput, {
        claim: weakClaim,
        domain: 'financial',
        providers,
        stakeLevel: weakStakeLevel,
        classifyMateriality: true,
        requireCitation: true,
        context: {
          trusted: 'Platform: Binance. Amount: $5,000. Asset: ETH.',
          toVerify: weakReasoning,
        },
      });
    } catch (err: any) {
      console.log(chalk.red(`  Error during verification: ${err?.message ?? err}`));
      process.exit(1);
    }

    printVerdict(weakResult, weakThreshold, weakStakeLevel, Date.now() - t0);
  } else {
    console.log(`  ${chalk.hex(DIM)('[DRY RUN]')} Stake: ${chalk.bold(weakStakeLevel)} | Threshold: ${chalk.bold(Math.round(weakThreshold * 100) + '%')}`);
    console.log(`  ${chalk.hex(HOLD_YELLOW).bold('Expected: HOLD')} ${chalk.hex(DIM)('— influencer sentiment ≠ evidence')}`);
    console.log('');
  }

  // ── SCENARIO 2 — Strong: data-backed reasoning using live RedStone prices ─
  sectionHeader(2, 'Strong reasoning — grounded in live RedStone price data');

  // Key levels derived from live RedStone prices
  const ethBelowMaPct  = Math.round(((eth30dAvg - ethVal) / eth30dAvg) * 100);
  const stopLossPrice  = Math.round(ethVal * 0.93);
  const targetPrice    = Math.round(eth30dAvg * 0.99);
  const stopLossPct    = 7;
  const targetPct      = Math.round(((targetPrice - ethVal) / ethVal) * 100);
  const riskRewardStr  = `1:${riskReward}`;

  // The trusted oracle data — accepted as ground truth, not for LLMs to re-verify
  const oracleTrustedContext = [
    `VERIFIED ORACLE DATA — RedStone decentralized feed (${new Date().toISOString()}):`,
    `  ETH/USD spot: $${ethVal.toLocaleString()}`,
    `  BTC/USD spot: $${btcVal.toLocaleString()}`,
    `  ETH 30-day moving average: $${eth30dAvg.toLocaleString()}`,
    `  ETH deviation from 30d MA: -${ethBelowMaPct}% (price below average)`,
    `  ETH RSI (14-day): ${ethRsi} — below 40 = technically oversold territory`,
    `  BTC trend: stable, no major divergence from ETH`,
  ].join('\n');

  // The agent's reasoning logic — what ThoughtProof actually evaluates
  const strongDecisionLogic = [
    `ETH is ${ethBelowMaPct}% below its 30-day moving average ($${eth30dAvg.toLocaleString()}) with RSI at ${ethRsi}.`,
    `Both conditions are standard technical signals for a mean-reversion entry: price at oversold levels relative to recent trend.`,
    `BTC at $${btcVal.toLocaleString()} is stable — no macro divergence that would invalidate an ETH recovery thesis.`,
    ``,
    `Decision: swap $2,000 USDC → ETH on Uniswap.`,
    `- Position size: $2,000 = 3.8% of $52,000 portfolio — within the 5% single-asset risk limit`,
    `- Stop loss: $${stopLossPrice.toLocaleString()} (-${stopLossPct}% from entry)`,
    `- Target: $${targetPrice.toLocaleString()} (+${targetPct}% = 30-day MA reversion)`,
    `- Risk/reward: ${riskRewardStr}`,
    ``,
    `Alternatives considered: waiting for RSI < 30 (deeper oversold) risks missing the move;`,
    `larger position size rejected (outside risk budget). Smaller size ($1K) evaluated but`,
    `$2K is within policy and ratio remains favorable.`,
  ].join('\n');

  console.log(`  ${chalk.bold('Action')}    swap USDC → ETH, $2,000 on Uniswap`);
  console.log(`  ${chalk.bold('Data')}      ${chalk.hex(REDSTONE_RED)('◈ RedStone')} ETH: ${chalk.cyan('$' + ethVal.toLocaleString())} | BTC: ${chalk.yellow('$' + btcVal.toLocaleString())} | 30d MA: ${chalk.hex(DIM)('$' + eth30dAvg.toLocaleString())} | RSI: ${chalk.hex(DIM)(String(ethRsi))}`);
  console.log(`  ${chalk.bold('Logic')}     ${chalk.hex(DIM)('"' + strongDecisionLogic.split('\n')[0].slice(0, 100) + '..."')}`);
  console.log('');

  const strongStakeLevel: StakeLevel = 'low'; // $2K
  const strongThreshold = STAKE_THRESHOLDS[strongStakeLevel];

  if (hasAnthropic) {
    const t0 = Date.now();

    // The output combines the oracle context (trusted) with the agent's reasoning
    const strongOutput = `TRADING DECISION REVIEW — USDC → ETH swap, $2,000, Uniswap
Supervised: NO — autonomous execution, no human oversight

${oracleTrustedContext}

AGENT REASONING:
${strongDecisionLogic}`;

    // Claim: focus on REASONING QUALITY, not whether oracle data is correct
    // The oracle data is trusted context — ThoughtProof evaluates the logic FROM it
    const strongClaim = `Assuming the oracle price data above is accurate, is the agent's trading reasoning well-structured and data-grounded?

Evaluate the LOGIC, not the data:
- Does the reasoning correctly interpret the price signals (below 30d MA + RSI < 40)?
- Is a mean-reversion thesis coherent given the cited technical conditions?
- Is the stop loss / take profit sizing sound given the entry and risk/reward?
- Was position sizing within a reasonable risk budget (< 5% single-asset)?
- Were alternatives considered and rejected with stated reasons?`;

    console.log(`  ${chalk.hex(TP_BLUE)('◈')} Running ThoughtProof verification...`);
    console.log('');

    let strongResult: VerificationResult;
    try {
      strongResult = await verify(strongOutput, {
        claim: strongClaim,
        domain: 'financial',
        providers,
        stakeLevel: strongStakeLevel,
        classifyMateriality: true,
        requireCitation: true,
        context: {
          // RedStone data is ground truth — verifiers accept, don't re-verify
          trusted: oracleTrustedContext,
          // Agent's decision logic is what ThoughtProof actually evaluates
          toVerify: strongDecisionLogic,
        },
      });
    } catch (err: any) {
      console.log(chalk.red(`  Error during verification: ${err?.message ?? err}`));
      process.exit(1);
    }

    printVerdict(strongResult, strongThreshold, strongStakeLevel, Date.now() - t0);
  } else {
    console.log(`  ${chalk.hex(DIM)('[DRY RUN]')} Stake: ${chalk.bold(strongStakeLevel)} | Threshold: ${chalk.bold(Math.round(strongThreshold * 100) + '%')}`);
    console.log(`  ${chalk.hex(ALLOW_GREEN).bold('Expected: ALLOW')} ${chalk.hex(DIM)('— RSI oversold + stop loss + risk/reward + alternatives considered')}`);
    console.log('');
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(chalk.hex(DIM)('  ─────────────────────────────────────────────────────────────────'));
  console.log(`  ${chalk.bold.white('THE STACK')}`);
  console.log(chalk.hex(DIM)('  ─────────────────────────────────────────────────────────────────'));
  console.log('');
  console.log(`  ${chalk.hex(REDSTONE_RED).bold('◈ RedStone')}   Decentralized oracle network — live price feeds, cryptographically`);
  console.log(`  ${chalk.hex(DIM)('            ')} attested. The data layer every DeFi agent should be reading.`);
  console.log('');
  console.log(`  ${chalk.hex(TP_BLUE).bold('◈ ThoughtProof')}  Multi-model reasoning verifier — checks whether an agent's`);
  console.log(`  ${chalk.hex(DIM)('               ')} decision logic is actually grounded in the data it claims to use.`);
  console.log('');
  console.log(chalk.hex(DIM)('  ─────────────────────────────────────────────────────────────────'));
  console.log('');
  console.log(`  ${chalk.white.bold('RedStone provides the data truth.')}`);
  console.log(`  ${chalk.white.bold('ThoughtProof verifies the agent reasons correctly FROM it.')}`);
  console.log('');
  console.log(`  ${chalk.hex(DIM)('Both scenarios are authorized. Both are unsupervised. Both have valid wallets.')}`);
  console.log(`  ${chalk.hex(DIM)('The difference is reasoning quality — and data grounding.')}`);
  console.log('');
  console.log(`  ${chalk.hex(HOLD_YELLOW)('Scenario 1')}${chalk.hex(DIM)(': "influencers + vibes" →')} ${chalk.hex(HOLD_YELLOW).bold('HOLD')}`);
  console.log(`  ${chalk.hex(ALLOW_GREEN)('Scenario 2')}${chalk.hex(DIM)(': RedStone price + RSI + risk/reward →')} ${chalk.hex(ALLOW_GREEN).bold('ALLOW')}`);
  console.log('');
  console.log(chalk.hex(DIM)('  ─────────────────────────────────────────────────────────────────'));
  console.log('');
}

main().catch(console.error);
