// Creator-authored trading strategy: the single source of truth for the
// `StrategyConfig` schema, its binary codec, and the metadata-description tag
// both the web app (encode at launch) and the agent runtime (decode at trade
// time) share. Keeping ONE codec here is deliberate: a dual codec would drift,
// and the app + runtime MUST agree on the exact byte layout for a creator's
// strategy to actually execute.
//
// Wire format, little-endian, fixed header then mandate. Bytes 0..31 are shared
// by v1 and v2; v2 inserts six u8 style fields at 32..37 (so v1 stays decodable
// by branching on the version byte). `asset` and `indicator` are append-only
// enum indices, so older agents keep decoding as new tickers/indicators land.
//
// v1 (34-byte header):
//   0  version (=1)        u8
//   1  asset               u8   0=BTC 1=ETH
//   2  direction           u8   0=momentum 1=reversion
//   3  indicator           u8   0=ma 1=breakout
//   4  entryThresholdBps   u16
//   6  trendConfirmTicks   u8
//   7  sizeBps             u16
//   9  maxTradeBaseUnits   u64
//  17  arenaSide           u8   0=follow 1=longOnly 2=shortOnly 3=off
//  18  arenaSizeBps        u16
//  20  arenaHoldTicks      u8
//  21  buybackBps          u16
//  23  dailyLossCapBaseUnits u64
//  31  llmEnabled          u8   0/1
//  32  mandateLen          u16
//  34  mandate             utf8[mandateLen]
//
// v2 (40-byte header): identical through byte 31, then:
//  32  lookback            u8   history/MA window
//  33  maFast              u8   fast EMA period (emaCross)
//  34  maSlow              u8   slow EMA period (emaCross)
//  35  rsiPeriod           u8   RSI period (rsi)
//  36  rsiOversold         u8   RSI buy band for reversion (0..100)
//  37  rsiOverbought       u8   RSI sell band (0..100)
//  38  mandateLen          u16
//  40  mandate             utf8[mandateLen]
//
// v3 (variable header): identical through byte 37, then:
//  38  holdHorizonSecs     u32  hold duration in seconds (0=use arenaHoldTicks)
//  42  leverage            u8   1/2/5 (runtime CLAMPS to 1x; forward-compat)
//  43  portfolioCount      u8   0=single-asset (use `asset`), 1-6=multi-asset
//  44  portfolioEntries    [assetIndex u8, weightBps u16] × portfolioCount
//  44+portfolioCount*3     mandateLen  u16
//  46+portfolioCount*3     mandate     utf8[mandateLen]
//
// An empty v2 mandate => 40 bytes total (~56 base64 chars), far under the
// 512-byte metadata description budget. The config is embedded in the human
// description as `<prose>\n[s1]<base64>[/s1]` so the prose stays readable and
// explorers/wallets still show something sensible.

export type StrategyAsset = 'BTC' | 'ETH' | 'SOL' | 'XRP' | 'DOGE' | 'AVAX';
export type StrategyDirection = 'momentum' | 'reversion';
export type StrategyIndicator = 'ma' | 'breakout' | 'emaCross' | 'rsi' | 'fib';
export type ArenaSide = 'follow' | 'longOnly' | 'shortOnly' | 'off';

/** One signal market the agents can read. The Coinbase product is always
 *  `${ticker}-USD`, so this single table is the source of truth consumed by the
 *  app (choice cards), the runtime (fetch + arena allow-list), and display. */
export interface AssetMeta {
  ticker: StrategyAsset;
  /** Full name shown in the UI. */
  label: string;
  /** One-line description for choice cards. */
  blurb: string;
}

// APPEND-ONLY: BTC=0, ETH=1 must keep their indices (the `asset` byte is an enum
// index, so reordering would silently re-point existing agents). New tickers get
// the next index and must have a live Coinbase `<TICKER>-USD` spot feed.
export const ASSET_TABLE: readonly AssetMeta[] = [
  { ticker: 'BTC', label: 'Bitcoin', blurb: 'The deepest, most-watched crypto trend.' },
  { ticker: 'ETH', label: 'Ether', blurb: 'Moves with BTC, but with its own swings.' },
  { ticker: 'SOL', label: 'Solana', blurb: 'High-beta L1 — fast, volatile moves.' },
  { ticker: 'XRP', label: 'XRP', blurb: 'Trades on its own news-driven cycles.' },
  { ticker: 'DOGE', label: 'Dogecoin', blurb: 'The original memecoin — sentiment-led.' },
  { ticker: 'AVAX', label: 'Avalanche', blurb: 'L1 with sharp risk-on swings.' },
] as const;

/** All known tickers, in enum-index order (BTC, ETH, …). */
export const ASSET_TICKERS: readonly StrategyAsset[] = ASSET_TABLE.map(
  (a) => a.ticker,
);

