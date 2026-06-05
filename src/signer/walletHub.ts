import { bytesToHex, hexToBytes } from '../util';
import type { Signer } from '../types';

export interface WalletHubSignerConfig {
  /** Base URL of the wallet-hub signing service. */
  baseUrl: string;
  /** The agent's x-only public key, lowercase hex. */
  pubkeyHex: string;
  /**
   * Identifier the signing service uses to locate the agent's key
   * material (e.g. a Turnkey resource id or embedded-wallet id).
   */
  resourceId: string;
  /** Optional bearer token for the signing service. */
  apiKey?: string;
  /** Override the request path. Defaults to `/api/v1/sign`. */
  signPath?: string;
}

/**
 * Delegates signing to a remote wallet-hub / Turnkey-style service so the
 * agent process never holds raw key material. The service receives the
 * 32-byte message hash and returns a Schnorr signature.
 *
 * NOTE: the exact wallet-hub signing endpoint contract is still being
 * finalized; this client targets a simple `{ resourceId, messageHashHex }`
 * POST that returns `{ signatureHex }`. Adjust `signPath` / payload to
 * match the deployed service.
 */
export class WalletHubSigner implements Signer {
  readonly pubkeyHex: string;

  constructor(private readonly config: WalletHubSignerConfig) {
    this.pubkeyHex = config.pubkeyHex.toLowerCase().replace(/^0x/, '');
  }

  async signMessageHash(hash: Uint8Array): Promise<Uint8Array> {
    const url =
      this.config.baseUrl.replace(/\/+$/, '') +
      (this.config.signPath ?? '/api/v1/sign');

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.config.apiKey
          ? { authorization: `Bearer ${this.config.apiKey}` }
          : {}),
      },
      body: JSON.stringify({
        resourceId: this.config.resourceId,
        pubkey: this.pubkeyHex,
        messageHashHex: bytesToHex(hash),
      }),
    });

    if (!res.ok) {
      throw new Error(`wallet-hub sign failed: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as { signatureHex?: string };
    if (!body.signatureHex) {
      throw new Error('wallet-hub sign response missing signatureHex');
    }
    return hexToBytes(body.signatureHex);
  }
}
