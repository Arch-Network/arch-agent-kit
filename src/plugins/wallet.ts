import { z } from 'zod';
import {
  associatedTokenAddress,
  createAtaIx,
  readMintDecimals,
  readTokenAmount,
  transferIx,
  type AplConfig,
} from '../apl';
import type { Action, Plugin } from '../types';
import { bytesToHex, formatAmount, hexToBytes, parseAmount } from '../util';

const hex32 = z
  .string()
  .regex(/^(0x)?[0-9a-fA-F]{64}$/, 'expected a 32-byte hex pubkey');

export interface WalletPluginOptions {
  apl?: AplConfig;
}

/**
 * Native ARCH + APL token balances and transfers for the agent's own
 * account. Transfers are bounded by `safety.maxTransferBaseUnits`.
 */
export function walletPlugin(opts: WalletPluginOptions = {}): Plugin {
  const apl = opts.apl ?? {};

  const getArchBalance: Action = {
    name: 'get_arch_balance',
    description:
      'Get the native ARCH balance (in lamports) of an account. Defaults to the agent account.',
    schema: z.object({
      address: hex32.optional().describe('account pubkey hex; defaults to self'),
    }),
    handler: async (agent, input) => {
      const pubkey = input.address
        ? hexToBytes(input.address)
        : agent.pubkey;
      const info = await agent.rpc.readAccountInfo(pubkey);
      return { address: bytesToHex(pubkey), lamports: info.lamports };
    },
  };

  const getTokenBalance: Action = {
    name: 'get_token_balance',
    description:
      'Get the APL token balance for a given mint. Defaults to the agent account.',
    schema: z.object({
      mint: hex32.describe('token mint pubkey hex'),
      owner: hex32.optional().describe('owner pubkey hex; defaults to self'),
    }),
    handler: async (agent, input) => {
      const owner = input.owner ? hexToBytes(input.owner) : agent.pubkey;
      const mint = hexToBytes(input.mint);
      const ata = associatedTokenAddress(owner, mint, apl);

      let decimals = 0;
      try {
        const mintInfo = await agent.rpc.readAccountInfo(mint);
        decimals = readMintDecimals(mintInfo.data);
      } catch {
        decimals = 0;
      }

      let raw = 0n;
      try {
        const acct = await agent.rpc.readAccountInfo(ata);
        raw = readTokenAmount(acct.data);
      } catch {
        raw = 0n;
      }

      return {
        owner: bytesToHex(owner),
        mint: input.mint.toLowerCase(),
        ata: bytesToHex(ata),
        amountBaseUnits: raw.toString(),
        decimals,
        amount: formatAmount(raw, decimals),
      };
    },
  };

  const transferToken: Action = {
    name: 'transfer_token',
    description:
      'Transfer APL tokens from the agent account to a recipient. Amount is human-readable (e.g. "1.5").',
    schema: z.object({
      mint: hex32.describe('token mint pubkey hex'),
      to: hex32.describe('recipient owner pubkey hex'),
      amount: z.string().describe('human-readable amount, e.g. "10.5"'),
    }),
    handler: async (agent, input) => {
      const owner = agent.pubkey;
      const mint = hexToBytes(input.mint);
      const recipient = hexToBytes(input.to);

      const mintInfo = await agent.rpc.readAccountInfo(mint);
      const decimals = readMintDecimals(mintInfo.data);
      const amount = parseAmount(input.amount, decimals);
      agent.safety.checkTransferAmount(amount);

      const source = associatedTokenAddress(owner, mint, apl);
      const dest = associatedTokenAddress(recipient, mint, apl);

      const ixs = [];
      // Create the recipient ATA if it doesn't exist yet.
      let destExists = false;
      try {
        await agent.rpc.readAccountInfo(dest);
        destExists = true;
      } catch {
        destExists = false;
      }
      if (!destExists) {
        ixs.push(createAtaIx(owner, dest, recipient, mint, apl));
      }
      ixs.push(transferIx(source, dest, owner, amount, apl));

      const txid = await agent.submit(ixs);
      return {
        txid,
        mint: input.mint.toLowerCase(),
        to: input.to.toLowerCase(),
        amountBaseUnits: amount.toString(),
      };
    },
  };

  return {
    name: 'wallet',
    actions: [getArchBalance, getTokenBalance, transferToken],
  };
}
