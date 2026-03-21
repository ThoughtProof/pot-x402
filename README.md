# @pot-sdk2/x402

> **Decision verification hook for x402 payments** — verifies whether an agent's payment decision is well-justified before settlement executes.

[![npm](https://img.shields.io/npm/v/@pot-sdk2/x402)](https://www.npmjs.com/package/@pot-sdk2/x402)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[![Thoughtproof-mcp MCP server](https://glama.ai/mcp/servers/ThoughtProof/pot-x402/badges/card.svg)](https://glama.ai/mcp/servers/ThoughtProof/pot-x402)

## The Problem

x402 enables AI agents to pay for services autonomously. The facilitator verifies that the **payment is valid** (correct signature, sufficient balance, right network).

But nobody verifies whether the **decision to pay** was well-justified.

An agent can authorize a perfectly valid payment for a service it doesn't need, at a price it shouldn't accept, based on reasoning that wouldn't survive scrutiny.

## The Solution

`@pot-sdk2/x402` adds a `beforeSettle` hook to the x402 facilitator that runs [ThoughtProof](https://thoughtproof.ai) decision verification before settlement executes.

- **Payment valid + decision strong → settle**
- **Payment valid + decision weak → hold**

## Install

```bash
npm install @pot-sdk2/x402 pot-sdk @x402/core
```

## Quick Start

```typescript
import { createThoughtProofHook } from '@pot-sdk2/x402';
import { x402Facilitator } from '@x402/core/facilitator';
import { registerExactEvmScheme } from '@x402/evm/exact/facilitator';

const facilitator = new x402Facilitator();

// Register your payment scheme
registerExactEvmScheme(facilitator, {
  signer: evmSigner,
  networks: 'eip155:8453', // Base
});

// Add ThoughtProof decision verification before settlement
facilitator.onBeforeSettle(createThoughtProofHook({
  providers: [
    { name: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: process.env.ANTHROPIC_API_KEY! },
    { name: 'deepseek', model: 'deepseek-chat', apiKey: process.env.DEEPSEEK_API_KEY! },
  ],
  stakeLevel: 'medium',      // micro | low | medium | high | critical
  classifyMateriality: true,  // only block on material defects
  debug: true,
}));

// Now settlement includes decision verification
const verifyResult = await facilitator.verify(paymentPayload, requirements);
if (verifyResult.isValid) {
  // This will run ThoughtProof verification before settling
  const settleResult = await facilitator.settle(paymentPayload, requirements);
}
```

## Auto-Stake Detection

Don't want to set stake levels manually? Use `createAutoStakeHook` — it detects the payment amount and adjusts skepticism automatically:

```typescript
import { createAutoStakeHook } from '@pot-sdk2/x402';

facilitator.onBeforeSettle(createAutoStakeHook({
  providers: [...],
  classifyMateriality: true,
}));

// $2.50 → micro (threshold 0.40, only material defects block)
// $149  → medium (threshold 0.60, proportional review)
// $5000 → critical (threshold 0.85, full adversarial)
```

## Stake Levels

| Level | Threshold | Critic Mode | Example |
|-------|-----------|-------------|---------|
| `micro` | 0.40 | Proportional — material defects only | $2.50 API batch |
| `low` | 0.50 | Proportional — material defects + basic logic | $50 data purchase |
| `medium` | 0.60 | Proportional — reasoning quality + evidence | $500 vendor selection |
| `high` | 0.75 | Adversarial — full skepticism | $5K settlement |
| `critical` | 0.85 | Adversarial — maximum scrutiny | $50K+ / regulated |

## How It Works

```
Agent decides to pay
        ↓
x402 facilitator.verify() — payment valid?
        ↓
x402 facilitator.settle() — execute payment
        ↓
    [beforeSettle hook]
        ↓
ThoughtProof runs multi-model adversarial verification:
  - Is the payment amount proportional to the service?
  - Is there a material defect in the decision reasoning?
  - Would a competent reviewer change this decision?
        ↓
  confidence >= threshold → SETTLE (payment executes)
  confidence < threshold  → HOLD (payment blocked with reason)
```

## Monitoring

```typescript
facilitator.onBeforeSettle(createThoughtProofHook({
  providers: [...],
  onVerification: (result) => {
    console.log(`Decision: ${result.allowed ? 'ALLOW' : 'HOLD'}`);
    console.log(`Confidence: ${result.confidence}`);
    console.log(`Duration: ${result.durationMs}ms`);
    if (result.materiality) {
      console.log(`Material defects: ${result.materiality.materialCount}`);
    }
    // Send to your monitoring / analytics
  },
}));
```

## The Payment Trust Stack

```
Identity      → Visa TAP / ERC-8004
Authorization → Mastercard Verifiable Intent
Risk          → t54 / fraud scoring
Decision      → ThoughtProof (@pot-sdk2/x402)  ← you are here
Execution     → x402 facilitator / settlement
```

## Requirements

- `@x402/core` >= 2.0.0
- `pot-sdk` >= 1.1.0
- At least 2 LLM provider API keys (for multi-model verification)

## License

MIT — [ThoughtProof Protocol](https://thoughtproof.ai)