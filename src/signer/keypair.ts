import { schnorr } from '@noble/curves/secp256k1';
import { bytesToHex, hexToBytes } from '../util';
import type { Signer } from '../types';

/**
 * A local-keypair signer. Holds a secp256k1 private key and produces
 * BIP340 Schnorr signatures over the message hash, matching Arch's
 * x-only (32-byte) public keys and 64-byte signatures.
 *
 * Use for fully autonomous agents and tests. For managed-key / TEE setups
 * use `WalletHubSigner` instead.
 */
export class KeypairSigner implements Signer {
  readonly pubkeyHex: string;

  private constructor(private readonly privateKey: Uint8Array) {
    this.pubkeyHex = bytesToHex(schnorr.getPublicKey(privateKey));
  }

  static fromPrivateKeyHex(hex: string): KeypairSigner {
    const bytes = hexToBytes(hex);
    if (bytes.length !== 32) {
      throw new Error('private key must be 32 bytes');
    }
    return new KeypairSigner(bytes);
  }

  static fromPrivateKey(bytes: Uint8Array): KeypairSigner {
    if (bytes.length !== 32) {
      throw new Error('private key must be 32 bytes');
    }
    return new KeypairSigner(Uint8Array.from(bytes));
  }

  static generate(): KeypairSigner {
    return new KeypairSigner(schnorr.utils.randomPrivateKey());
  }

  async signMessageHash(hash: Uint8Array): Promise<Uint8Array> {
    if (hash.length !== 32) {
      throw new Error('message hash must be 32 bytes');
    }
    return schnorr.sign(hash, this.privateKey);
  }
}
