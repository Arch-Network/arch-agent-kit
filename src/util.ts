export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error(`odd-length hex: ${hex}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function u64le(n: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, n, true);
  return out;
}

export function readU64le(data: Uint8Array, offset: number): bigint {
  if (data.length < offset + 8) return 0n;
  let amt = 0n;
  for (let i = 0; i < 8; i++) amt |= BigInt(data[offset + i]!) << BigInt(8 * i);
  return amt;
}

/** Format a u64 base-units value as a human decimal string. */
export function formatAmount(amount: bigint, decimals: number): string {
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const frac = abs % scale;
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  const out = fracStr ? `${whole}.${fracStr}` : whole.toString();
  return neg ? `-${out}` : out;
}

/** Parse "10.5" with 6 decimals into 10_500_000n. Throws on bad input. */
export function parseAmount(input: string, decimals: number): bigint {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error(`bad amount: ${input}`);
  const parts = trimmed.split('.');
  const whole = parts[0] ?? '0';
  const frac = parts[1] ?? '';
  if (frac.length > decimals) throw new Error(`too many decimals for ${input}`);
  const padded = frac.padEnd(decimals, '0');
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || '0');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Accepts hex string, byte array, or Uint8Array; returns bytes. */
export function toBytes(v: string | Uint8Array | number[]): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v)) return new Uint8Array(v);
  return hexToBytes(v);
}

/** Accepts hex string, byte array, or Uint8Array; returns lowercase hex. */
export function toHex(v: string | Uint8Array | number[]): string {
  if (typeof v === 'string') return v.startsWith('0x') ? v.slice(2) : v;
  return bytesToHex(v instanceof Uint8Array ? v : new Uint8Array(v));
}
