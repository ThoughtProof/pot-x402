/**
 * Maiat Integration — Behavioral Trust Scoring for ThoughtProof
 *
 * Maiat scores agents on behavioral trust (0-100) using on-chain data,
 * community reviews, and outcome reports. ThoughtProof verifies whether
 * a specific decision is well-justified.
 *
 * Together: reputation (WHO) + decision quality (WHY) = complete trust gate.
 *
 * API: https://app.maiat.io
 * By: Jerry Chen (@JhiNResH)
 * License: Free tier available, x402 payment-gated endpoint at $0.02/call
 */

export interface MaiatAgentCheck {
  address: string;
  /** Trust score 0-100 (null if no ACP history) */
  trustScore: number | null;
  /** Data source used for scoring */
  dataSource: string;
  /** Score breakdown (null if insufficient data) */
  breakdown: {
    onChainScore?: number;
    reviewScore?: number;
    outcomeScore?: number;
  } | null;
  /** Verdict: trusted | cautious | unknown | flagged */
  verdict: 'trusted' | 'cautious' | 'unknown' | 'flagged';
  /** Human-readable message */
  message: string;
  /** ERC-8004 registration status */
  erc8004: {
    registered: boolean;
  };
}

/**
 * Check an agent's behavioral trust score via Maiat.
 *
 * @param agentAddress - EVM address of the agent
 */
export async function checkMaiat(agentAddress: string): Promise<MaiatAgentCheck> {
  const res = await fetch(
    `https://app.maiat.io/api/v1/agent/${agentAddress}`,
    { redirect: 'follow' },
  );

  if (!res.ok) {
    throw new Error(`Maiat API error: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<MaiatAgentCheck>;
}

/**
 * Convert Maiat trust score to a reputation weight for pot-sdk context.
 *
 * - score >= 70: agent has strong behavioral history → full weight
 * - score 40-69: mixed signals → reduced weight
 * - score < 40: weak or no history → low weight
 * - null (no ACP history): unknown → default cautious weight
 */
export function maiatReputationWeight(score: number | null): number {
  if (score === null) return 0.3; // unknown = cautious default
  if (score >= 70) return 1.0;
  if (score >= 40) return 0.3 + (score - 40) * 0.7 / 30;
  return Math.max(0.05, score / 40 * 0.3);
}

/**
 * Build a trust context string for pot-sdk verify() that includes
 * Maiat behavioral assessment.
 *
 * Use this as the `context.trusted` field when calling verify().
 */
export function buildMaiatContext(
  maiat: MaiatAgentCheck,
  additionalContext?: string,
): string {
  const weight = maiatReputationWeight(maiat.trustScore);

  let assessment: string;
  if (maiat.trustScore === null) {
    assessment = `Maiat assessment: no ACP behavioral history found. Agent is unknown. Treat reputation claims with caution (weight ${weight.toFixed(2)}).`;
  } else if (maiat.verdict === 'trusted') {
    assessment = `Maiat assessment: agent has strong behavioral trust (score ${maiat.trustScore}/100, verdict: ${maiat.verdict}).`;
  } else if (maiat.verdict === 'cautious') {
    assessment = `Maiat assessment: agent has mixed behavioral signals (score ${maiat.trustScore}/100, verdict: ${maiat.verdict}). Treat reputation claims with weight ${weight.toFixed(2)}.`;
  } else {
    assessment = `Maiat WARNING: agent flagged (score ${maiat.trustScore}/100, verdict: ${maiat.verdict}). Treat reputation claims with weight ${weight.toFixed(2)}.`;
  }

  return [
    assessment,
    `Agent address: ${maiat.address}.`,
    maiat.erc8004.registered ? 'ERC-8004: registered ✓' : 'ERC-8004: not registered.',
    additionalContext || '',
  ].filter(Boolean).join('\n');
}
