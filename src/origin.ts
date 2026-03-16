/**
 * OriginDAO Integration — Agent Identity + Trust Grades for ThoughtProof
 *
 * OriginDAO provides the identity substrate:
 *   - Birth Certificates (ERC-721) with lineage, licenses, verification
 *   - Trust grades earned through adversarial Gauntlet trials
 *   - ERC-8004 adapter for cross-protocol identity
 *
 * ThoughtProof provides the epistemic substrate:
 *   - Decision quality verification before execution
 *
 * Together: Identity proves who may act. Verification proves whether the action should happen.
 *
 * API: https://origindao.ai
 * By: Suppi / OriginDAO (@OriginDAO_ai)
 */

export type OriginTrustStatus = 'NONE' | 'PENDING' | 'VERIFIED' | 'LICENSED' | 'REVOKED';

export interface OriginAgentLookup {
  /** ERC-8004 agent ID */
  id: number;
  /** Agent name */
  name: string;
  /** Agent description */
  description?: string;
  /** Agent image URL */
  image?: string;
  /** Is the agent currently active? */
  active: boolean;
  /** ORIGIN trust assessment */
  origin: {
    /** Trust status: NONE (not enrolled), PENDING, VERIFIED, LICENSED, REVOKED */
    status: OriginTrustStatus;
    /** Trust level (0 = unverified, 1 = verified, 2 = licensed) */
    trustLevel: number | null;
    /** ORIGIN agent ID (different from ERC-8004 ID) */
    agentId: number | null;
    /** ERC-8004 adapter contract */
    adapter: string;
    /** URL to take the Gauntlet */
    gauntletUrl: string;
    /** Human-readable message about status */
    message: string;
  };
  /** Optional: services the agent provides */
  services?: Array<{
    name: string;
    endpoint: string;
    version?: string;
  }>;
  /** Queried timestamp */
  queriedAt?: string;
}

/**
 * Look up an agent's ORIGIN identity and trust status via the Bridge API.
 *
 * @param agentId - ERC-8004 agent ID
 */
export async function checkOrigin(agentId: number): Promise<OriginAgentLookup> {
  const res = await fetch(
    `https://origindao.ai/api/agent/8004/${agentId}`,
    { redirect: 'follow' },
  );

  if (!res.ok) {
    throw new Error(`OriginDAO API error: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<OriginAgentLookup>;
}

/**
 * Convert ORIGIN trust status to a weight for pot-sdk context.
 *
 * - LICENSED (level 2): full trust — agent has verified credentials
 * - VERIFIED (level 1): strong trust — human co-signed
 * - PENDING: moderate — enrolled but not yet verified
 * - NONE: low — no ORIGIN identity
 * - REVOKED: zero — trust explicitly revoked
 */
export function originTrustWeight(status: OriginTrustStatus): number {
  switch (status) {
    case 'LICENSED': return 1.0;
    case 'VERIFIED': return 0.85;
    case 'PENDING': return 0.50;
    case 'NONE': return 0.30;
    case 'REVOKED': return 0.0;
    default: return 0.30;
  }
}

/**
 * Build a trust context string for pot-sdk verify() that includes
 * OriginDAO identity and trust assessment.
 *
 * Use as context.trusted when calling verify().
 */
export function buildOriginContext(
  agent: OriginAgentLookup,
  additionalContext?: string,
): string {
  const weight = originTrustWeight(agent.origin.status);

  let assessment: string;
  switch (agent.origin.status) {
    case 'LICENSED':
      assessment = `ORIGIN assessment: agent is LICENSED (level 2). Human-verified with professional credentials. Full trust (weight ${weight.toFixed(2)}).`;
      break;
    case 'VERIFIED':
      assessment = `ORIGIN assessment: agent is VERIFIED (level 1). Human co-signed identity. Strong trust (weight ${weight.toFixed(2)}).`;
      break;
    case 'PENDING':
      assessment = `ORIGIN assessment: agent is PENDING. Enrolled in Gauntlet but not yet verified. Moderate trust (weight ${weight.toFixed(2)}).`;
      break;
    case 'REVOKED':
      assessment = `ORIGIN WARNING: agent trust REVOKED. Identity was previously verified but has been revoked. Zero trust (weight ${weight.toFixed(2)}).`;
      break;
    default:
      assessment = `ORIGIN assessment: agent has ERC-8004 identity but has NOT completed the ORIGIN Gauntlet. Unknown trust (weight ${weight.toFixed(2)}).`;
  }

  const lines = [
    assessment,
    `Agent: ${agent.name} (ERC-8004 #${agent.id}).`,
    `Active: ${agent.active ? 'yes' : 'no'}.`,
  ];

  if (agent.origin.trustLevel !== null) {
    lines.push(`Trust level: ${agent.origin.trustLevel}.`);
  }

  if (additionalContext) lines.push(additionalContext);

  return lines.filter(Boolean).join('\n');
}
