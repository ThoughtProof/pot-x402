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
  /** Agent address or ID */
  id: string;
  /** Agent name */
  name: string;
  /** Agent category */
  category: string | null;
  /** Chain (e.g., "Base") */
  chain: string;
  /** Trust assessment */
  trust: {
    /** Trust score 0-100 */
    score: number;
    /** Grade: A+, A, B, C, D, F */
    grade: string;
  } | null;
  /** ACP behavioral breakdown */
  breakdown: {
    /** Job completion rate (0-1) */
    completionRate: number;
    /** Payment success rate (0-1) */
    paymentRate: number;
    /** Total jobs processed */
    totalJobs: number;
    /** Agent GDP (revenue earned) */
    agdp: number;
    /** Total revenue */
    revenue: number;
  } | null;
  /** Data source */
  dataSource: string;
  /** Last updated timestamp */
  lastUpdated: string | null;
}

/** Response from /api/v1/agent/{address} endpoint */
export interface MaiatAgentLookup {
  address: string;
  trustScore: number | null;
  dataSource: string;
  breakdown: any | null;
  verdict: 'trusted' | 'cautious' | 'unknown' | 'flagged';
  message: string;
  erc8004: { registered: boolean } | null;
}

/**
 * Look up an agent by address via Maiat.
 * Returns trust score and ACP behavioral data if available.
 *
 * @param agentAddress - EVM address of the agent
 */
export async function checkMaiatByAddress(agentAddress: string): Promise<MaiatAgentLookup> {
  const res = await fetch(
    `https://app.maiat.io/api/v1/agent/${agentAddress}`,
    { redirect: 'follow' },
  );

  if (!res.ok) {
    throw new Error(`Maiat API error: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<MaiatAgentLookup>;
}

/**
 * Get top agents from Maiat's agent list with trust scores.
 * Useful for discovering agents with real ACP behavioral data.
 *
 * @param limit - Number of agents to return (default 10)
 * @param offset - Pagination offset
 */
export async function getMaiatAgents(limit: number = 10, offset: number = 0): Promise<{ agents: MaiatAgentCheck[]; total: number }> {
  const res = await fetch(
    `https://app.maiat.io/api/v1/agents?limit=${limit}&offset=${offset}`,
  );

  if (!res.ok) {
    throw new Error(`Maiat API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as any;
  return {
    agents: data.agents || [],
    total: data.pagination?.total || 0,
  };
}

// Legacy alias
export const checkMaiat = checkMaiatByAddress;

/**
 * Convert Maiat trust score to a reputation weight for pot-sdk context.
 *
 * - score >= 70: agent has strong behavioral history → full weight
 * - score 40-69: mixed signals → reduced weight
 * - score < 40: weak or no history → low weight
 * - null (no ACP history): unknown → default cautious weight
 *
 * Accepts either a MaiatAgentCheck (from /agents list) or a raw score number.
 */
export function maiatReputationWeight(scoreOrAgent: number | null | MaiatAgentCheck): number {
  const score = typeof scoreOrAgent === 'object' && scoreOrAgent !== null
    ? (scoreOrAgent as MaiatAgentCheck).trust?.score ?? null
    : scoreOrAgent;
  if (score === null) return 0.3;
  if (score >= 70) return 1.0;
  if (score >= 40) return 0.3 + (score - 40) * 0.7 / 30;
  return Math.max(0.05, score / 40 * 0.3);
}

/**
 * Build a trust context string for pot-sdk verify() that includes
 * Maiat behavioral assessment.
 *
 * Accepts either a MaiatAgentCheck (from /agents list) or MaiatAgentLookup (from /agent/{address}).
 * Use this as the `context.trusted` field when calling verify().
 */
export function buildMaiatContext(
  maiat: MaiatAgentCheck | MaiatAgentLookup,
  additionalContext?: string,
): string {
  // Handle both response types
  const isLookup = 'address' in maiat && 'verdict' in maiat;
  const score = isLookup
    ? (maiat as MaiatAgentLookup).trustScore
    : (maiat as MaiatAgentCheck).trust?.score ?? null;
  const name = isLookup ? (maiat as MaiatAgentLookup).address : (maiat as MaiatAgentCheck).name;
  const grade = !isLookup ? (maiat as MaiatAgentCheck).trust?.grade : undefined;
  const breakdown = !isLookup ? (maiat as MaiatAgentCheck).breakdown : null;

  const weight = maiatReputationWeight(score);

  let assessment: string;
  if (score === null) {
    assessment = `Maiat assessment: no ACP behavioral history found. Agent is unknown. Treat reputation claims with caution (weight ${weight.toFixed(2)}).`;
  } else if (score >= 70) {
    assessment = `Maiat assessment: agent has strong behavioral trust (score ${score}/100${grade ? `, grade: ${grade}` : ''}).`;
  } else if (score >= 40) {
    assessment = `Maiat assessment: agent has mixed behavioral signals (score ${score}/100). Treat reputation claims with weight ${weight.toFixed(2)}.`;
  } else {
    assessment = `Maiat WARNING: low trust score (${score}/100). Treat reputation claims with weight ${weight.toFixed(2)}.`;
  }

  const lines = [assessment, `Agent: ${name}.`];

  if (breakdown) {
    lines.push(`ACP stats: ${breakdown.totalJobs} jobs, ${(breakdown.completionRate * 100).toFixed(1)}% completion, $${breakdown.revenue.toFixed(2)} revenue.`);
  }

  if (additionalContext) lines.push(additionalContext);

  return lines.filter(Boolean).join('\n');
}
