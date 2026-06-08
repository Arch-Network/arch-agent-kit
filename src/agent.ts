import {
  RpcConnection,
  type Instruction,
} from '@arch-network/arch-sdk';
import { TitanHttpClient } from '@titanbtcio/sdk';
import {
  DRYRUN_TXID,
  SafetyConfig,
  SafetyGuard,
} from './safety';
import { buildAndSign, sendAndConfirm, type ConfirmOptions } from './tx';
import type { Action, Plugin, Signer } from './types';
import { toBytes } from './util';

export interface ArchAgentKitConfig {
  /** Arch JSON-RPC endpoint (validator or indexer-compat proxy). */
  rpcUrl: string;
  /** Authorizes transactions. See `KeypairSigner` / `WalletHubSigner`. */
  signer: Signer;
  /** Titan (Bitcoin/Runes indexer) base URL. Enables the Runes plugin. */
  titanUrl?: string;
  /** Guardrails applied before any broadcast. Strongly recommended. */
  safety?: SafetyConfig;
}

/**
 * The central agent handle. Register plugins with `.use()`, then either
 * call actions directly or hand the tool set to an LLM framework via the
 * adapters in `./adapters`.
 */
export class ArchAgentKit {
  readonly rpc: RpcConnection;
  readonly signer: Signer;
  readonly titan?: TitanHttpClient;
  readonly safety: SafetyGuard;
  readonly actions: Action[] = [];
  readonly methods: Record<string, (...args: never[]) => unknown> = {};

  private readonly actionsByName = new Map<string, Action>();

  constructor(config: ArchAgentKitConfig) {
    this.rpc = new RpcConnection(config.rpcUrl);
    this.signer = config.signer;
    this.titan = config.titanUrl
      ? new TitanHttpClient(config.titanUrl)
      : undefined;
    this.safety = new SafetyGuard(config.safety);
  }

  /** This agent's own account public key as bytes. */
  get pubkey(): Uint8Array {
    return toBytes(this.signer.pubkeyHex);
  }

  use(plugin: Plugin): this {
    for (const action of plugin.actions) {
      if (this.actionsByName.has(action.name)) {
        throw new Error(`duplicate action name: ${action.name}`);
      }
      this.actionsByName.set(action.name, action);
      this.actions.push(action);
    }
    if (plugin.methods) {
      for (const [name, fn] of Object.entries(plugin.methods)) {
        this.methods[name] = fn;
      }
    }
    return this;
  }

  getAction(name: string): Action | undefined {
    return this.actionsByName.get(name);
  }

  /** Validate input against the action schema and run it. */
  async run(name: string, input: unknown): Promise<unknown> {
    const action = this.actionsByName.get(name);
    if (!action) throw new Error(`unknown action: ${name}`);
    const parsed = action.schema.parse(input);
    return action.handler(this, parsed);
  }

  /**
   * Apply safety checks, build + sign, and (unless dry-run) broadcast and
   * await confirmation. Returns the txid, or `DRYRUN` when dry-run is on.
   */
  async submit(
    instructions: Instruction[],
    opts: ConfirmOptions = {},
  ): Promise<string> {
    this.safety.checkInstructions(instructions);
    if (this.safety.dryRun) return DRYRUN_TXID;
    const tx = await buildAndSign(this.rpc, this.signer, instructions);
    return sendAndConfirm(this.rpc, tx, opts);
  }
}
