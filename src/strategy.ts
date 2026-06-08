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
// An empty v2 mandate => 40 bytes total (~56 base64 chars), far under the
// 512-byte metadata description budget. The config is embedded in the human
// description as `<prose>\n[s1]<base64>[/s1]` so the prose stays readable and
// explorers/wallets still show something sensible.

export type StrategyAsset = 'BTC' | 'ETH' | 'SOL' | 'XRP' | 'DOGE' | 'AVAX';
export type StrategyDirection = 'momentum' | 'reversion';
export type StrategyIndicator = 'ma' | 'breakout' | 'emaCross' | 'rsi';
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
}

export const STRATEGY_VERSION = 2;

/** Max bps for size/arena/buyback fields (100%). */
export const STRATEGY_BPS_MAX = 10_000;

/** Mandate hard length cap (UTF-8 bytes) so the encoded config fits the budget. */
export const MANDATE_MAX_BYTES = 200;

/** Upper bound for period/window fields (fits a u8; keeps history buffers sane). */
export const STRATEGY_PERIOD_MAX = 240;

/** Markers wrapping the base64 config inside the metadata description. */
export const STRATEGY_TAG_OPEN = '[s1]';
export const STRATEGY_TAG_CLOSE = '[/s1]';

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
];
const ARENA_SIDES: readonly ArenaSide[] = [
  'follow',
  'longOnly',
  'shortOnly',
  'off',
];

/** v1 fixed header size; v1 agents still decode at this layout. */
const V1_HEADER_BYTES = 34;
/** v2 fixed header size (v1 + six u8 style fields). Current encode size. */
const V2_HEADER_BYTES = 40;

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
  const out = new Uint8Array(V2_HEADER_BYTES + mandateBytes.length);
  const view = new DataView(out.buffer);
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
  view.setUint16(38, mandateBytes.length, true);
  out.set(mandateBytes, V2_HEADER_BYTES);
  return out;
}

/** Decode binary into a config. Decodes both v1 (legacy 34-byte header,
 *  defaulting the v2 style fields) and v2. Throws on a bad version, truncation,
 *  or an unknown enum so callers can fall back to a safe default. */
export function decodeStrategy(bytes: Uint8Array): StrategyConfig {
  if (bytes.length < V1_HEADER_BYTES) {
    throw new Error('strategy bytes truncated');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[0]!;
  if (version !== 1 && version !== 2) {
    throw new Error(`unsupported strategy version ${version}`);
  }

  // Bytes 0..31 are shared across versions; only the trailing fields move.
  const headerBytes = version === 1 ? V1_HEADER_BYTES : V2_HEADER_BYTES;
  const mandateLenOff = version === 1 ? 32 : 38;
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

  // v1 agents carry no style fields; default them so they trade as before.
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
  };
}

/** Short display label for a config (used where there's no archetype label). */
export function strategyLabel(cfg: StrategyConfig): string {
  return `${cfg.asset} ${cfg.direction}`;
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
 * ma on price vs the recent moving average.
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
  const lead =
    cfg.direction === 'momentum'
      ? `Rides ${cfg.asset} momentum`
      : `Fades ${cfg.asset} extremes`;
  const signal = signalSentence(cfg.asset, cfg.direction, cfg.indicator);
  const size = `Sizes ~${formatSizePct(cfg.sizeBps)}% per trade`;
  const arena = arenaClause(cfg.arenaSide, cfg.direction);
  return `${lead} — ${signal}. ${size}${arena}.`;
}
