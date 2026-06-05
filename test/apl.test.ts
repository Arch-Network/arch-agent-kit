import { describe, expect, it } from 'vitest';
import {
  readMintDecimals,
  readMintSupply,
  readTokenAmount,
  transferIx,
} from '../src/apl';
import { formatAmount, parseAmount } from '../src/util';

describe('APL helpers', () => {
  it('reads token amount at offset 64', () => {
    const data = new Uint8Array(72);
    new DataView(data.buffer).setBigUint64(64, 123_456n, true);
    expect(readTokenAmount(data)).toBe(123_456n);
  });

  it('reads mint supply at offset 36 and decimals at 44', () => {
    const data = new Uint8Array(82);
    new DataView(data.buffer).setBigUint64(36, 1_000_000n, true);
    data[44] = 6;
    expect(readMintSupply(data)).toBe(1_000_000n);
    expect(readMintDecimals(data)).toBe(6);
  });

  it('builds a transfer instruction with index 3 + LE amount', () => {
    const a = new Uint8Array(32).fill(1);
    const b = new Uint8Array(32).fill(2);
    const o = new Uint8Array(32).fill(3);
    const ix = transferIx(a, b, o, 42n);
    expect(ix.data[0]).toBe(3);
    expect(new DataView(ix.data.buffer).getBigUint64(1, true)).toBe(42n);
    expect(ix.accounts).toHaveLength(3);
    expect(ix.accounts[2]!.is_signer).toBe(true);
  });
});

describe('amount parsing', () => {
  it('round-trips human <-> base units', () => {
    expect(parseAmount('10.5', 6)).toBe(10_500_000n);
    expect(formatAmount(10_500_000n, 6)).toBe('10.5');
    expect(formatAmount(1_000_000n, 6)).toBe('1');
  });

  it('rejects too many decimals', () => {
    expect(() => parseAmount('1.1234567', 6)).toThrowError();
  });
});
