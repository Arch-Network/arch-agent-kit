import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STRATEGY_CONFIG,
  MANDATE_MAX_BYTES,
  STRATEGY_PERIOD_MAX,
  clampStrategy,
  decodeStrategy,
  decodeStrategyFromDescription,
  describeStrategy,
  embedStrategy,
  encodeStrategy,
  encodeStrategyTag,
  sanitizeMandate,
  stripStrategyTag,
  type StrategyConfig,
} from '../src/strategy';

const sample: StrategyConfig = {
  version: 2,
  asset: 'SOL',
  direction: 'reversion',
  indicator: 'rsi',
  entryThresholdBps: 125,
  trendConfirmTicks: 4,
  sizeBps: 1800,
  maxTradeBaseUnits: 12_345_678n,
  arenaSide: 'shortOnly',
  arenaSizeBps: 750,
  arenaHoldTicks: 5,
  buybackBps: 4000,
  dailyLossCapBaseUnits: 9_000_000n,
  lookback: 20,
  maFast: 5,
  maSlow: 21,
  rsiPeriod: 10,
  rsiOversold: 25,
  rsiOverbought: 75,
  mandate: 'Fade SOL pumps; rotate into the laggard with the deepest curve.',
  llmEnabled: true,
};

/** Build a legacy v1 (34-byte header) buffer to prove v1 stays decodable. */
function encodeV1(cfg: {
  asset: number;
  direction: number;
  indicator: number;
  entryThresholdBps: number;
  trendConfirmTicks: number;
  sizeBps: number;
  maxTradeBaseUnits: bigint;
  arenaSide: number;
  arenaSizeBps: number;
  arenaHoldTicks: number;
  buybackBps: number;
  dailyLossCapBaseUnits: bigint;
  llmEnabled: boolean;
  mandate: string;
}): Uint8Array {
  const mandate = new TextEncoder().encode(cfg.mandate);
  const out = new Uint8Array(34 + mandate.length);
  const view = new DataView(out.buffer);
  out[0] = 1;
  out[1] = cfg.asset;
  out[2] = cfg.direction;
  out[3] = cfg.indicator;
  view.setUint16(4, cfg.entryThresholdBps, true);
  out[6] = cfg.trendConfirmTicks;
  view.setUint16(7, cfg.sizeBps, true);
  view.setBigUint64(9, cfg.maxTradeBaseUnits, true);
  out[17] = cfg.arenaSide;
  view.setUint16(18, cfg.arenaSizeBps, true);
  out[20] = cfg.arenaHoldTicks;
  view.setUint16(21, cfg.buybackBps, true);
  view.setBigUint64(23, cfg.dailyLossCapBaseUnits, true);
  out[31] = cfg.llmEnabled ? 1 : 0;
  view.setUint16(32, mandate.length, true);
  out.set(mandate, 34);
  return out;
}

