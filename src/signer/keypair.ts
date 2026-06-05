import * as ecc from '@bitcoinerlab/secp256k1';
import { schnorr } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { Signer as Bip322Signer } from 'bip322-js';
import { initEccLib, networks, payments } from 'bitcoinjs-lib';
import bs58 from 'bs58';
import { bytesToHex, hexToBytes } from '../util';
import type { Signer } from '../types';

initEccLib(ecc);

export type BitcoinNetwork = 'testnet' | 'mainnet';

/**
 * A local-keypair signer for Arch.
 *
 * Arch verifies a **BIP-322** signature (taproot key-path) over the
 * SanitizedMessage hash — *not* a bare BIP340 Schnorr signature. The hash
 * arrives as UTF-8 bytes of a 64-char hex string (see
 * `SanitizedMessageUtil.hash`); we decode it and sign the string with
 * `bip322-js`, returning the 66-byte witness that `SignatureUtil.adjustSignature`
 * trims to 64 bytes. Public keys are 32-byte x-only, matching Arch addresses.
 */
export class KeypairSigner implements Signer {
  readonly pubkeyHex: string;
  /** Taproot (p2tr) address for this key — fund the agent here. */
  readonly taprootAddress: string;
  private readonly wif: string;

  private constructor(
    private readonly privateKey: Uint8Array,
    private readonly network: BitcoinNetwork,
  ) {
    const xonly = schnorr.getPublicKey(privateKey);
    this.pubkeyHex = bytesToHex(xonly);
    this.wif = wifFromSecret(privateKey, network);
    const net = network === 'testnet' ? networks.testnet : networks.bitcoin;
    const { address } = payments.p2tr({
      internalPubkey: Buffer.from(xonly),
      network: net,
    });
    if (!address) throw new Error('failed to derive taproot address');
    this.taprootAddress = address;
  }

  static fromPrivateKeyHex(
    hex: string,
    network: BitcoinNetwork = 'testnet',
  ): KeypairSigner {
    return KeypairSigner.fromPrivateKey(hexToBytes(hex), network);
  }

  static fromPrivateKey(
    bytes: Uint8Array,
    network: BitcoinNetwork = 'testnet',
  ): KeypairSigner {
    if (bytes.length !== 32) {
      throw new Error('private key must be 32 bytes');
    }
    return new KeypairSigner(Uint8Array.from(bytes), network);
  }

  static generate(network: BitcoinNetwork = 'testnet'): KeypairSigner {
    return new KeypairSigner(schnorr.utils.randomPrivateKey(), network);
  }

  async signMessageHash(messageHashUtf8: Uint8Array): Promise<Uint8Array> {
    // The arch-sdk hash() returns UTF-8 bytes of a 64-char hex string; the
    // BIP-322 message is that string.
    const msg = new TextDecoder().decode(messageHashUtf8);
    const sigBase64 = Bip322Signer.sign(
      this.wif,
      this.taprootAddress,
      msg,
    ) as string;
    return base64ToBytes(sigBase64);
  }
}

function wifFromSecret(secret: Uint8Array, network: BitcoinNetwork): string {
  const prefix = network === 'testnet' ? 0xef : 0x80;
  const payload = new Uint8Array(34);
  payload[0] = prefix;
  payload.set(secret, 1);
  payload[33] = 0x01; // compressed
  const checksum = sha256(sha256(payload)).slice(0, 4);
  const full = new Uint8Array(payload.length + 4);
  full.set(payload);
  full.set(checksum, payload.length);
  return bs58.encode(full);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
