import { z } from 'zod';
import type { Action, Plugin } from '../types';
import { bytesToHex, hexToBytes } from '../util';

const hex32 = z
  .string()
  .regex(/^(0x)?[0-9a-fA-F]{64}$/, 'expected a 32-byte hex pubkey');

/** Generic Arch chain reads: account info and chain tip. */
export function dataPlugin(): Plugin {
  const getAccountInfo: Action = {
    name: 'get_account_info',
    description:
      'Read an Arch account: owner, lamports, executable flag, and data length.',
    schema: z.object({
      address: hex32.describe('account pubkey hex'),
    }),
    handler: async (agent, input) => {
      const pubkey = hexToBytes(input.address);
      const info = await agent.rpc.readAccountInfo(pubkey);
      return {
        address: input.address.toLowerCase(),
        owner: bytesToHex(info.owner),
        lamports: info.lamports,
        executable: info.is_executable,
        dataLen: info.data.length,
      };
    },
  };

  const getChainTip: Action = {
    name: 'get_chain_tip',
    description: 'Get the current Arch block height and best block hash.',
    schema: z.object({}),
    handler: async (agent) => {
      const [height, hash] = await Promise.all([
        agent.rpc.getBlockCount(),
        agent.rpc.getBestBlockHash(),
      ]);
      return { height, hash };
    },
  };

  return { name: 'data', actions: [getAccountInfo, getChainTip] };
}