describe('strategy codec', () => {
  it('round-trips a full v2 config through binary', () => {
    expect(decodeStrategy(encodeStrategy(sample))).toEqual(sample);
  });

  it('encodes at v2 with a 40-byte header', () => {
    const empty = { ...DEFAULT_STRATEGY_CONFIG, mandate: '' };
    expect(encodeStrategy(empty).length).toBe(40);
    expect(decodeStrategy(encodeStrategy(empty)).version).toBe(2);
  });

  it('round-trips the defaults', () => {
    expect(decodeStrategy(encodeStrategy(DEFAULT_STRATEGY_CONFIG))).toEqual(
      DEFAULT_STRATEGY_CONFIG,
    );
  });

  // Back-compat: a legacy v1 agent (34-byte header, no style fields) must still
  // decode, with the v2 style fields defaulted so it trades exactly as before.
  it('decodes a legacy v1 agent and defaults the v2 style fields', () => {
    const v1 = encodeV1({
      asset: 1, // ETH
      direction: 1, // reversion
      indicator: 1, // breakout
      entryThresholdBps: 125,
      trendConfirmTicks: 4,
      sizeBps: 1800,
      maxTradeBaseUnits: 12_345_678n,
      arenaSide: 2, // shortOnly
      arenaSizeBps: 750,
      arenaHoldTicks: 5,
      buybackBps: 4000,
      dailyLossCapBaseUnits: 9_000_000n,
      llmEnabled: true,
      mandate: 'Legacy ETH bot.',
    });
    const decoded = decodeStrategy(v1);
    expect(decoded.version).toBe(1);
    expect(decoded.asset).toBe('ETH');
    expect(decoded.indicator).toBe('breakout');
    expect(decoded.mandate).toBe('Legacy ETH bot.');
    // Style fields fall back to the defaults.
    expect(decoded.lookback).toBe(DEFAULT_STRATEGY_CONFIG.lookback);
    expect(decoded.maFast).toBe(DEFAULT_STRATEGY_CONFIG.maFast);
    expect(decoded.maSlow).toBe(DEFAULT_STRATEGY_CONFIG.maSlow);
    expect(decoded.rsiPeriod).toBe(DEFAULT_STRATEGY_CONFIG.rsiPeriod);
    expect(decoded.rsiOversold).toBe(DEFAULT_STRATEGY_CONFIG.rsiOversold);
    expect(decoded.rsiOverbought).toBe(DEFAULT_STRATEGY_CONFIG.rsiOverbought);
  });

  it('decodes new append-only asset/indicator enum values', () => {
    const cfg = { ...DEFAULT_STRATEGY_CONFIG, asset: 'DOGE' as const, indicator: 'emaCross' as const };
    expect(decodeStrategy(encodeStrategy(cfg))).toEqual(cfg);
  });

  // The app encodes at launch and the runtime decodes at trade time using this
  // SINGLE codec — this is the cross-side agreement invariant in one assertion.
  it('decodes the same config the app would embed in a description', () => {
    const description = embedStrategy('Mean-reversion ETH bot.', sample);
    expect(stripStrategyTag(description)).toBe('Mean-reversion ETH bot.');
    expect(decodeStrategyFromDescription(description)).toEqual(sample);
  });

  it('returns null for descriptions without a tag', () => {
    expect(decodeStrategyFromDescription('just prose, no config')).toBeNull();
  });

  it('rejects an unsupported version', () => {
    const bytes = encodeStrategy(sample);
    bytes[0] = 9;
    expect(() => decodeStrategy(bytes)).toThrow(/version/);
  });

  it('rejects an unknown enum index', () => {
    const bytes = encodeStrategy(sample);
    bytes[1] = 7; // asset out of range
    expect(() => decodeStrategy(bytes)).toThrow(/asset/);
  });

  it('clamps fields so a config can only be more conservative', () => {
    const hostile: StrategyConfig = {
      ...DEFAULT_STRATEGY_CONFIG,
      sizeBps: 50_000,
      arenaSizeBps: 99_000,
      buybackBps: 40_000,
      maxTradeBaseUnits: 1_000_000_000n,
    };
    const clamped = clampStrategy(hostile, { maxTradeBaseUnits: 50_000_000n });
    expect(clamped.sizeBps).toBe(10_000);
    expect(clamped.arenaSizeBps).toBe(10_000);
    expect(clamped.buybackBps).toBe(10_000);
    expect(clamped.maxTradeBaseUnits).toBe(50_000_000n);
  });

  it('bounds the v2 style fields and orders the RSI bands', () => {
    const wild: StrategyConfig = {
      ...DEFAULT_STRATEGY_CONFIG,
      lookback: 100_000,
      maFast: 0,
      maSlow: 99_999,
      rsiPeriod: 1,
      rsiOversold: 80, // intentionally above overbought
      rsiOverbought: 20,
    };
    const clamped = clampStrategy(wild, { maxTradeBaseUnits: 50_000_000n });
    expect(clamped.lookback).toBe(STRATEGY_PERIOD_MAX);
    expect(clamped.maFast).toBe(DEFAULT_STRATEGY_CONFIG.maFast); // 0 -> default
    expect(clamped.maSlow).toBe(STRATEGY_PERIOD_MAX);
    expect(clamped.rsiPeriod).toBe(2); // floored to the minimum
    // Bands re-ordered so oversold < overbought.
    expect(clamped.rsiOversold).toBeLessThan(clamped.rsiOverbought);
    expect(clamped.rsiOversold).toBe(20);
    expect(clamped.rsiOverbought).toBe(80);
  });

  it('treats maxTradeBaseUnits=0 as use-the-ceiling', () => {
    const clamped = clampStrategy(DEFAULT_STRATEGY_CONFIG, {
      maxTradeBaseUnits: 50_000_000n,
    });
    expect(clamped.maxTradeBaseUnits).toBe(50_000_000n);
  });

  it('sanitizes and caps a hostile mandate', () => {
    const dirty = `drop tables\u0000\u0007 ${'x'.repeat(500)}`;
    const clean = sanitizeMandate(dirty);
    expect(clean).not.toMatch(/[\u0000-\u001f]/);
    expect(new TextEncoder().encode(clean).length).toBeLessThanOrEqual(
      MANDATE_MAX_BYTES,
    );
  });
});

