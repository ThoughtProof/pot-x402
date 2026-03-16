/**
 * ERC-8183 Decision Verification Hook — ThoughtProof as Evaluator
 *
 * Implements the IACPHook interface for ERC-8183 Agentic Commerce Protocol.
 * Runs pot-sdk decision verification before complete() executes.
 *
 * ERC-8183 Hook Flow:
 *   1. Provider submits deliverable
 *   2. Evaluator calls complete(jobId, reason, optParams)
 *   3. beforeAction hook fires → ThoughtProof verifies reasoning
 *   4. If ALLOW → complete() proceeds, provider gets paid
 *   5. If HOLD → hook reverts, settlement paused
 *
 * Hook Interface (from ERC-8183):
 *   beforeAction(uint256 jobId, bytes4 selector, bytes calldata data) → reverts to block
 *   afterAction(uint256 jobId, bytes4 selector, bytes calldata data) → bookkeeping
 *
 * This TypeScript module provides the off-chain verification logic.
 * The on-chain hook calls this service and reverts if verification fails.
 *
 * Usage with Virtuals ACP, Base, X Layer, or any ERC-8183 deployment.
 */

import { verify } from 'pot-sdk';
import type { StakeLevel, TrustContext } from 'pot-sdk';

// ── ERC-8183 Types ──────────────────────────────────────────────────────────

/** ERC-8183 Job states */
export type JobState = 'Open' | 'Funded' | 'Submitted' | 'Completed' | 'Rejected' | 'Expired';

/** ERC-8183 function selectors */
export const ERC8183_SELECTORS = {
  complete: '0x7ecf2528',  // complete(uint256,bytes32,bytes)
  reject: '0x6622e0d7',    // reject(uint256)
  submit: '0x7e37b2a0',    // submit(uint256,bytes)
} as const;

/** Job context for verification */
export interface JobContext {
  /** ERC-8183 job ID */
  jobId: number | string;
  /** Job description / task specification */
  description: string;
  /** Budget in USDC or equivalent */
  budgetUsd: number;
  /** Provider's submitted deliverable / output */
  deliverable: string;
  /** Evaluator's stated reason for completion */
  completionReason?: string;
  /** Provider address */
  provider?: string;
  /** Client address */
  client?: string;
  /** Chain (Base, X Layer, etc.) */
  chain?: string;
}

/** Verification result for ERC-8183 hook */
export interface HookVerificationResult {
  /** Should complete() proceed? */
  allow: boolean;
  /** Confidence score */
  confidence: number;
  /** Stake level applied */
  stakeLevel: StakeLevel;
  /** Threshold used */
  threshold: number;
  /** Materiality assessment */
  materiality?: {
    materialCount: number;
    notableCount: number;
    minorCount: number;
    hasMaterialDefect: boolean;
    overallAssessment: string;
  };
  /** Duration in ms */
  durationMs: number;
  /** If HOLD: reason for blocking */
  holdReason?: string;
}

// ── Stake Detection ─────────────────────────────────────────────────────────

function detectJobStakeLevel(budgetUsd: number): StakeLevel {
  if (budgetUsd <= 5) return 'micro';
  if (budgetUsd <= 50) return 'low';
  if (budgetUsd <= 500) return 'medium';
  if (budgetUsd <= 5000) return 'high';
  return 'critical';
}

const STAKE_THRESHOLDS: Record<StakeLevel, number> = {
  micro: 0.40,
  low: 0.50,
  medium: 0.60,
  high: 0.75,
  critical: 0.85,
};

// ── Hook Options ────────────────────────────────────────────────────────────

export interface ERC8183HookOptions {
  /** LLM providers for multi-model verification */
  providers: Array<{ name: string; model: string; apiKey: string }>;
  /** Override stake level (auto-detected from budget if not set) */
  stakeLevel?: StakeLevel;
  /** Override threshold */
  threshold?: number;
  /** Additional trusted context (e.g., RNWY score, Maiat score) */
  trustedContext?: string;
  /** Called when verification completes */
  onVerification?: (result: HookVerificationResult) => void;
  /** Log to console */
  debug?: boolean;
}

// ── Core Verification ───────────────────────────────────────────────────────

/**
 * Verify whether an ERC-8183 job completion is justified.
 *
 * Call this from your on-chain hook's off-chain verification service.
 * If it returns { allow: false }, the hook should revert to block complete().
 *
 * @example
 * ```typescript
 * import { verifyJobCompletion } from '@pot-sdk2/x402/erc8183';
 *
 * const result = await verifyJobCompletion({
 *   jobId: 184,
 *   description: 'Find the best API vendor for wallet risk screening',
 *   budgetUsd: 250,
 *   deliverable: 'Recommended vendor: RiskLens API. Fits budget, strong coverage...',
 * }, {
 *   providers: [...],
 * });
 *
 * if (!result.allow) {
 *   // Hook should revert — settlement paused
 *   console.log('HOLD:', result.holdReason);
 * }
 * ```
 */
