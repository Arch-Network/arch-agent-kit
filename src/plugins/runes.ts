import { z } from 'zod';
import type { Action, Plugin } from '../types';

/**
 * Read-only Bitcoin/Runes data via Titan. Gives the agent visibility into
 * Rune balances, supply, and Bitcoin tip — the data layer it trades on.
 * Requires `titanUrl` in the agent config.
 */
export function runesPlugin(): Plugin {
  const requireTitan = (agent: { titan?: unknown }) => {
    if (!agent.titan) {
      throw new Error('runesPlugin requires `titanUrl` in the agent config');
    }
    return agent.titan as import('@titanbtcio/sdk').TitanHttpClient;
  };

  const getAddressRunes: Action = {
    name: 'get_address_runes',
    description: 'List the Rune balances held by a Bitcoin address.',
    schema: z.object({
      address: z.string().describe('Bitcoin address'),
    }),
    handler: async (agent, input) => {
      const titan = requireTitan(agent);
      const data = await titan.getAddress(input.address);
      return {
        address: input.address,
        valueSats: data.value,
        runes: data.runes,
      };
    },
  };

  const getRune: Action = {
    name: 'get_rune',
    description:
      'Get details (supply, divisibility, etching) for a Rune by name or id.',
    schema: z.object({
      rune: z.string().describe('Rune name or id'),
    }),
    handler: async (agent, input) => {
      const titan = requireTitan(agent);
      const rune = await titan.getRune(input.rune);
      if (!rune) return { rune: input.rune, found: false };
      return { found: true, ...rune };
    },
  };

  const getBitcoinTip: Action = {
    name: 'get_bitcoin_tip',
    description: 'Get the current Bitcoin chain tip (height + hash).',
    schema: z.object({}),
    handler: async (agent) => {
      const titan = requireTitan(agent);
      return titan.getTip();
    },
  };

  return {
    name: 'runes',
    actions: [getAddressRunes, getRune, getBitcoinTip],
  };
}