describe('describeStrategy', () => {
  it('describes a momentum/breakout config grounded in its fields', () => {
    const cfg: StrategyConfig = {
      ...DEFAULT_STRATEGY_CONFIG,
      asset: 'BTC',
      direction: 'momentum',
      indicator: 'breakout',
      sizeBps: 2500,
      arenaSide: 'follow',
    };
    expect(describeStrategy(cfg)).toBe(
      'Rides BTC momentum — buys breakouts when BTC pushes to new highs and ' +
        'trims when it rolls over. Sizes ~25% per trade and mirrors the trend ' +
        'in the on-chain arena.',
    );
  });

  it('describes a reversion/rsi config and omits the arena clause when off', () => {
    const cfg: StrategyConfig = {
      ...DEFAULT_STRATEGY_CONFIG,
      asset: 'SOL',
      direction: 'reversion',
      indicator: 'rsi',
      sizeBps: 2000,
      arenaSide: 'off',
    };
    expect(describeStrategy(cfg)).toBe(
      'Fades SOL extremes — buys when SOL is oversold and trims into ' +
        'overbought rallies. Sizes ~20% per trade.',
    );
  });

  it('names the configured asset/indicator/size, never an unrelated one', () => {
    const cfg: StrategyConfig = {
      ...DEFAULT_STRATEGY_CONFIG,
      asset: 'XRP',
      direction: 'reversion',
      indicator: 'ma',
      sizeBps: 750,
    };
    const text = describeStrategy(cfg);
    expect(text).toContain('XRP');
    expect(text).toContain('~7.5% per trade');
    expect(text).not.toContain('BTC');
    expect(text).not.toContain('ETH');
  });

  // The generated prose plus the embedded config tag must fit the 512-byte
  // metadata description budget for every asset/indicator/arena combination.
  it('stays within the metadata description byte budget for all combos', () => {
    const enc = new TextEncoder();
    const assets = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'AVAX'] as const;
    const indicators = ['ma', 'breakout', 'emaCross', 'rsi'] as const;
    const directions = ['momentum', 'reversion'] as const;
    const arenaSides = ['follow', 'longOnly', 'shortOnly', 'off'] as const;
    for (const asset of assets) {
      for (const indicator of indicators) {
        for (const direction of directions) {
          for (const arenaSide of arenaSides) {
            const cfg: StrategyConfig = {
              ...DEFAULT_STRATEGY_CONFIG,
              asset,
              indicator,
              direction,
              arenaSide,
              sizeBps: 10_000,
            };
            const prose = describeStrategy(cfg);
            expect(prose.length).toBeGreaterThan(0);
            const full = prose + encodeStrategyTag(cfg);
            expect(enc.encode(full).length).toBeLessThanOrEqual(512);
          }
        }
      }
    }
  });
});