export async function verifyJobCompletion(
  job: JobContext,
  options: ERC8183HookOptions,
): Promise<HookVerificationResult> {
  const startTime = Date.now();
  const stakeLevel = options.stakeLevel || detectJobStakeLevel(job.budgetUsd);
  const threshold = options.threshold ?? STAKE_THRESHOLDS[stakeLevel];

  if (options.debug) {
    console.log(`[erc8183-hook] Verifying job #${job.jobId} (${stakeLevel}, threshold ${threshold})`);
  }

  const output = `ERC-8183 JOB COMPLETION REVIEW

Job ID: ${job.jobId}
Description: ${job.description}
Budget: $${job.budgetUsd} USDC
${job.chain ? `Chain: ${job.chain}` : ''}
${job.provider ? `Provider: ${job.provider}` : ''}

Provider's Deliverable:
"${job.deliverable}"

${job.completionReason ? `Evaluator's Completion Reason: "${job.completionReason}"` : ''}`;

  const claim = `Is this job completion justified? The evaluator is about to call complete() and release $${job.budgetUsd} USDC to the provider. Evaluate whether the deliverable actually satisfies the job description and whether the completion reasoning is sound.`;

  const context: TrustContext = {
    trusted: [
      `Job #${job.jobId}: "${job.description}"`,
      `Budget: $${job.budgetUsd} USDC`,
      options.trustedContext || '',
    ].filter(Boolean).join('\n'),
    toVerify: job.deliverable,
  };

  try {
    const result = await verify(output, {
      claim,
      domain: 'financial',
      providers: options.providers,
      stakeLevel,
      classifyMateriality: true,
      requireCitation: true,
      classifyObjections: true,
      context,
    });

    const durationMs = Date.now() - startTime;
    const mat = (result as any).materiality;
    const allow = result.confidence >= threshold;

    const hookResult: HookVerificationResult = {
      allow,
      confidence: result.confidence,
      stakeLevel,
      threshold,
      materiality: mat ? {
        materialCount: mat.materialCount,
        notableCount: mat.notableCount,
        minorCount: mat.minorCount,
        hasMaterialDefect: mat.hasMaterialDefect,
        overallAssessment: mat.overallAssessment,
      } : undefined,
      durationMs,
      holdReason: allow ? undefined : `ThoughtProof HOLD: confidence ${result.confidence.toFixed(2)} below threshold ${threshold}. ${
        mat?.hasMaterialDefect
          ? `Material defects: ${mat.materialCount}.`
          : 'Decision reasoning insufficient for settlement.'
      }`,
    };

    if (options.debug) {
      console.log(`[erc8183-hook] ${allow ? 'ALLOW' : 'HOLD'} — confidence ${result.confidence}, ${durationMs}ms`);
    }

    options.onVerification?.(hookResult);
    return hookResult;
  } catch (err: any) {
    if (options.debug) {
      console.error(`[erc8183-hook] Error: ${err.message}`);
    }
    // On error → HOLD (conservative)
    return {
      allow: false,
      confidence: 0,
      stakeLevel,
      threshold,
      durationMs: Date.now() - startTime,
      holdReason: `ThoughtProof verification failed: ${err.message}. Settlement held as precaution.`,
    };
  }
}

/**
 * Convenience: verify whether a rejection is justified.
 * Used when an evaluator wants to reject a job — ThoughtProof checks
 * whether the rejection reasoning is defensible.
 *
 * Important: reject() is terminal in ERC-8183. No retry. No Rejected→Funded.
 * So rejection should only happen with high confidence.
 */
export async function verifyJobRejection(
  job: JobContext & { rejectionReason: string },
  options: ERC8183HookOptions,
): Promise<HookVerificationResult> {
  // Rejections need HIGHER confidence because they're terminal
  const stakeLevel = options.stakeLevel || 'high';
  const threshold = options.threshold ?? 0.80; // Higher than normal — rejection is irreversible

  const output = `ERC-8183 JOB REJECTION REVIEW

Job ID: ${job.jobId}
Description: ${job.description}
Budget: $${job.budgetUsd} USDC

Provider's Deliverable:
"${job.deliverable}"

Evaluator's Rejection Reason:
"${job.rejectionReason}"`;

  const claim = `Is this job rejection justified? reject() is TERMINAL in ERC-8183 — the provider cannot retry. The client gets a refund. This is irreversible. Is the rejection reasoning strong enough to justify permanently ending this job?`;

  const startTime = Date.now();

  try {
    const result = await verify(output, {
      claim,
      domain: 'financial',
      providers: options.providers,
      stakeLevel,
      classifyMateriality: true,
      requireCitation: true,
      context: {
        trusted: `Job #${job.jobId}: "${job.description}". Budget: $${job.budgetUsd}. Rejection is TERMINAL.`,
        toVerify: job.rejectionReason,
      },
    });

    const mat = (result as any).materiality;
    const allow = result.confidence >= threshold;

    return {
      allow,
      confidence: result.confidence,
      stakeLevel,
      threshold,
      materiality: mat ? {
        materialCount: mat.materialCount,
        notableCount: mat.notableCount,
        minorCount: mat.minorCount,
        hasMaterialDefect: mat.hasMaterialDefect,
        overallAssessment: mat.overallAssessment,
      } : undefined,
      durationMs: Date.now() - startTime,
      holdReason: allow ? undefined : `ThoughtProof HOLD on rejection: confidence ${result.confidence.toFixed(2)} below ${threshold}. Rejection is terminal — reasoning must be stronger.`,
    };
  } catch (err: any) {
    return {
      allow: false,
      confidence: 0,
      stakeLevel,
      threshold,
      durationMs: Date.now() - startTime,
      holdReason: `Verification failed: ${err.message}. Rejection held as precaution.`,
    };
  }
}
