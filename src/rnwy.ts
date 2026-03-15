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

export interface RNWYReviewer {
  address: string;
  ageAtReviewDays: number;
  currentAgeDays: number;
  classification: 'same_day' | 'recent' | 'young' | 'maturing' | 'established' | 'veteran';
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
    lowHistoryCount: number;
    establishedPct: number;
    establishedCount: number;
  };
  sybilFlags?: string[];
  clustering?: {
    batchCount: number;
    walletsInBatches: number;
    batchPct: number;
    largestBatch: number;
  };
  /** Individual reviewer data — available for deep analysis */
  reviewers?: RNWYReviewer[];
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
 * Reviewer classification weights for deep mode.
 * Based on wallet maturity at time of review.
 * Credit: Pablo (RNWY) — "pre-computed wallet maturity per reviewer"
 */
export const REVIEWER_WEIGHTS: Record<string, number> = {
  same_day: 0.05,    // almost certainly sybil
  recent: 0.20,      // under 3 days — suspicious
  young: 0.40,       // under 15 days — low confidence
  maturing: 0.60,    // under 30 days — moderate
  established: 0.85, // under 1 year — credible
  veteran: 1.00,     // over 1 year — high credibility
};

/**
 * Calculate a weighted reputation score from reviewer-level data.
 * Instead of using RNWY's aggregate score, this computes a
 * reputation quality metric from individual reviewer classifications.
 *
 * This is the "deeper mode" Pablo suggested — weighting each
 * reviewer's contribution by their wallet maturity.
 *
 * @returns Weighted score 0-100
 */
export function weightedReviewerScore(analysis: RNWYReviewerAnalysis): number {
  const dist = analysis.distribution;
  const total = analysis.totalReviews;
  if (total === 0) return 0;

  const weightedSum =
    (dist.sameDay * REVIEWER_WEIGHTS.same_day) +
    (dist.under3d * REVIEWER_WEIGHTS.recent) +
    (dist.under15d * REVIEWER_WEIGHTS.young) +
    (dist.under30d * REVIEWER_WEIGHTS.maturing) +
    (dist.under1yr * REVIEWER_WEIGHTS.established) +
    (dist.over1yr * REVIEWER_WEIGHTS.veteran);

  return Math.round((weightedSum / total) * 100);
}

/**
 * Build an enhanced trust context using reviewer-level analysis.
 * More granular than buildTrustedContext() — uses per-reviewer
 * wallet maturity weights instead of just the aggregate score.
 */
export function buildDeepTrustedContext(
  trustCheck: RNWYTrustCheck,
  reviewerAnalysis: RNWYReviewerAnalysis,
  additionalContext?: string,
): string {
  const weightedScore = weightedReviewerScore(reviewerAnalysis);
  const weight = reputationWeight(trustCheck.score);
  const sybilPct = reviewerAnalysis.summary.sameDayPct;

  const lines = [
    `RNWY Deep Analysis: Agent "${trustCheck.name}" (ID: ${trustCheck.agentId}, chain: ${trustCheck.chain}).`,
    `Aggregate trust score: ${trustCheck.score}/100 (tier: ${trustCheck.tier}).`,
    `Reviewer-weighted score: ${weightedScore}/100 (weighted by wallet maturity).`,
    `Total reviews: ${reviewerAnalysis.totalReviews} from ${reviewerAnalysis.uniqueReviewers} unique wallets.`,
    `Same-day reviewers: ${sybilPct}%${sybilPct > 50 ? ' ⚠️ HIGH SYBIL SIGNAL' : ''}.`,
    `Reputation context weight: ${weight.toFixed(2)}.`,
  ];

  if (reviewerAnalysis.sybilFlags?.length) {
    lines.push(`Sybil flags: ${reviewerAnalysis.sybilFlags.join('; ')}`);
  }

  if (additionalContext) lines.push(additionalContext);

  return lines.join('\n');
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
