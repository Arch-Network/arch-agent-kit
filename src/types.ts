import type { z } from 'zod';
import type { ArchAgentKit } from './agent';

/**
 * A signer abstracts how an agent authorizes transactions. Arch uses
 * BIP340 Schnorr signatures over a 32-byte message hash, with x-only
 * (32-byte) public keys.
 *
 * Implementations: `KeypairSigner` (local key, full autonomy) and
 * `WalletHubSigner` (delegates to a remote signing service / Turnkey).
 */
export interface Signer {
  /** 32-byte x-only public key, lowercase hex (no 0x). */
  readonly pubkeyHex: string;
  /** Sign a 32-byte message hash; return the raw signature bytes. */
  signMessageHash(hash: Uint8Array): Promise<Uint8Array>;
}

/**
 * An Action is a single capability the agent can invoke, exposed to LLM
 * frameworks as a tool. The schema validates and documents the input.
 */
export interface Action<Schema extends z.ZodTypeAny = z.ZodTypeAny> {
  /** snake_case, framework-friendly tool name, e.g. `transfer_token`. */
  name: string;
  /** One-line description the model uses to decide when to call it. */
  description: string;
  schema: Schema;
  handler: (agent: ArchAgentKit, input: z.infer<Schema>) => Promise<unknown>;
}

/**
 * A Plugin bundles related actions (and optional helper methods that get
 * mounted on `agent.methods`). Mirrors the Solana Agent Kit plugin model.
 */
export interface Plugin {
  name: string;
  actions: Action[];
  methods?: Record<string, (...args: never[]) => unknown>;
}
