import { describe, expect, it } from 'vitest';
import { SignatureUtil } from '@saturnbtcio/arch-sdk';
import { Verifier } from 'bip322-js';
import { KeypairSigner } from '../src/signer/keypair';
import { hexToBytes } from '../src/util';

function bytesToBase64(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

describe('KeypairSigner', () => {
  it('produces a 32-byte x-only pubkey and a taproot address', () => {
    const signer = KeypairSigner.generate();
    expect(hexToBytes(signer.pubkeyHex).length).toBe(32);
    expect(signer.taprootAddress.startsWith('tb1p')).toBe(true);
  });

  it('produces a BIP-322 signature that trims to 64 bytes', async () => {
    const signer = KeypairSigner.generate();
    // The arch-sdk hash() yields UTF-8 bytes of a 64-char hex string.
    const hex = 'ab'.repeat(32);
    const witness = await signer.signMessageHash(
      new TextEncoder().encode(hex),
    );
    const sig = SignatureUtil.adjustSignature(witness);
    expect(sig.length).toBe(64);
  });

  it('signs a message that verifies under BIP-322', async () => {
    const signer = KeypairSigner.generate();
    const hex = 'cd'.repeat(32);
    const witness = await signer.signMessageHash(
      new TextEncoder().encode(hex),
    );
    const ok = Verifier.verifySignature(
      signer.taprootAddress,
      hex,
      bytesToBase64(witness),
    );
    expect(ok).toBe(true);
  });

  it('rejects non-32-byte private keys', () => {
    expect(() =>
      KeypairSigner.fromPrivateKey(new Uint8Array(16)),
    ).toThrowError();
  });
});