/** Coinbase spot product id for a ticker (the only place the suffix lives). */
export function coinbaseProduct(ticker: StrategyAsset): string {
  return `${ticker}-USD`;
}

/** Metadata for a ticker, or undefined if unknown. */
export function assetMeta(ticker: string): AssetMeta | undefined {
  return ASSET_TABLE.find((a) => a.ticker === ticker);
}

/** True if `s` is a known ticker (uppercase-exact). */
export function isKnownAsset(s: string): s is StrategyAsset {
  return ASSET_TABLE.some((a) => a.ticker === s);
}

/** One entry in a v3 multi-asset portfolio weight vector. */
export interface PortfolioEntry {
  asset: StrategyAsset;
  /** Fraction of the arena budget allocated to this asset, in bps. */
  weightBps: number;
}

export interface StrategyConfig {
  /** Schema version; bump on any layout change so old agents keep decoding. */
  version: number;
  asset: StrategyAsset;
  direction: StrategyDirection;
  indicator: StrategyIndicator;
  /** Min signal move (bps) from the last trade price before acting again. */
  entryThresholdBps: number;
  /** Consecutive same-direction ticks that force a trade regardless of move. */
  trendConfirmTicks: number;
  /** Fraction of treasury deployed per buy, in bps (e.g. 2500 = 25%). */
  sizeBps: number;
  /** Per-trade hard cap (reserve base units). 0 = use the protocol ceiling. */
  maxTradeBaseUnits: bigint;
  arenaSide: ArenaSide;
  /** Fraction of reserve locked per arena position, in bps. */
  arenaSizeBps: number;
  /** Ticks an arena position is held before closing to realize P&L. */
  arenaHoldTicks: number;
  /** Fraction of realized arena profit routed to buyback-and-burn, in bps. */
  buybackBps: number;
  /** Per-agent daily treasury drawdown that pauses it (base units). 0 = off. */
  dailyLossCapBaseUnits: bigint;
  /** v2: price-history window (ticks) for ma/breakout and the buffer floor. */
  lookback: number;
  /** v2: fast EMA period (emaCross indicator). */
  maFast: number;
  /** v2: slow EMA period (emaCross indicator). */
  maSlow: number;
  /** v2: RSI period (rsi indicator). */
  rsiPeriod: number;
  /** v2: RSI lower band — reversion buys when RSI dips below it (0..100). */
  rsiOversold: number;
  /** v2: RSI upper band — the overbought reference (0..100). */
  rsiOverbought: number;
  /** Phase 2: free-text LLM mandate (sanitized, capped). '' when unused. */
  mandate: string;
  /** Phase 2: opt this agent into LLM decisioning (still gated by a key). */
  llmEnabled: boolean;

  // ── v3 fields ──────────────────────────────────────────────────────────

  /** Hold duration in seconds. 0 = use arenaHoldTicks (v2 backward compat).
   *  Clamped to MAX_HOLD_HORIZON_SECS (7 days). */
  holdHorizonSecs: number;
  /** Leverage tier (1/2/5). Runtime CLAMPS execution to 1x; the field is
   *  forward-compat for a future on-chain program upgrade (see leverage spec). */
  leverage: number;
  /** Multi-asset portfolio weights. Empty array = single-asset mode (the agent
   *  trades only the `asset` field, preserving v1/v2 behavior). When non-empty,
   *  each entry's weightBps share of arenaSizeBps is allocated to that asset.
   *  The on-chain Position-per-(market,owner) already permits concurrent positions. */
  portfolio: PortfolioEntry[];
}

export const STRATEGY_VERSION = 3;

/** Max bps for size/arena/buyback fields (100%). */
export const STRATEGY_BPS_MAX = 10_000;

/** Mandate hard length cap (UTF-8 bytes) so the encoded config fits the budget. */
export const MANDATE_MAX_BYTES = 200;

/** Upper bound for period/window fields (fits a u8; keeps history buffers sane). */
export const STRATEGY_PERIOD_MAX = 240;

/** Maximum hold horizon: 7 days in seconds. Positions held longer than this are
 *  force-closed. Capped here to bound funding cost exposure. */
export const MAX_HOLD_HORIZON_SECS = 7 * 24 * 60 * 60; // 604800

/** Valid leverage tiers. Only 1x is executed; 2x/5x are forward-compat. */
export const LEVERAGE_TIERS = [1, 2, 5] as const;

/** Maximum assets in a portfolio weight vector (matches the 6-market on-chain set). */
export const MAX_PORTFOLIO_SIZE = 6;

/** Markers wrapping the base64 config inside the metadata description. */
export const STRATEGY_TAG_OPEN = '[s1]';
export const STRATEGY_TAG_CLOSE = '[/s1]';

