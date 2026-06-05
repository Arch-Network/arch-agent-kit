import { PubkeyUtil, type Instruction } from '@saturnbtcio/arch-sdk';
import { hexToBytes, readU64le } from './util';

/**
 * Default APL program ids (Arch testnet). APL mirrors the SPL Token
 * layout and instruction set. Override via `AplConfig` for other
 * deployments.
 */
export const APL = {
  token: '06ddf6e1b9ea84412c10b8df021c100fc8871907c309c33535de209c341763bf',
  associatedToken:
    '8c97231184927b77b5f180118fcc683414b77c521e5a77081cf71d5f606a5384',
  system: '0000000000000000000000000000000000000000000000000000000000000000',
} as const;

export interface AplConfig {
  tokenProgram?: string;
  ataProgram?: string;
  systemProgram?: string;
}

function ids(cfg: AplConfig = {}) {
  return {
    token: hexToBytes(cfg.tokenProgram ?? APL.token),
    ata: hexToBytes(cfg.ataProgram ?? APL.associatedToken),
    system: hexToBytes(cfg.systemProgram ?? APL.system),
  };
}

/** Associated token account for `owner` + `mint`. */
export function associatedTokenAddress(
  owner: Uint8Array,
  mint: Uint8Array,
  cfg: AplConfig = {},
): Uint8Array {
  const { token, ata } = ids(cfg);
  return PubkeyUtil.getAssociatedTokenAddress(mint, owner, true, token, ata);
}

/** Read `amount: u64` from an APL token account's data bytes. */
export function readTokenAmount(data: Uint8Array): bigint {
  return readU64le(data, 64);
}

/** Read `supply: u64` from an APL mint account's data bytes. */
export function readMintSupply(data: Uint8Array): bigint {
  return readU64le(data, 36);
}

/** Read `decimals: u8` from an APL mint account's data bytes. */
export function readMintDecimals(data: Uint8Array): number {
  return data.length > 44 ? data[44]! : 0;
}

/** `create_associated_token_account` instruction. */
export function createAtaIx(
  funder: Uint8Array,
  ata: Uint8Array,
  owner: Uint8Array,
  mint: Uint8Array,
  cfg: AplConfig = {},
): Instruction {
  const id = ids(cfg);
  return {
    program_id: id.ata,
    accounts: [
      { pubkey: funder, is_signer: true, is_writable: true },
      { pubkey: ata, is_signer: false, is_writable: true },
      { pubkey: owner, is_signer: false, is_writable: false },
      { pubkey: mint, is_signer: false, is_writable: false },
      { pubkey: id.system, is_signer: false, is_writable: false },
      { pubkey: id.token, is_signer: false, is_writable: false },
    ],
    data: new Uint8Array(0),
  };
}

/** SPL/APL `Transfer { amount }` instruction (instruction index 3). */
export function transferIx(
  source: Uint8Array,
  destination: Uint8Array,
  owner: Uint8Array,
  amount: bigint,
  cfg: AplConfig = {},
): Instruction {
  const { token } = ids(cfg);
  const data = new Uint8Array(9);
  data[0] = 3;
  new DataView(data.buffer).setBigUint64(1, amount, true);
  return {
    program_id: token,
    accounts: [
      { pubkey: source, is_signer: false, is_writable: true },
      { pubkey: destination, is_signer: false, is_writable: true },
      { pubkey: owner, is_signer: true, is_writable: false },
    ],
    data,
  };
}
