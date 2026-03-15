/**
 * RNWY Integration — Reviewer Legitimacy Check for ThoughtProof
 *
 * Before pot-sdk verifies decision quality, RNWY checks whether
 * the reputation data feeding into the verification is legitimate.
 *
 * Clean reputation data in → sound decision verification out.
 *
 * API: https://rnwy.com
 * By: Pablo (PA Lopez-Starr)
 * License: Free, no auth required
 */

export interface RNWYTrustCheck {
  agentId: number;
  chain: string;
  name: string;
  /** Trust score 0-100 (graduated, not binary) */
  score: number;
  /** Score threshold for passing */
  threshold: number;
  /** Whether the agent passes the trust check */
  pass: boolean;
  /** Trust tier: trusted | cautious | flagged */
  tier: 'trusted' | 'cautious' | 'flagged';
  /** Earned badges and warnings */
  badges: {
    earned: string[];
    warnings: string[];
  };
  /** Human-readable reason */
  reason: string;
}

export interface RNWYReviewerAnalysis {
  agentId: number;
  chain: string;
  totalReviews: number;
  uniqueReviewers: number;
  analyzedWallets: number;
  distribution: {
    sameDay: number;
    under3d: number;
    under15d: number;
    under30d: number;
    under1yr: number;
    over1yr: number;
    noHistory: number;
  };
  summary: {
    sameDayPct: number;
    lowHistoryPct: number;
  };
}

/**
 * Check an agent's reviewer legitimacy via RNWY.
 * Returns a graduated trust score (0-100) based on whether
 * the agent's reputation data was earned from real wallets
 * or farmed from sybil accounts.
 *
 * @param agentId - ERC-8004 agent ID or Virtuals agent ID
 * @param chain - Chain identifier (e.g., 'base')
 */
export async function checkRNWY(agentId: number, chain: string = 'base'): Promise<RNWYTrustCheck> {
  const res = await fetch(`https://rnwy.com/api/trust-check?id=${agentId}&chain=${chain}`);

  if (!res.ok) {
    throw new Error(`RNWY API error: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<RNWYTrustCheck>;
}

/**
 * Get detailed reviewer wallet age distribution from RNWY.
 * Useful for deeper analysis: how many reviewers were created
 * on the same day they reviewed? (high sameDay% = sybil signal)
 *
 * @param agentId - ERC-8004 agent ID or Virtuals agent ID
 * @param chain - Chain identifier (e.g., 'base')
 */
export async function analyzeReviewers(agentId: number, chain: string = 'base'): Promise<RNWYReviewerAnalysis> {
  const res = await fetch(`https://rnwy.com/api/reviewer-analysis?id=${agentId}&chain=${chain}`);

  if (!res.ok) {
    throw new Error(`RNWY API error: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<RNWYReviewerAnalysis>;
}

/**
 * Convert RNWY trust score to a reputation weight for pot-sdk context.
 *
 * When feeding reputation data into ThoughtProof verification,
 * RNWY's score determines how much to trust that reputation:
 *
 * - score >= 70: reputation is likely legitimate → full weight
 * - score 40-69: reputation is mixed → reduced weight
 * - score < 40: reputation is likely farmed → near-zero weight
 *
 * This prevents garbage-in-garbage-out: if the reputation feeding
 * into decision verification was sybil-farmed, the verification
 * would run on false premises.
 */
export function reputationWeight(rnwyScore: number): number {
  if (rnwyScore >= 70) return 1.0;
  if (rnwyScore >= 40) return 0.3 + (rnwyScore - 40) * 0.7 / 30; // linear 0.3-1.0
  return Math.max(0.05, rnwyScore / 40 * 0.3); // linear 0.05-0.3
}

/**
 * Build a trust context string for pot-sdk verify() that includes
 * RNWY legitimacy assessment.
 *
 * Use this as the `context.trusted` field when calling verify().
 */
export function buildTrustedContext(
  rnwy: RNWYTrustCheck,
  additionalContext?: string,
): string {
  const weight = reputationWeight(rnwy.score);
  const legitimacy = rnwy.pass
    ? `RNWY assessment: reputation data appears legitimate (score ${rnwy.score}/100, tier: ${rnwy.tier}).`
    : `RNWY WARNING: reputation data may be compromised (score ${rnwy.score}/100, tier: ${rnwy.tier}). Warnings: ${rnwy.badges.warnings.join(', ')}. Treat reputation claims with weight ${weight.toFixed(2)}.`;

  return [
    legitimacy,
    `Agent: ${rnwy.name} (ID: ${rnwy.agentId}, chain: ${rnwy.chain}).`,
    additionalContext || '',
  ].filter(Boolean).join('\n');
}
