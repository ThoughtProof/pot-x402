/**
 * Trust Feedback Loop — HOLD/ALLOW decisions flow back to Maiat
 *
 * When ThoughtProof verifies a decision, the result (ALLOW/HOLD)
 * becomes behavioral trust data for the agent via Maiat's outcome API.
 *
 * This closes the loop:
 *   Maiat scores agent trust → ThoughtProof verifies decision →
 *   Result feeds back to Maiat → Agent's trust score updates
 *
 * Feature request: @JhiNResH (GitHub issue #1, item #4)
 * "When a trade is HOLD'd, there's no signal sent to an external trust system.
 *  Each HOLD/ALLOW decision becomes trust data for the agent's behavioral score."
 */

export interface FeedbackConfig {
  /** Maiat API base URL (default: https://app.maiat.io) */
  baseUrl?: string;
  /** Client identifier for Maiat tracking */
  clientId?: string;
  /** Enable/disable feedback (default: true) */
  enabled?: boolean;
  /** Log feedback calls */
  debug?: boolean;
}

export interface VerificationOutcome {
  /** Job or transaction ID */
  jobId: string;
  /** Agent's wallet address (0x...) — required by Maiat API */
  agentAddress: string;
  /** Was the decision allowed? */
  allowed: boolean;
  /** Confidence score */
  confidence: number;
  /**
   * On-chain transaction hash — REQUIRED by Maiat API.
   * Must come from AFTER settlement, not from verification.
   * Without txHash, anyone can spam fake outcomes.
   * Credit: @JhiNResH (GitHub issue #1, comment 2)
   */
  txHash: string;
  /** Were there material defects? */
  hasMaterialDefect?: boolean;
  /** Overall assessment */
  overallAssessment?: string;
  /** Optional note */
  note?: string;
}

export interface FeedbackResult {
  success: boolean;
  message?: string;
}

/**
 * Map ThoughtProof verdict to Maiat outcome format.
 *
 * ALLOW + high confidence → "success"
 * ALLOW + moderate confidence → "partial" (it passed, but barely)
 * HOLD + material defects → "failure"
 * HOLD + no material defects → "partial" (not bad enough to fail, but not allowed)
 */
function mapOutcome(v: VerificationOutcome): 'success' | 'failure' | 'partial' {
  if (v.allowed && v.confidence >= 0.80) return 'success';
  if (v.allowed) return 'partial';
  if (v.hasMaterialDefect) return 'failure';
  return 'partial';
}

/**
 * Report a ThoughtProof verification result to Maiat's outcome API.
 *
 * @example
 * ```typescript
 * import { reportToMaiat } from '@pot-sdk2/x402/feedback';
 *
 * // After verifyJobCompletion() or verifyTradeDecision()
 * await reportToMaiat({
 *   jobId: '184',
 *   allowed: false,
 *   confidence: 0.30,
 *   hasMaterialDefect: true,
 *   note: 'Vendor recommendation unsupported — no comparison, no pricing evidence',
 * });
 * ```
 */
export async function reportToMaiat(
  outcome: VerificationOutcome,
  config: FeedbackConfig = {},
): Promise<FeedbackResult> {
  if (config.enabled === false) {
    return { success: true, message: 'Feedback disabled' };
  }

  const baseUrl = config.baseUrl || 'https://app.maiat.io';
  const maiatOutcome = mapOutcome(outcome);

  // SECURITY: agentAddress + txHash required by Maiat API.
  // reporter must be the agent's wallet, not a string like "thoughtproof".
  // txHash proves the trade actually happened on-chain.
  // Credit: @JhiNResH (GitHub issue #1, comment 2)
  if (!outcome.txHash) {
    if (config.debug) console.warn('[feedback] WARNING: no txHash — Maiat will reject. Report after settlement, not after verification.');
    return { success: false, message: 'txHash required. Report after settlement (onAfterSettle), not after verification.' };
  }

  const body = {
    jobId: outcome.jobId,
    agentAddress: outcome.agentAddress,
    outcome: maiatOutcome,
    txHash: outcome.txHash,
    note: outcome.note || `ThoughtProof ${outcome.allowed ? 'ALLOW' : 'HOLD'}: confidence ${outcome.confidence.toFixed(2)}${
      outcome.hasMaterialDefect ? ', material defects found' : ''
    }${outcome.overallAssessment ? `, assessment: ${outcome.overallAssessment}` : ''}`,
  };

  if (config.debug) {
    console.log(`[feedback] Reporting to Maiat: ${maiatOutcome} for job ${outcome.jobId}`);
  }

  try {
    const res = await fetch(`${baseUrl}/api/v1/outcome`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Maiat-Client': config.clientId || 'thoughtproof-pot-x402',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      if (config.debug) console.error(`[feedback] Maiat error: ${res.status} ${err}`);
      return { success: false, message: `Maiat API ${res.status}: ${err}` };
    }

    const data = await res.json() as any;

    if (config.debug) {
      console.log(`[feedback] Maiat accepted: ${data.message || 'ok'}`);
    }

    return { success: true, message: data.message };
  } catch (err: any) {
    if (config.debug) console.error(`[feedback] Error: ${err.message}`);
    return { success: false, message: err.message };
  }
}

/**
 * Create a feedback callback for use AFTER settlement (onAfterSettle).
 *
 * IMPORTANT: Do NOT use this in onVerification or onBeforeSettle.
 * Maiat requires txHash (on-chain proof) which only exists after settlement.
 * The feedback loop needs ground truth (did the trade execute?), not predictions.
 *
 * Credit: @JhiNResH — "The loop needs ground truth, not predictions."
 *
 * @example
 * ```typescript
 * import { createMaiatFeedback } from '@pot-sdk2/x402/feedback';
 *
 * // Use in onAfterSettle — NOT in onBeforeSettle or onVerification
 * facilitator.onAfterSettle(async (context) => {
 *   const feedback = createMaiatFeedback({ debug: true });
 *   await feedback({
 *     allowed: true,
 *     confidence: 0.82,
 *     agentAddress: context.paymentPayload.agentWallet,
 *     txHash: context.result.transaction,
 *   });
 * });
 * ```
 */
export function createMaiatFeedback(config: FeedbackConfig = {}) {
  return async (result: {
    allowed: boolean;
    confidence: number;
    agentAddress: string;
    txHash: string;
    materiality?: any;
  }, jobId?: string) => {
    await reportToMaiat({
      jobId: jobId || `tx-${Date.now()}`,
      agentAddress: result.agentAddress,
      txHash: result.txHash,
      allowed: result.allowed,
      confidence: result.confidence,
      hasMaterialDefect: result.materiality?.hasMaterialDefect,
      overallAssessment: result.materiality?.overallAssessment,
    }, config);
  };
}
