import { describe, expect, it } from 'vitest';
import type { Instruction } from '@saturnbtcio/arch-sdk';
import { SafetyError, SafetyGuard } from '../src/safety';
import { hexToBytes } from '../src/util';

const PROG_A =
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PROG_B =
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function ix(programHex: string): Instruction {
  return { program_id: hexToBytes(programHex), accounts: [], data: new Uint8Array() };
}

describe('SafetyGuard', () => {
  it('rejects empty instruction sets', () => {
    expect(() => new SafetyGuard().checkInstructions([])).toThrow(SafetyError);
  });

  it('enforces the program allowlist', () => {
    const guard = new SafetyGuard({ programAllowlist: [PROG_A] });
    expect(() => guard.checkInstructions([ix(PROG_A)])).not.toThrow();
    expect(() => guard.checkInstructions([ix(PROG_B)])).toThrow(SafetyError);
  });

  it('enforces max instructions per tx', () => {
    const guard = new SafetyGuard({ maxInstructionsPerTx: 1 });
    expect(() => guard.checkInstructions([ix(PROG_A), ix(PROG_A)])).toThrow(
      SafetyError,
    );
  });

  it('enforces transfer caps', () => {
    const guard = new SafetyGuard({ maxTransferBaseUnits: 1000n });
    expect(() => guard.checkTransferAmount(1000n)).not.toThrow();
    expect(() => guard.checkTransferAmount(1001n)).toThrow(SafetyError);
  });

  it('reports dry-run mode', () => {
    expect(new SafetyGuard({ dryRun: true }).dryRun).toBe(true);
    expect(new SafetyGuard().dryRun).toBe(false);
  });
});
