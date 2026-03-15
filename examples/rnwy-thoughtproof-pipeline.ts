/**
 * RNWY → ThoughtProof Pipeline
 *
 * The complete trust verification flow:
 *   1. RNWY checks if the agent's reputation data is legitimate
 *   2. ThoughtProof verifies if the agent's decision is well-justified
 *   3. Only if both pass → transaction proceeds
 *
 * Usage:
 *   npx tsx examples/rnwy-thoughtproof-pipeline.ts
 */

import { checkRNWY, analyzeReviewers, reputationWeight, buildTrustedContext } from '../src/rnwy.js';
import { verify } from 'pot-sdk';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  RNWY → ThoughtProof Pipeline');
  console.log('  Reviewer Legitimacy → Decision Verification');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // ── Step 1: Check agent reputation legitimacy via RNWY ──────────────
  const agentId = 1380; // Captain Dackie — known sybil case
  console.log(`📋 Agent #${agentId} — Checking reviewer legitimacy via RNWY...\n`);

  const rnwy = await checkRNWY(agentId, 'base');
  const reviewers = await analyzeReviewers(agentId, 'base');
  const weight = reputationWeight(rnwy.score);

  console.log(`  Agent: ${rnwy.name}`);
  console.log(`  RNWY Score: ${rnwy.score}/100 (threshold: ${rnwy.threshold})`);
  console.log(`  Tier: ${rnwy.tier}`);
  console.log(`  Pass: ${rnwy.pass ? '✅' : '❌'}`);
  console.log(`  Badges: ${rnwy.badges.earned.join(', ') || 'none'}`);
  console.log(`  Warnings: ${rnwy.badges.warnings.join(', ') || 'none'}`);
  console.log(`  Reputation Weight: ${weight.toFixed(2)}`);
  console.log('');
  console.log(`  Reviews: ${reviewers.totalReviews} total, ${reviewers.uniqueReviewers} unique`);
  console.log(`  Same-day reviewers: ${reviewers.distribution.sameDay} (${reviewers.summary.sameDayPct}%)`);
  console.log(`  Low-history reviewers: ${reviewers.summary.lowHistoryPct}%`);

  // ── Step 2: Build trusted context with RNWY assessment ──────────────
  const trustedContext = buildTrustedContext(rnwy,
    'Agent wants to execute a $500 vendor selection for API services.'
  );

  console.log('\n─────────────────────────────────────────');
  console.log('Trusted Context for pot-sdk:');
  console.log(trustedContext);
  console.log('─────────────────────────────────────────\n');

  // ── Step 3: Decision Verification with ThoughtProof ─────────────────
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('⚠️  Skipping ThoughtProof verification (no ANTHROPIC_API_KEY set).');
    console.log('    Set ANTHROPIC_API_KEY + DEEPSEEK_API_KEY to run full pipeline.\n');
    console.log('    The RNWY data above would feed into pot-sdk verify() as:');
    console.log('    context.trusted = RNWY assessment');
    console.log('    The reputation weight (${weight.toFixed(2)}) determines how much');
    console.log('    the critic trusts reputation claims in its evaluation.\n');
  } else {
    console.log('🧠 Running ThoughtProof decision verification...\n');

    const result = await verify(
      'Agent recommends VendorXYZ for API services at $500/month.',
      {
        claim: 'Is this vendor selection justified for a $500 settlement?',
        domain: 'financial',
        providers: [
          { name: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: process.env.ANTHROPIC_API_KEY },
          { name: 'deepseek', model: 'deepseek-chat', apiKey: process.env.DEEPSEEK_API_KEY! },
        ],
        stakeLevel: 'medium',
        classifyMateriality: true,
        context: {
          trusted: trustedContext,
          toVerify: 'Agent recommends VendorXYZ based on "best features and competitive pricing."',
        },
      }
    );

    console.log(`  Confidence: ${result.confidence}`);
    console.log(`  Verdict: ${result.confidence >= 0.60 ? 'ALLOW' : 'HOLD'}`);
    const mat = (result as any).materiality;
    if (mat) {
      console.log(`  Materiality: ${mat.materialCount} material, ${mat.notableCount} notable`);
      console.log(`  Overall: ${mat.overallAssessment}`);
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  PIPELINE SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  RNWY:         Score ${rnwy.score}/100 → ${rnwy.pass ? 'PASS ✅' : 'FAIL ❌'} (${rnwy.tier})`);
  console.log(`  Rep Weight:   ${weight.toFixed(2)} (how much to trust reputation data)`);
  console.log(`  Sybil Signal: ${reviewers.summary.sameDayPct}% same-day reviewers`);
  console.log('');
  console.log('  RNWY filters the input.  ThoughtProof verifies the decision.');
  console.log('  Together: clean data in → sound verification out.');
  console.log('═══════════════════════════════════════════════════════════════');
}

main().catch(console.error);
