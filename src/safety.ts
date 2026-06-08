import type { Instruction } from '@arch-network/arch-sdk';
import { toHex } from './util';

export class SafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SafetyError';
  }
}

export interface SafetyConfig {
  /**
   * If set, every instruction's `program_id` must be in this allowlist
   * (lowercase hex). Blocks an agent from being tricked into calling an
   * unexpected program.
   */
  programAllowlist?: string[];
  /** Reject transactions with more than this many instructions. */
  maxInstructionsPerTx?: number;
  /**
   * Largest token amount (base units) a single transfer-style action may
   * move. Enforced by plugins that move value, not by the tx pipeline.
   */
  maxTransferBaseUnits?: bigint;
  /**
   * When true, instructions are validated and the message is built, but
   * nothing is broadcast. `submit()` returns the sentinel `DRYRUN`.
   */
  dryRun?: boolean;
}

export const DRYRUN_TXID = 'DRYRUN';

export class SafetyGuard {
  constructor(readonly config: SafetyConfig = {}) {}

  get dryRun(): boolean {
    return this.config.dryRun === true;
  }

  checkInstructions(instructions: Instruction[]): void {
    const { programAllowlist, maxInstructionsPerTx } = this.config;

    if (instructions.length === 0) {
      throw new SafetyError('refusing to submit an empty instruction set');
    }
    if (
      maxInstructionsPerTx !== undefined &&
      instructions.length > maxInstructionsPerTx
    ) {
      throw new SafetyError(
        `tx has ${instructions.length} instructions, limit is ${maxInstructionsPerTx}`,
      );
    }
    if (programAllowlist && programAllowlist.length > 0) {
      const allow = new Set(programAllowlist.map((p) => p.toLowerCase()));
      for (const ix of instructions) {
        const pid = toHex(ix.program_id).toLowerCase();
        if (!allow.has(pid)) {
          throw new SafetyError(`program ${pid} is not in the allowlist`);
        }
      }
    }
  }

  checkTransferAmount(amount: bigint): void {
    const cap = this.config.maxTransferBaseUnits;
    if (cap !== undefined && amount > cap) {
      throw new SafetyError(
        `transfer of ${amount} exceeds cap of ${cap} base units`,
      );
    }
  }
}
