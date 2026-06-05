import { describe, expect, it } from 'vitest';
import { schnorr } from '@noble/curves/secp256k1';
import { KeypairSigner } from '../src/signer/keypair';
import { hexToBytes } from '../src/util';

describe('KeypairSigner', () => {
  it('produces a 32-byte x-only pubkey and 64-byte signature', async () => {
    const signer = KeypairSigner.generate();
    expect(hexToBytes(signer.pubkeyHex).length).toBe(32);

    const hash = new Uint8Array(32).fill(7);
    const sig = await signer.signMessageHash(hash);
    expect(sig.length).toBe(64);
  });

  it('signs hashes that verify under BIP340 schnorr', async () => {
    const signer = KeypairSigner.generate();
    const hash = crypto.getRandomValues(new Uint8Array(32));
    const sig = await signer.signMessageHash(hash);
    const ok = schnorr.verify(sig, hash, hexToBytes(signer.pubkeyHex));
    expect(ok).toBe(true);
  });

  it('rejects non-32-byte private keys and hashes', async () => {
    expect(() =>
      KeypairSigner.fromPrivateKey(new Uint8Array(16)),
    ).toThrowError();
    const signer = KeypairSigner.generate();
    await expect(
      signer.signMessageHash(new Uint8Array(31)),
    ).rejects.toThrowError();
  });
});