/** Byte size of the encoded binary (not base64) for a v3 config with a given
 *  portfolio length and mandate byte length. Used to compute the metadata
 *  description budget in the wizard. */
export function encodedByteSize(portfolioCount: number, mandateBytes: number): number {
  return V3_PREFIX_BYTES + portfolioCount * 3 + 2 + mandateBytes;
}

// Enum tables are APPEND-ONLY: an index, once shipped, must keep its meaning so
// already-launched agents decode to the same value. ASSETS is derived from the
// single shared asset table.
const ASSETS: readonly StrategyAsset[] = ASSET_TICKERS;
const DIRECTIONS: readonly StrategyDirection[] = ['momentum', 'reversion'];
const INDICATORS: readonly StrategyIndicator[] = [
  'ma',
  'breakout',
  'emaCross',
  'rsi',
  'fib',
];
const ARENA_SIDES: readonly ArenaSide[] = [
  'follow',
  'longOnly',
  'shortOnly',
  'off',
];

/** v1 fixed header size; v1 agents still decode at this layout. */
const V1_HEADER_BYTES = 34;
/** v2 fixed header size (v1 + six u8 style fields). */
const V2_HEADER_BYTES = 40;
/** v3 fixed prefix size (v2 + u32 holdHorizonSecs + u8 leverage + u8 portfolioCount). */
const V3_PREFIX_BYTES = 44;

/** Sensible defaults that mirror the legacy hash-derived archetype behavior.
 *  The v2 style fields default so an untouched config trades like a v1 agent
 *  (lookback 6 = the legacy WINDOW; ema/rsi params unused unless selected). */
export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  version: STRATEGY_VERSION,
  asset: 'BTC',
  direction: 'momentum',
  indicator: 'ma',
  entryThresholdBps: 50,
  trendConfirmTicks: 3,
  sizeBps: 2500,
  maxTradeBaseUnits: 0n,
  arenaSide: 'follow',
  arenaSizeBps: 1000,
  arenaHoldTicks: 3,
  buybackBps: 5000,
  dailyLossCapBaseUnits: 0n,
  lookback: 6,
  maFast: 3,
  maSlow: 8,
  rsiPeriod: 14,
  rsiOversold: 30,
  rsiOverbought: 70,
  mandate: '',
  llmEnabled: false,
  holdHorizonSecs: 0,
  leverage: 1,
  portfolio: [],
};

/** Defaults for the v2 style fields, applied when decoding a v1 agent. */
const V1_STYLE_DEFAULTS = {
  lookback: DEFAULT_STRATEGY_CONFIG.lookback,
  maFast: DEFAULT_STRATEGY_CONFIG.maFast,
  maSlow: DEFAULT_STRATEGY_CONFIG.maSlow,
  rsiPeriod: DEFAULT_STRATEGY_CONFIG.rsiPeriod,
  rsiOversold: DEFAULT_STRATEGY_CONFIG.rsiOversold,
  rsiOverbought: DEFAULT_STRATEGY_CONFIG.rsiOverbought,
} as const;

/** Defaults for the v3 fields, applied when decoding a v1 or v2 agent. */
const V3_FIELD_DEFAULTS = {
  holdHorizonSecs: DEFAULT_STRATEGY_CONFIG.holdHorizonSecs,
  leverage: DEFAULT_STRATEGY_CONFIG.leverage,
  portfolio: DEFAULT_STRATEGY_CONFIG.portfolio,
} as const;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function clampInt(n: number, max: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  const r = Math.round(n);
  return r > max ? max : r;
}

/** Clamp a period/window into [min, max], falling back to `dflt` for junk. */
function clampRange(n: number, min: number, max: number, dflt: number): number {
  if (!Number.isFinite(n) || n <= 0) return dflt;
  const r = Math.round(n);
  if (r < min) return min;
  if (r > max) return max;
  return r;
}

function enumIndex<T>(table: readonly T[], value: T, label: string): number {
  const i = table.indexOf(value);
  if (i < 0) throw new Error(`invalid strategy ${label}: ${String(value)}`);
  return i;
}

function enumValue<T>(table: readonly T[], i: number, label: string): T {
  const v = table[i];
  if (v === undefined) throw new Error(`unknown strategy ${label} index ${i}`);
  return v;
}

/** Encode a config to its compact binary form. Numeric fields are clamped to
 *  their wire ranges so a malformed input can't silently corrupt the bytes. */
