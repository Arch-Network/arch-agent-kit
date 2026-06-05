import {
  RpcConnection,
  SanitizedMessageUtil,
  SignatureUtil,
  type Instruction,
  type RuntimeTransaction,
} from '@saturnbtcio/arch-sdk';
import type { Signer } from './types';
import { sleep, toBytes, toHex } from './util';

export class TxError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'TxError';
  }
}

export class TxRevertError extends Error {
  constructor(
    message: string,
    readonly txid: string,
    readonly logs?: string[],
  ) {
    super(message);
    this.name = 'TxRevertError';
  }
}

export class TxTimeoutError extends Error {
  constructor(readonly txid: string) {
    super(`transaction ${txid} not confirmed in time`);
    this.name = 'TxTimeoutError';
  }
}

export interface ConfirmOptions {
  onSubmitted?: (txid: string) => void;
  confirmTimeoutMs?: number;
  pollIntervalMs?: number;
}

const DEFAULT_CONFIRM_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 1_500;

export async function buildAndSign(
  rpc: RpcConnection,
  signer: Signer,
  instructions: Instruction[],
): Promise<RuntimeTransaction> {
  const blockhash = await rpc.getBestBlockHash();
  const blockhashBytes = toBytes(blockhash);
  const payerBytes = toBytes(signer.pubkeyHex);

  const messageOrErr = SanitizedMessageUtil.createSanitizedMessage(
    instructions,
    payerBytes,
    blockhashBytes,
  );
  if (typeof messageOrErr !== 'object' || !('instructions' in messageOrErr)) {
    throw new TxError(`message compile error: ${JSON.stringify(messageOrErr)}`);
  }
  const message = messageOrErr as Parameters<
    typeof SanitizedMessageUtil.hash
  >[0];
  const hash = SanitizedMessageUtil.hash(message);

  let rawSig: Uint8Array;
  try {
    rawSig = await signer.signMessageHash(hash);
  } catch (e) {
    throw new TxError(`signing failed: ${(e as Error).message ?? e}`, e);
  }
  const sig = SignatureUtil.adjustSignature(rawSig);

  return { version: 0, signatures: [sig], message };
}

export async function sendAndConfirm(
  rpc: RpcConnection,
  tx: RuntimeTransaction,
  opts: ConfirmOptions = {},
): Promise<string> {
  let txid: string;
  try {
    txid = toHex(await rpc.sendTransaction(tx));
  } catch (e) {
    throw new TxError((e as Error).message ?? 'failed to submit tx', e);
  }
  opts.onSubmitted?.(txid);
  await awaitConfirmation(rpc, txid, opts);
  return txid;
}

async function awaitConfirmation(
  rpc: RpcConnection,
  txid: string,
  opts: ConfirmOptions,
): Promise<void> {
  const timeoutMs = opts.confirmTimeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS;
  const pollMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    let processed;
    try {
      processed = await rpc.getProcessedTransaction(txid);
    } catch {
      processed = undefined;
    }

    if (processed) {
      const status = processed.status;
      const rolledBack = processed.rollback_status?.type === 'rolledback';
      if (status.type === 'failed' || rolledBack) {
        const detail =
          status.type === 'failed'
            ? status.message
            : processed.rollback_status?.type === 'rolledback'
              ? processed.rollback_status.message
              : 'transaction reverted';
        throw new TxRevertError(detail, txid, processed.logs);
      }
      if (status.type === 'processed') return;
    }
    await sleep(pollMs);
  }
  throw new TxTimeoutError(txid);
}
