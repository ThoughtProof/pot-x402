/**
 * @pot-sdk2/x402 — ThoughtProof Decision Verification Hook for x402
 *
 * Sits between facilitator.verify() and facilitator.settle() in the x402 payment flow.
 * Verifies whether an agent's payment decision is well-justified before settlement executes.
 *
 * Usage:
 *   import { createThoughtProofHook } from '@pot-sdk2/x402';
 *   import { x402Facilitator } from '@x402/core/facilitator';
 *
 *   const facilitator = new x402Facilitator();
 *   facilitator.onBeforeSettle(createThoughtProofHook({
 *     providers: [...],
 *     stakeLevel: 'medium',
 *   }));
 *
 * The hook:
 * - Runs pot-sdk verify() on the payment context
 * - If confidence >= threshold for stake level → settlement proceeds
 * - If confidence < threshold → settlement aborted with reason
 *
 * Credit: ThoughtProof Protocol (thoughtproof.ai)
 * License: MIT
 */

import { verify } from 'pot-sdk';

// Re-export RNWY integration (reviewer legitimacy)
export { checkRNWY, analyzeReviewers, reputationWeight, buildTrustedContext, weightedReviewerScore, buildDeepTrustedContext, REVIEWER_WEIGHTS } from './rnwy.js';
export type { RNWYTrustCheck, RNWYReviewerAnalysis, RNWYReviewer } from './rnwy.js';

// Re-export Maiat integration (behavioral trust scoring)
export { checkMaiat, checkMaiatByAddress, getMaiatAgents, maiatReputationWeight, buildMaiatContext } from './maiat.js';
export type { MaiatAgentCheck, MaiatAgentLookup } from './maiat.js';

// Re-export ERC-8183 integration (agentic commerce hooks)
export { verifyJobCompletion, verifyJobRejection, ERC8183_SELECTORS } from './erc8183/index.js';
export type { JobContext, JobState, HookVerificationResult, ERC8183HookOptions } from './erc8183/index.js';

// Re-export OriginDAO integration (agent identity + trust grades)
export { checkOrigin, originTrustWeight, buildOriginContext } from './origin.js';
export type { OriginAgentLookup, OriginTrustStatus } from './origin.js';

// Re-export Trust Feedback Loop (Maiat outcome reporting)
// Credit: @JhiNResH (GitHub issue #1, feature request #4)
export { reportToMaiat, createMaiatFeedback } from './feedback.js';
export type { FeedbackConfig, VerificationOutcome, FeedbackResult } from './feedback.js';
import type { StakeLevel, TrustContext } from 'pot-sdk';

// Re-export for convenience
export type { StakeLevel, TrustContext };

/**
 * Stake-level thresholds (same as pot-sdk v1.2)
 */
const STAKE_THRESHOLDS: Record<StakeLevel, number> = {
  micro: 0.40,
  low: 0.50,
  medium: 0.60,
  high: 0.75,
  critical: 0.85,
};

/**
 * Provider configuration for the verification models
 */
export interface ProviderConfig {
  name: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

/**
 * Options for the ThoughtProof x402 hook
 */
export interface ThoughtProofHookOptions {
  /** Model providers for multi-model verification */
  providers: ProviderConfig[];

  /** Stake level — controls confidence threshold and critic depth */
  stakeLevel?: StakeLevel;

  /** Custom threshold override (ignores stakeLevel if set) */
  threshold?: number;

  /** Domain profile for verification */
  domain?: 'financial' | 'medical' | 'general';

  /** Enable materiality classification (v1.2.1) */
  classifyMateriality?: boolean;

  /**
   * Custom claim/question template. Use {amount}, {payee}, {description} as placeholders.
   * SECURITY: this must come from the deployer/orchestrator config, NOT from agent input.
   * If an agent can set its own claimTemplate, it can manipulate the verifier prompt.
   */
  claimTemplate?: string;

  /** Trust context — what to accept as given vs what to verify */
  context?: TrustContext;

  /** Called when verification completes (for logging/monitoring) */
  onVerification?: (result: ThoughtProofVerificationResult) => void;