export function encodeStrategy(cfg: StrategyConfig): Uint8Array {
  const mandateBytes = textEncoder.encode(cfg.mandate ?? '');
  if (mandateBytes.length > MANDATE_MAX_BYTES) {
    throw new Error(
      `mandate too long: ${mandateBytes.length} > ${MANDATE_MAX_BYTES} bytes`,
    );
  }
  const portfolio = cfg.portfolio ?? [];
  if (portfolio.length > MAX_PORTFOLIO_SIZE) {
    throw new Error(
      `portfolio too large: ${portfolio.length} > ${MAX_PORTFOLIO_SIZE}`,
    );
  }
  const portfolioBytes = portfolio.length * 3;
  const totalSize = V3_PREFIX_BYTES + portfolioBytes + 2 + mandateBytes.length;
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);
  // Bytes 0-37: identical across v1/v2/v3.
  out[0] = STRATEGY_VERSION;
  out[1] = enumIndex(ASSETS, cfg.asset, 'asset');
  out[2] = enumIndex(DIRECTIONS, cfg.direction, 'direction');
  out[3] = enumIndex(INDICATORS, cfg.indicator, 'indicator');
  view.setUint16(4, clampInt(cfg.entryThresholdBps, 0xffff), true);
  out[6] = clampInt(cfg.trendConfirmTicks, 0xff);
  view.setUint16(7, clampInt(cfg.sizeBps, 0xffff), true);
  view.setBigUint64(9, BigInt.asUintN(64, cfg.maxTradeBaseUnits), true);
  out[17] = enumIndex(ARENA_SIDES, cfg.arenaSide, 'arenaSide');
  view.setUint16(18, clampInt(cfg.arenaSizeBps, 0xffff), true);
  out[20] = clampInt(cfg.arenaHoldTicks, 0xff);
  view.setUint16(21, clampInt(cfg.buybackBps, 0xffff), true);
  view.setBigUint64(23, BigInt.asUintN(64, cfg.dailyLossCapBaseUnits), true);
  out[31] = cfg.llmEnabled ? 1 : 0;
  // v2 style fields (six u8).
  out[32] = clampInt(cfg.lookback, 0xff);
  out[33] = clampInt(cfg.maFast, 0xff);
  out[34] = clampInt(cfg.maSlow, 0xff);
  out[35] = clampInt(cfg.rsiPeriod, 0xff);
  out[36] = clampInt(cfg.rsiOversold, 0xff);
  out[37] = clampInt(cfg.rsiOverbought, 0xff);
  // v3 fields.
  view.setUint32(38, clampInt(cfg.holdHorizonSecs ?? 0, MAX_HOLD_HORIZON_SECS), true);
  out[42] = clampLeverage(cfg.leverage ?? 1);
  out[43] = portfolio.length;
  let off = V3_PREFIX_BYTES;
  for (const entry of portfolio) {
    out[off] = enumIndex(ASSETS, entry.asset, 'portfolio asset');
    view.setUint16(off + 1, clampInt(entry.weightBps, 0xffff), true);
    off += 3;
  }
  view.setUint16(off, mandateBytes.length, true);
  out.set(mandateBytes, off + 2);
  return out;
}

function clampLeverage(n: number): number {
  if (n === 5) return 5;
  if (n === 2) return 2;
  return 1;
}

/** Decode binary into a config. Decodes v1 (legacy 34-byte header), v2
 *  (40-byte header), and v3 (variable header with hold horizon + leverage +
 *  portfolio). Older versions get the newer fields defaulted so they trade
 *  exactly as before. Throws on a bad version, truncation, or an unknown enum
 *  so callers can fall back to a safe default. */
