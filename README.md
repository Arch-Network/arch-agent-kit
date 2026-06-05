# Arch Agent Kit

Connect AI agents to [Arch Network](https://docs.arch.network). A plugin-based
toolkit that exposes on-chain Arch actions (wallet, Runes, prediction markets,
and more) as LLM tools for frameworks like the Vercel AI SDK, OpenAI function
calling, and ElizaOS.

Inspired by [Solana Agent Kit](https://github.com/sendaifun/solana-agent-kit),
adapted for Arch's Bitcoin-native runtime.

## Install

```bash
npm install arch-agent-kit
```

## Quick start

```ts
import {
  ArchAgentKit,
  KeypairSigner,
  walletPlugin,
  runesPlugin,
  dataPlugin,
  createVercelAITools,
} from 'arch-agent-kit';

const agent = new ArchAgentKit({
  rpcUrl: 'https://rpc.testnet.arch.network',
  titanUrl: 'https://titan.testnet.saturnbtc.io',
  signer: KeypairSigner.fromPrivateKeyHex(process.env.AGENT_PRIVKEY!),
  safety: {
    // Guardrails for autonomous operation.
    maxTransferBaseUnits: 10_000_000n,
    maxInstructionsPerTx: 6,
    // dryRun: true, // validate + build but never broadcast
  },
})
  .use(walletPlugin())
  .use(runesPlugin())
  .use(dataPlugin());

// Call an action directly...
const bal = await agent.run('get_token_balance', { mint: '<mint-hex>' });

// ...or hand the whole tool set to an LLM.
const tools = createVercelAITools(agent);
```

## Concepts

- **Signer** — authorizes transactions. `KeypairSigner` for full autonomy
  (BIP340 Schnorr, x-only pubkeys); `WalletHubSigner` to delegate signing to a
  remote/Turnkey service so the agent never holds raw keys.
- **Plugin** — bundles related `Action`s. Each action has a Zod schema and a
  handler, and is surfaced to LLMs as a tool.
- **SafetyGuard** — applied before every broadcast: program allowlist, max
  instructions per tx, per-transfer caps, and a global dry-run switch.

## Built-in plugins

- `walletPlugin()` — native ARCH + APL token balances and transfers.
- `runesPlugin()` — read-only Bitcoin/Runes data via Titan (requires `titanUrl`).
- `dataPlugin()` — generic Arch account / chain-tip reads.

More plugins (prediction markets, the agent launchpad) are added as the
on-chain surfaces land.

## Framework adapters

- `createVercelAITools(agent)` — tool set for the Vercel AI SDK.
- `createOpenAITools(agent)` + `executeTool(agent, name, args)` — OpenAI
  function-calling specs and dispatch.

## Development

```bash
npm install
npm test          # vitest
npm run typecheck # tsc --noEmit
npm run build     # tsup -> dist (cjs + esm + d.ts)
```

## License

MIT