  /** If true, log verification results to console */
  debug?: boolean;
}

/**
 * Result from ThoughtProof verification within x402 flow
 */
export interface ThoughtProofVerificationResult {
  /** Whether the payment decision was allowed */
  allowed: boolean;
  /** Confidence score from pot-sdk */
  confidence: number;
  /** Threshold that was applied */
  threshold: number;
  /** Stake level used */
  stakeLevel: StakeLevel;
  /** Summary of verification */
  synthesis?: string;
  /** Materiality data if enabled */
  materiality?: {
    materialCount: number;
    notableCount: number;
    minorCount: number;
    hasMaterialDefect: boolean;
    overallAssessment: string;
  };
  /** Duration in ms */
  durationMs: number;
}

/**
 * Extract payment context from x402 payment payload for verification
 */
function buildVerificationClaim(
  paymentPayload: any,
  requirements: any,
  template?: string,
): { output: string; claim: string } {
  // Extract what we can from x402 payload
  const amount = requirements?.maxAmountRequired || paymentPayload?.amount || 'unknown';
  const payee = requirements?.payTo || 'unknown';
  const description = requirements?.description || paymentPayload?.description || 'x402 payment';
  const network = requirements?.network || paymentPayload?.network || 'unknown';
  const scheme = requirements?.scheme || paymentPayload?.scheme || 'unknown';

  const output = `x402 PAYMENT DECISION REVIEW

Payment: ${amount} (${scheme} on ${network})
Payee: ${payee}
Description: ${description}
Protocol: x402 v${paymentPayload?.x402Version || 2}`;

  const claim = template
    ? template
        .replace('{amount}', String(amount))
        .replace('{payee}', String(payee))
        .replace('{description}', description)
    : `Is this x402 payment of ${amount} to ${payee} for "${description}" justified? Evaluate whether the payment amount is proportional to the service, whether the payee is appropriate, and whether there are any material reasons this payment should not proceed.`;

  return { output, claim };
}

/**
 * Creates a ThoughtProof beforeSettle hook for x402Facilitator.
 *
 * @example
 * ```typescript
 * import { createThoughtProofHook } from '@pot-sdk2/x402';
 * import { x402Facilitator } from '@x402/core/facilitator';
 *
 * const facilitator = new x402Facilitator();
 *
 * // Register your scheme...
 * facilitator.register(networks, schemeFacilitator);
 *
 * // Add ThoughtProof decision verification before settlement
 * facilitator.onBeforeSettle(createThoughtProofHook({
 *   providers: [
 *     { name: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: process.env.ANTHROPIC_API_KEY! },
 *     { name: 'deepseek', model: 'deepseek-chat', apiKey: process.env.DEEPSEEK_API_KEY! },
 *   ],
 *   stakeLevel: 'medium',
 *   classifyMateriality: true,
 *   debug: true,
 * }));
 *
 * // Now facilitator.settle() will verify decision quality before executing
 * ```
 */
export function createThoughtProofHook(options: ThoughtProofHookOptions) {
  const stakeLevel = options.stakeLevel || 'medium';
  const threshold = options.threshold ?? STAKE_THRESHOLDS[stakeLevel];

  return async (context: { paymentPayload: any; requirements: any }): Promise<void | { abort: true; reason: string }> => {
    const startTime = Date.now();

    try {
      const { output, claim } = buildVerificationClaim(
        context.paymentPayload,
        context.requirements,
        options.claimTemplate,
      );

      if (options.debug) {
        console.log(`[pot-x402] Verifying payment decision (stakeLevel: ${stakeLevel}, threshold: ${threshold})`);
      }

      const result = await verify(output, {
        claim,
        domain: options.domain || 'financial',
        providers: options.providers,
        stakeLevel,
        context: options.context,
        classifyMateriality: options.classifyMateriality ?? true,
        requireCitation: true,
        classifyObjections: true,
      });

      const durationMs = Date.now() - startTime;
      const allowed = result.confidence >= threshold;

      const verificationResult: ThoughtProofVerificationResult = {
        allowed,
        confidence: result.confidence,
        threshold,
        stakeLevel,
        synthesis: typeof result.synthesis === 'string'
          // Store full synthesis for audit trail (fix: @JhiNResH #1)
          ? result.synthesis
          : (result.synthesis as any)?.content || '',
        materiality: (result as any).materiality
          ? {
              materialCount: (result as any).materiality.materialCount,
              notableCount: (result as any).materiality.notableCount,
              minorCount: (result as any).materiality.minorCount,
              hasMaterialDefect: (result as any).materiality.hasMaterialDefect,
              overallAssessment: (result as any).materiality.overallAssessment,
            }
          : undefined,
        durationMs,
      };

      if (options.debug) {
        console.log(`[pot-x402] Verification complete: confidence=${result.confidence}, threshold=${threshold}, allowed=${allowed}, duration=${durationMs}ms`);
        if (verificationResult.materiality) {
          console.log(`[pot-x402] Materiality: ${verificationResult.materiality.materialCount} material, ${verificationResult.materiality.notableCount} notable, ${verificationResult.materiality.minorCount} minor, overall=${verificationResult.materiality.overallAssessment}`);
        }
      }

      options.onVerification?.(verificationResult);

      if (!allowed) {
        return {
          abort: true,
          reason: `ThoughtProof HOLD: confidence ${result.confidence.toFixed(2)} below threshold ${threshold} (stakeLevel: ${stakeLevel}). ${
            verificationResult.materiality?.hasMaterialDefect
              ? `Material defects found: ${verificationResult.materiality.materialCount}.`
              : 'Decision reasoning insufficient for settlement.'
          }`,
        };
      }

      // Allowed — settlement proceeds
      return;
    } catch (error: any) {
      if (options.debug) {
        console.error(`[pot-x402] Verification error: ${error.message}`);
      }

      // On error, default to HOLD (conservative)
      return {
        abort: true,
        reason: `ThoughtProof verification failed: ${error.message}. Settlement held as precaution.`,
      };
    }
  };
}

/**
 * Convenience: create a hook with auto-detected stake level based on payment amount.
 * Amounts in USD (or equivalent stablecoin value).
 */
export function createAutoStakeHook(
  options: Omit<ThoughtProofHookOptions, 'stakeLevel'>,
): ReturnType<typeof createThoughtProofHook> {
  return async (context: { paymentPayload: any; requirements: any }) => {
    // Try to extract amount from the payment context
    const amount = parseFloat(
      context.requirements?.maxAmountRequired?.toString() ||
      context.paymentPayload?.amount?.toString() ||
      '0',
    );

    // Auto-detect stake level based on amount
    let stakeLevel: StakeLevel;
    if (amount <= 5) stakeLevel = 'micro';
    else if (amount <= 50) stakeLevel = 'low';
    else if (amount <= 500) stakeLevel = 'medium';
    else if (amount <= 5000) stakeLevel = 'high';
    else stakeLevel = 'critical';

    const hook = createThoughtProofHook({ ...options, stakeLevel });
    return hook(context);
  };
}