export function decodeStrategy(bytes: Uint8Array): StrategyConfig {
  if (bytes.length < V1_HEADER_BYTES) {
    throw new Error('strategy bytes truncated');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[0]!;
  if (version !== 1 && version !== 2 && version !== 3) {
    throw new Error(`unsupported strategy version ${version}`);
  }

  // v2 style fields (bytes 32-37): v1 defaults them, v2+ reads them.
  const style =
    version === 1
      ? { ...V1_STYLE_DEFAULTS }
      : {
          lookback: bytes[32]!,
          maFast: bytes[33]!,
          maSlow: bytes[34]!,
          rsiPeriod: bytes[35]!,
          rsiOversold: bytes[36]!,
          rsiOverbought: bytes[37]!,
        };

  // v3 fields: hold horizon, leverage, portfolio. v1/v2 default them.
  let v3Fields: { holdHorizonSecs: number; leverage: number; portfolio: PortfolioEntry[] };
  let mandateLenOff: number;
  let headerBytes: number;

  if (version <= 2) {
    v3Fields = { ...V3_FIELD_DEFAULTS };
    mandateLenOff = version === 1 ? 32 : 38;
    headerBytes = version === 1 ? V1_HEADER_BYTES : V2_HEADER_BYTES;
  } else {
    if (bytes.length < V3_PREFIX_BYTES) {
      throw new Error('strategy v3 bytes truncated');
    }
    const holdHorizonSecs = view.getUint32(38, true);
    const leverage = bytes[42]!;
    const portfolioCount = bytes[43]!;
    if (portfolioCount > MAX_PORTFOLIO_SIZE) {
      throw new Error(`strategy portfolio count ${portfolioCount} exceeds max`);
    }
    const portfolioEnd = V3_PREFIX_BYTES + portfolioCount * 3;
    if (bytes.length < portfolioEnd + 2) {
      throw new Error('strategy v3 portfolio truncated');
    }
    const portfolio: PortfolioEntry[] = [];
    for (let i = 0; i < portfolioCount; i++) {
      const off = V3_PREFIX_BYTES + i * 3;
      portfolio.push({
        asset: enumValue(ASSETS, bytes[off]!, 'portfolio asset'),
        weightBps: view.getUint16(off + 1, true),
      });
    }
    v3Fields = { holdHorizonSecs, leverage, portfolio };
    mandateLenOff = portfolioEnd;
    headerBytes = portfolioEnd + 2;
  }

  const mandateLen = view.getUint16(mandateLenOff, true);
  if (mandateLen > MANDATE_MAX_BYTES) {
    throw new Error(`strategy mandate length ${mandateLen} exceeds cap`);
  }
  if (bytes.length < headerBytes + mandateLen) {
    throw new Error('strategy mandate truncated');
  }
  const mandate = textDecoder.decode(
    bytes.slice(headerBytes, headerBytes + mandateLen),
  );

  return {
    version,
    asset: enumValue(ASSETS, bytes[1]!, 'asset'),
    direction: enumValue(DIRECTIONS, bytes[2]!, 'direction'),
    indicator: enumValue(INDICATORS, bytes[3]!, 'indicator'),
    entryThresholdBps: view.getUint16(4, true),
    trendConfirmTicks: bytes[6]!,
    sizeBps: view.getUint16(7, true),
    maxTradeBaseUnits: view.getBigUint64(9, true),
    arenaSide: enumValue(ARENA_SIDES, bytes[17]!, 'arenaSide'),
    arenaSizeBps: view.getUint16(18, true),
    arenaHoldTicks: bytes[20]!,
    buybackBps: view.getUint16(21, true),
    dailyLossCapBaseUnits: view.getBigUint64(23, true),
    ...style,
    llmEnabled: bytes[31] === 1,
    mandate,
    ...v3Fields,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** The `[s1]base64[/s1]` tag for a config, with a leading newline separator. */
export function encodeStrategyTag(cfg: StrategyConfig): string {
  return `\n${STRATEGY_TAG_OPEN}${bytesToBase64(encodeStrategy(cfg))}${STRATEGY_TAG_CLOSE}`;
}

/** Build a metadata description: human prose followed by the encoded config. */
export function embedStrategy(humanText: string, cfg: StrategyConfig): string {
  return `${humanText}${encodeStrategyTag(cfg)}`;
}

/** Pull the raw base64 payload out of a description, or null if absent. */
export function extractStrategyBase64(description: string): string | null {
  const start = description.indexOf(STRATEGY_TAG_OPEN);
  if (start < 0) return null;
  const from = start + STRATEGY_TAG_OPEN.length;
  const end = description.indexOf(STRATEGY_TAG_CLOSE, from);
  if (end < 0) return null;
  return description.slice(from, end).trim();
}

/** Decode the embedded config from a description, or null if absent/invalid. */
export function decodeStrategyFromDescription(
  description: string,
): StrategyConfig | null {
  const b64 = extractStrategyBase64(description);
  if (b64 === null) return null;
  try {
    return decodeStrategy(base64ToBytes(b64));
  } catch {
    return null;
  }
}

/** The human prose with the strategy tag removed, trimmed. */
export function stripStrategyTag(description: string): string {
  const start = description.indexOf(STRATEGY_TAG_OPEN);
  if (start < 0) return description.trim();
  const end = description.indexOf(STRATEGY_TAG_CLOSE, start);
  const tail =
    end < 0 ? '' : description.slice(end + STRATEGY_TAG_CLOSE.length);
  return (description.slice(0, start) + tail).trim();
}

/** Strip control characters and cap a mandate to its byte budget. */
export function sanitizeMandate(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  let bytes = textEncoder.encode(cleaned);
  if (bytes.length <= MANDATE_MAX_BYTES) return cleaned;
  // Truncate on a UTF-8 boundary by decoding a clamped byte slice.
  bytes = bytes.slice(0, MANDATE_MAX_BYTES);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes).trim();
}

export interface StrategyCeilings {
  /** Protocol per-trade ceiling (reserve base units). */
  maxTradeBaseUnits: bigint;
}

/**
 * Clamp a decoded config so it can only ever be MORE conservative than the
 * protocol's hard ceilings — never less. A hostile or buggy config can shrink
 * sizing or tighten loss caps, but can't exceed the global limits.
 */
export function clampStrategy(
  cfg: StrategyConfig,
  ceilings: StrategyCeilings,
): StrategyConfig {
  const ceil = ceilings.maxTradeBaseUnits;
  const perTrade =
    cfg.maxTradeBaseUnits <= 0n
      ? ceil
      : cfg.maxTradeBaseUnits < ceil
        ? cfg.maxTradeBaseUnits
        : ceil;
  const dailyLoss =
    cfg.dailyLossCapBaseUnits > 0n && cfg.dailyLossCapBaseUnits < ceil
      ? cfg.dailyLossCapBaseUnits
      : cfg.dailyLossCapBaseUnits > 0n
        ? ceil
        : 0n;
  // Bound the v2 style fields so a malformed/hostile config can't blow up the
  // runtime's history buffer or invert the RSI bands. These don't affect the
  // size/loss conservatism guarantee above; they just keep the engine sane.
  const d = DEFAULT_STRATEGY_CONFIG;
  const rsiOversold = clampRange(cfg.rsiOversold, 1, 99, d.rsiOversold);
  const rsiOverbought = clampRange(cfg.rsiOverbought, 1, 99, d.rsiOverbought);
  const holdHorizonSecs = clampInt(cfg.holdHorizonSecs ?? 0, MAX_HOLD_HORIZON_SECS);
  const leverage = clampLeverage(cfg.leverage ?? 1);
  const portfolio = (cfg.portfolio ?? [])
    .slice(0, MAX_PORTFOLIO_SIZE)
    .map((e) => ({
      asset: ASSETS.includes(e.asset) ? e.asset : ASSETS[0]!,
      weightBps: clampInt(e.weightBps, STRATEGY_BPS_MAX),
    }));
  return {
    ...cfg,
    sizeBps: clampInt(cfg.sizeBps, STRATEGY_BPS_MAX),
    arenaSizeBps: clampInt(cfg.arenaSizeBps, STRATEGY_BPS_MAX),
    buybackBps: clampInt(cfg.buybackBps, STRATEGY_BPS_MAX),
    maxTradeBaseUnits: perTrade,
    dailyLossCapBaseUnits: dailyLoss,
    lookback: clampRange(cfg.lookback, 2, STRATEGY_PERIOD_MAX, d.lookback),
    maFast: clampRange(cfg.maFast, 1, STRATEGY_PERIOD_MAX, d.maFast),
    maSlow: clampRange(cfg.maSlow, 2, STRATEGY_PERIOD_MAX, d.maSlow),
    rsiPeriod: clampRange(cfg.rsiPeriod, 2, STRATEGY_PERIOD_MAX, d.rsiPeriod),
    // Keep the bands ordered so oversold < overbought even if a config swaps them.
    rsiOversold: Math.min(rsiOversold, rsiOverbought),
    rsiOverbought: Math.max(rsiOversold, rsiOverbought),
    mandate: sanitizeMandate(cfg.mandate),
    holdHorizonSecs,
    leverage,
    portfolio,
  };
}

/** Short display label for a config (used where there's no archetype label). */
export function strategyLabel(cfg: StrategyConfig): string {
  const assets =
    cfg.portfolio.length > 0
      ? cfg.portfolio.map((e) => e.asset).join('/')
      : cfg.asset;
  const horizon = horizonLabel(cfg);
  return horizon ? `${assets} ${cfg.direction} (${horizon})` : `${assets} ${cfg.direction}`;
}

/** Human-readable horizon class for a config. */
export function horizonLabel(cfg: StrategyConfig): string {
  const secs = effectiveHoldSecs(cfg);
  if (secs <= 600) return 'scalper';
  if (secs <= 86_400) return 'swing';
  return 'position';
}

/** Effective hold duration in seconds, reconciling holdHorizonSecs with the
 *  legacy arenaHoldTicks (at 60s/tick). v1/v2 agents with holdHorizonSecs=0
 *  fall through to arenaHoldTicks. */
export function effectiveHoldSecs(cfg: StrategyConfig, tickIntervalSecs = 60): number {
  if (cfg.holdHorizonSecs > 0) return cfg.holdHorizonSecs;
  return (cfg.arenaHoldTicks || 3) * tickIntervalSecs;
}

/** Expected round-trip arena cost for one position at a given hold horizon.
 *  Open+close fee = 20 bps total. Funding = 1 bps/hr. */
export function estimatedRoundTripCostBps(holdSecs: number): number {
  const feeBps = 20;
  const fundingBps = (holdSecs / 3600) * 1;
  return Math.round(feeBps + fundingBps);
}

// ───────────────────────── Signal evaluation (shared) ─────────────────────────
// The ONE implementation of indicator + direction → buy/not-buy, used by the
// runtime's live signal engine (runtime/src/strategy/signal.ts) and the app's
// wizard simulator, so what the preview shows is exactly what the agent runs.

function seriesMean(series: number[]): number {
  if (series.length === 0) return 0;
  return series.reduce((a, b) => a + b, 0) / series.length;
}

/** Exponential moving average over the whole series (seeded at the first point). */
function seriesEma(series: number[], period: number): number {
  if (series.length === 0) return 0;
  const k = 2 / (Math.max(period, 1) + 1);
  let e = series[0]!;
  for (let i = 1; i < series.length; i++) e = series[i]! * k + e * (1 - k);
  return e;
}

/** Wilder-style RSI over the last `period` deltas; 50 when undefined. */
function seriesRsi(series: number[], period: number): number {
  if (series.length < 2) return 50;
  const n = Math.min(Math.max(period, 1), series.length - 1);
  let gains = 0;
  let losses = 0;
  for (let i = series.length - n; i < series.length; i++) {
    const d = series[i]! - series[i - 1]!;
    if (d >= 0) gains += d;
    else losses -= d;
  }
  if (gains + losses === 0) return 50;
  const rs = gains / (losses || 1e-9);
  return 100 - 100 / (1 + rs);
}

/** One signal verdict: buy (or risk-off when false) plus the reference level
 *  used in human-readable trade reasons. */
export interface SignalVerdict {
  buy: boolean;
  ref: number;
}

/**
 * Collapse the configured indicator + direction into one buy/not-buy signal.
 * `history` is the price series INCLUDING the current price as its last
 * element. Semantics per indicator:
 *
 * - ma:       spot vs the lookback moving average.
 * - breakout: new lookback highs/lows (holds to the MA in between).
 * - emaCross: fast EMA above/below slow EMA (whole history).
 * - rsi:      momentum buys strength (RSI>50); reversion buys oversold dips
 *             (RSI<rsiOversold) — an asymmetric band, not a plain sign flip.
 * - fib:      golden-ratio bands of the lookback swing. Momentum buys while
 *             price holds the upper zone (above the 61.8% level); reversion
 *             buys the discount zone (below the 38.2% level). A flat swing
 *             falls back to the MA.
 *
 * For ma/breakout/emaCross, reversion is the mirror of momentum (buy weakness
 * instead of strength).
 */
export function evaluateSignal(
  history: number[],
  config: Pick<
    StrategyConfig,
    | 'direction'
    | 'indicator'
    | 'lookback'
    | 'maFast'
    | 'maSlow'
    | 'rsiPeriod'
    | 'rsiOversold'
  >,
): SignalVerdict {
  const price = history[history.length - 1] ?? 0;
  const momentum = config.direction === 'momentum';
  const flip = (rising: boolean) => (momentum ? rising : !rising);
  const window = history.slice(-config.lookback);

  switch (config.indicator) {
    case 'breakout': {
      const prior = window.slice(0, -1);
      const hi = prior.length ? Math.max(...prior) : price;
      const lo = prior.length ? Math.min(...prior) : price;
      if (price >= hi) return { buy: flip(true), ref: hi };
      if (price <= lo) return { buy: flip(false), ref: lo };
      const ma = seriesMean(window);
      return { buy: flip(price > ma), ref: ma };
    }
    case 'emaCross': {
      const fast = seriesEma(history, config.maFast);
      const slow = seriesEma(history, config.maSlow);
      return { buy: flip(fast > slow), ref: slow };
    }
    case 'rsi': {
      const r = seriesRsi(history, config.rsiPeriod);
      const buy = momentum ? r > 50 : r < config.rsiOversold;
      return { buy, ref: r };
    }
    case 'fib': {
      const hi = Math.max(...window);
      const lo = Math.min(...window);
      const range = hi - lo;
      if (range <= 0) {
        const ma = seriesMean(window);
        return { buy: flip(price > ma), ref: ma };
      }
      const level618 = lo + range * 0.618;
      const level382 = lo + range * 0.382;
      return momentum
        ? { buy: price >= level618, ref: level618 }
        : { buy: price <= level382, ref: level382 };
    }
    case 'ma':
    default: {
      const ma = seriesMean(window);
      return { buy: flip(price > ma), ref: ma };
    }
  }
}

/** Format a bps size as a percent, trimming a trailing `.0` (2500 -> "25"). */
function formatSizePct(bps: number): string {
  const pct = (bps > 0 ? bps : 0) / 100;
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
}

/**
 * The buy/trim sentence for a direction + indicator. Wording mirrors what the
 * runtime signal engine actually does (runtime/src/strategy/signal.ts
 * `evaluate`): momentum buys strength, reversion fades extremes; breakout acts
 * on new highs/lows, emaCross on the fast/slow EMA cross, rsi on the RSI band,
 * fib on the golden-ratio bands of the recent swing, ma on price vs the recent
 * moving average.
 */
function signalSentence(
  asset: StrategyAsset,
  direction: StrategyDirection,
  indicator: StrategyIndicator,
): string {
  const momentum = direction === 'momentum';
  switch (indicator) {
    case 'breakout':
      return momentum
        ? `buys breakouts when ${asset} pushes to new highs and trims when it rolls over`
        : `buys the dips when ${asset} breaks to new lows and trims back into strength`;
    case 'emaCross':
      return momentum
        ? `buys when ${asset}'s fast EMA crosses above its slow EMA and trims when it crosses back below`
        : `buys when ${asset}'s fast EMA falls below its slow EMA and trims when it crosses back above`;
    case 'rsi':
      return momentum
        ? `buys ${asset} strength when RSI runs above 50 and trims as momentum fades`
        : `buys when ${asset} is oversold and trims into overbought rallies`;
    case 'fib':
      return momentum
        ? `buys when ${asset} holds the upper golden-ratio zone (above the 61.8% level) of its recent swing and trims when the level is lost`
        : `buys when ${asset} retraces into the lower golden-ratio zone (below the 38.2% level) of its recent swing and trims as it climbs back`;
    case 'ma':
    default:
      return momentum
        ? `buys ${asset} when it trades above its recent average and trims when it slips below`
        : `buys ${asset} when it dips below its recent average and trims as it reverts higher`;
  }
}

/** The on-chain arena clause for an arena side (empty when off). The runtime
 *  (runtime/src/runner.ts `arenaStep`) follows the trend on `follow` (momentum
 *  rides it, reversion fades it) and forces the side on longOnly/shortOnly. */
function arenaClause(side: ArenaSide, direction: StrategyDirection): string {
  switch (side) {
    case 'follow':
      return direction === 'momentum'
        ? ' and mirrors the trend in the on-chain arena'
        : ' and fades the trend in the on-chain arena';
    case 'longOnly':
      return ' and holds only long positions in the on-chain arena';
    case 'shortOnly':
      return ' and holds only short positions in the on-chain arena';
    case 'off':
    default:
      return '';
  }
}

/**
 * A readable one/two-sentence description grounded in a config's actual fields
 * (asset, direction, indicator, size, arena). This is the metadata prose for a
 * structured launch when the creator types no description and sets no mandate,
 * so the on-chain "Mandate" text matches the strategy the runtime executes
 * instead of an unrelated hash-derived archetype blurb. Always non-empty and
 * comfortably within the metadata description byte budget.
 */
export function describeStrategy(cfg: StrategyConfig): string {
  const assetDisplay = cfg.portfolio.length > 0
    ? cfg.portfolio.map((e) => e.asset).join('/')
    : cfg.asset;
  const horizon = horizonSuffix(cfg);
  // AI-driven arena agent: the free-text mandate (not the MA/indicator or any
  // peer-token trading) is what actually drives the on-chain arena each tick, so
  // describe it as such instead of the deterministic signal/launchpad prose.
  if (cfg.llmEnabled && cfg.arenaSide !== 'off') {
    const decision = aiArenaDecision(cfg.arenaSide, assetDisplay);
    const size = `Sizes ~${formatSizePct(cfg.arenaSizeBps)}% of treasury per position`;
    return (
      `AI-driven ${assetDisplay} arena agent — an AI mandate decides ${decision} ` +
      `in the on-chain arena each tick. ${size}.${horizon}`
    );
  }
  const lead =
    cfg.direction === 'momentum'
      ? `Rides ${assetDisplay} momentum`
      : `Fades ${assetDisplay} extremes`;
  const signal = signalSentence(cfg.asset, cfg.direction, cfg.indicator);
  const size = `Sizes ~${formatSizePct(cfg.sizeBps)}% per trade`;
  const arena = arenaClause(cfg.arenaSide, cfg.direction);
  return `${lead} — ${signal}. ${size}${arena}.${horizon}`;
}

function horizonSuffix(cfg: StrategyConfig): string {
  const secs = effectiveHoldSecs(cfg);
  if (secs <= 600) return '';
  const label = secs <= 86_400 ? 'Swing' : 'Position';
  const dur = secs < 3600 ? `${Math.round(secs / 60)}m` : `${Math.round(secs / 3600)}h`;
  return ` ${label} horizon (~${dur} holds).`;
}

/** The arena decision an AI mandate makes, given the creator's side constraint.
 *  Mirrors the runtime guardrail (runtime/src/runner.ts `arenaStep`): longOnly/
 *  shortOnly bound the model to one side; 'follow' lets it pick either. */
function aiArenaDecision(side: ArenaSide, assetDisplay: string): string {
  switch (side) {
    case 'longOnly':
      return `when to hold a long on ${assetDisplay}`;
    case 'shortOnly':
      return `when to hold a short on ${assetDisplay}`;
    case 'follow':
    default:
      return `when to go long or short on ${assetDisplay}`;
  }
}
