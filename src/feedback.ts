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
  /** Was the decision allowed? */
  allowed: boolean;
  /** Confidence score */
  confidence: number;
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

  const body = {
    jobId: outcome.jobId,
    outcome: maiatOutcome,
    reporter: 'thoughtproof',
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
 * Create a feedback callback for use with ThoughtProof hooks.
 *
 * Pass this as the `onVerification` callback in createThoughtProofHook()
 * or verifyJobCompletion() to automatically report results to Maiat.
 *
 * @example
 * ```typescript
 * import { createThoughtProofHook } from '@pot-sdk2/x402';
 * import { createMaiatFeedback } from '@pot-sdk2/x402/feedback';
 *
 * facilitator.onBeforeSettle(createThoughtProofHook({
 *   providers: [...],
 *   onVerification: createMaiatFeedback({ debug: true }),
 * }));
 * ```
 */
export function createMaiatFeedback(config: FeedbackConfig = {}) {
  return async (result: { allowed: boolean; confidence: number; materiality?: any }, jobId?: string) => {
    await reportToMaiat({
      jobId: jobId || `tx-${Date.now()}`,
      allowed: result.allowed,
      confidence: result.confidence,
      hasMaterialDefect: result.materiality?.hasMaterialDefect,
      overallAssessment: result.materiality?.overallAssessment,
    }, config);
  };
}
