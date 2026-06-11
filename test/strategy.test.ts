import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STRATEGY_CONFIG,
  MANDATE_MAX_BYTES,
  MAX_HOLD_HORIZON_SECS,
  STRATEGY_PERIOD_MAX,
  clampStrategy,
  decodeStrategy,
  decodeStrategyFromDescription,
  describeStrategy,
  effectiveHoldSecs,
  embedStrategy,
  encodeStrategy,
  encodeStrategyTag,
  estimatedRoundTripCostBps,
  evaluateSignal,
  horizonLabel,
  sanitizeMandate,
  stripStrategyTag,
  type StrategyConfig,
} from '../src/strategy';

const sample: StrategyConfig = {
  version: 3,
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
  holdHorizonSecs: 0,
  leverage: 1,
  portfolio: [],
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

/** Build a legacy v2 (40-byte header) buffer to prove v2 stays decodable. */
function encodeV2(cfg: StrategyConfig): Uint8Array {
  const mandate = new TextEncoder().encode(cfg.mandate);
  const ASSETS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'AVAX'] as const;
  const DIRECTIONS = ['momentum', 'reversion'] as const;
  // Frozen at the v2-era table on purpose (proves legacy decode); typed wide
  // so newer indicators (which can't appear in a v2 buffer) don't break the build.
  const INDICATORS: readonly string[] = ['ma', 'breakout', 'emaCross', 'rsi'];
  const ARENA_SIDES = ['follow', 'longOnly', 'shortOnly', 'off'] as const;
  const out = new Uint8Array(40 + mandate.length);
  const view = new DataView(out.buffer);
  out[0] = 2;
  out[1] = ASSETS.indexOf(cfg.asset);
  out[2] = DIRECTIONS.indexOf(cfg.direction);
  out[3] = INDICATORS.indexOf(cfg.indicator);
  view.setUint16(4, cfg.entryThresholdBps, true);
  out[6] = cfg.trendConfirmTicks;
  view.setUint16(7, cfg.sizeBps, true);
  view.setBigUint64(9, cfg.maxTradeBaseUnits, true);
  out[17] = ARENA_SIDES.indexOf(cfg.arenaSide);
  view.setUint16(18, cfg.arenaSizeBps, true);
  out[20] = cfg.arenaHoldTicks;
  view.setUint16(21, cfg.buybackBps, true);
  view.setBigUint64(23, cfg.dailyLossCapBaseUnits, true);
  out[31] = cfg.llmEnabled ? 1 : 0;
  out[32] = cfg.lookback;
  out[33] = cfg.maFast;
  out[34] = cfg.maSlow;
  out[35] = cfg.rsiPeriod;
  out[36] = cfg.rsiOversold;
  out[37] = cfg.rsiOverbought;
  view.setUint16(38, mandate.length, true);
  out.set(mandate, 40);
  return out;
}

describe('strategy codec', () => {
  it('round-trips a full v2 config through binary', () => {
    expect(decodeStrategy(encodeStrategy(sample))).toEqual(sample);
  });

  it('encodes at v3 with a 46-byte minimum (no portfolio, empty mandate)', () => {
    const empty = { ...DEFAULT_STRATEGY_CONFIG, mandate: '' };
    // v3 prefix (44) + 0 portfolio entries + 2 (mandateLen) + 0 mandate = 46
    expect(encodeStrategy(empty).length).toBe(46);
    expect(decodeStrategy(encodeStrategy(empty)).version).toBe(3);
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
    // v3 fields default.
    expect(decoded.holdHorizonSecs).toBe(0);
    expect(decoded.leverage).toBe(1);
    expect(decoded.portfolio).toEqual([]);
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

  // Back-compat: a legacy v2 agent (40-byte header) must still decode, with
  // the v3 fields defaulted so it trades exactly as before.
  it('decodes a legacy v2 agent and defaults the v3 fields', () => {
    const v2 = encodeV2({
      ...sample,
      mandate: 'V2 SOL bot.',
    });
    const decoded = decodeStrategy(v2);
    expect(decoded.version).toBe(2);
    expect(decoded.asset).toBe('SOL');
    expect(decoded.mandate).toBe('V2 SOL bot.');
    expect(decoded.lookback).toBe(20);
    // v3 fields default.
    expect(decoded.holdHorizonSecs).toBe(0);
    expect(decoded.leverage).toBe(1);
    expect(decoded.portfolio).toEqual([]);
  });

  it('round-trips a v3 config with portfolio and hold horizon', () => {
    const v3: StrategyConfig = {
      ...sample,
      holdHorizonSecs: 14400,
      leverage: 2,
      portfolio: [
        { asset: 'BTC', weightBps: 4000 },
        { asset: 'ETH', weightBps: 3000 },
        { asset: 'SOL', weightBps: 3000 },
      ],
    };
    const decoded = decodeStrategy(encodeStrategy(v3));
    expect(decoded).toEqual(v3);
    expect(decoded.portfolio.length).toBe(3);
    expect(decoded.holdHorizonSecs).toBe(14400);
    expect(decoded.leverage).toBe(2);
  });

  it('round-trips a v3 config with empty portfolio (single-asset)', () => {
    const v3: StrategyConfig = {
      ...sample,
      holdHorizonSecs: 3600,
      leverage: 1,
      portfolio: [],
    };
    expect(decodeStrategy(encodeStrategy(v3))).toEqual(v3);
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

  it('clamps v3 holdHorizonSecs and leverage', () => {
    const wild: StrategyConfig = {
      ...DEFAULT_STRATEGY_CONFIG,
      holdHorizonSecs: 9_999_999,
      leverage: 7,
      portfolio: [
        { asset: 'BTC', weightBps: 50_000 },
        { asset: 'ETH', weightBps: 3000 },
      ],
    };
    const clamped = clampStrategy(wild, { maxTradeBaseUnits: 50_000_000n });
    expect(clamped.holdHorizonSecs).toBe(604800); // 7 days max
    expect(clamped.leverage).toBe(1); // invalid tier -> 1
    expect(clamped.portfolio[0]!.weightBps).toBe(10_000); // clamped to max bps
    expect(clamped.portfolio[1]!.weightBps).toBe(3000);
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

  // AI-driven arena agents: the mandate (not the MA/indicator or peer-token
  // trading) drives the on-chain arena, so the prose must say so.
  it('describes an AI-arena agent by its mandate-driven arena role', () => {
    const cfg: StrategyConfig = {
      ...DEFAULT_STRATEGY_CONFIG,
      asset: 'BTC',
      direction: 'momentum',
      indicator: 'ma',
      arenaSide: 'follow',
      arenaSizeBps: 1000,
      llmEnabled: true,
    };
    expect(describeStrategy(cfg)).toBe(
      'AI-driven BTC arena agent — an AI mandate decides when to go long or ' +
        'short on BTC in the on-chain arena each tick. Sizes ~10% of treasury ' +
        'per position.',
    );
  });

  it('bounds an AI-arena longOnly/shortOnly agent to its side in the prose', () => {
    const long: StrategyConfig = {
      ...DEFAULT_STRATEGY_CONFIG,
      asset: 'ETH',
      arenaSide: 'longOnly',
      llmEnabled: true,
    };
    expect(describeStrategy(long)).toContain('when to hold a long on ETH');
    const short: StrategyConfig = { ...long, arenaSide: 'shortOnly' };
    expect(describeStrategy(short)).toContain('when to hold a short on ETH');
  });

  it('does not use the AI-arena prose when the arena is off (llm + off)', () => {
    const cfg: StrategyConfig = {
      ...DEFAULT_STRATEGY_CONFIG,
      asset: 'SOL',
      arenaSide: 'off',
      llmEnabled: true,
    };
    // Falls through to the deterministic signal prose (no arena clause).
    expect(describeStrategy(cfg)).not.toContain('AI-driven');
  });

  it('AI-driven agent with portfolio shows multi-asset in prose', () => {
    const cfg: StrategyConfig = {
      ...DEFAULT_STRATEGY_CONFIG,
      asset: 'BTC',
      arenaSide: 'follow',
      arenaSizeBps: 1000,
      llmEnabled: true,
      portfolio: [
        { asset: 'BTC', weightBps: 5000 },
        { asset: 'SOL', weightBps: 5000 },
      ],
    };
    expect(describeStrategy(cfg)).toContain('BTC/SOL');
    expect(describeStrategy(cfg)).toContain('AI-driven');
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

  it('describes a multi-asset portfolio agent', () => {
    const cfg: StrategyConfig = {
      ...DEFAULT_STRATEGY_CONFIG,
      asset: 'BTC',
      direction: 'momentum',
      indicator: 'ma',
      sizeBps: 2500,
      arenaSide: 'follow',
      portfolio: [
        { asset: 'BTC', weightBps: 5000 },
        { asset: 'ETH', weightBps: 5000 },
      ],
    };
    const text = describeStrategy(cfg);
    expect(text).toContain('BTC/ETH');
  });

  it('describes a swing-horizon agent with the horizon suffix', () => {
    const cfg: StrategyConfig = {
      ...DEFAULT_STRATEGY_CONFIG,
      asset: 'BTC',
      direction: 'momentum',
      indicator: 'ma',
      sizeBps: 2500,
      arenaSide: 'follow',
      holdHorizonSecs: 14400,
    };
    const text = describeStrategy(cfg);
    expect(text).toContain('Swing horizon');
    expect(text).toContain('4h holds');
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
            for (const llmEnabled of [false, true]) {
              const cfg: StrategyConfig = {
                ...DEFAULT_STRATEGY_CONFIG,
                asset,
                indicator,
                direction,
                arenaSide,
                sizeBps: 10_000,
                arenaSizeBps: 10_000,
                llmEnabled,
              };
              const prose = describeStrategy(cfg);
              expect(prose.length).toBeGreaterThan(0);
              const full = prose + encodeStrategyTag(cfg);
              expect(enc.encode(full).length).toBeLessThanOrEqual(512);
            }
          }
        }
      }
    }
  });
});

describe('v3 horizon & cost utilities', () => {
  it('effectiveHoldSecs uses holdHorizonSecs when > 0', () => {
    expect(effectiveHoldSecs({ ...DEFAULT_STRATEGY_CONFIG, holdHorizonSecs: 14400 })).toBe(14400);
  });

  it('effectiveHoldSecs falls back to arenaHoldTicks when holdHorizonSecs=0', () => {
    expect(effectiveHoldSecs({ ...DEFAULT_STRATEGY_CONFIG, holdHorizonSecs: 0, arenaHoldTicks: 5 })).toBe(300);
  });

  it('horizonLabel classifies scalper/swing/position', () => {
    expect(horizonLabel({ ...DEFAULT_STRATEGY_CONFIG, holdHorizonSecs: 180 })).toBe('scalper');
    expect(horizonLabel({ ...DEFAULT_STRATEGY_CONFIG, holdHorizonSecs: 3600 })).toBe('swing');
    expect(horizonLabel({ ...DEFAULT_STRATEGY_CONFIG, holdHorizonSecs: 172800 })).toBe('position');
  });

  it('estimatedRoundTripCostBps includes fees + funding', () => {
    // 3-minute hold: 20 bps fees + 0.05 bps funding ≈ 20 bps
    expect(estimatedRoundTripCostBps(180)).toBe(20);
    // 4-hour hold: 20 + 4 = 24 bps
    expect(estimatedRoundTripCostBps(14400)).toBe(24);
    // 24-hour hold: 20 + 24 = 44 bps
    expect(estimatedRoundTripCostBps(86400)).toBe(44);
    // 7-day hold: 20 + 168 = 188 bps
    expect(estimatedRoundTripCostBps(604800)).toBe(188);
  });
});

describe('evaluateSignal', () => {
  const base = { ...DEFAULT_STRATEGY_CONFIG, lookback: 5 };

  it('ma: momentum buys above the average, reversion mirrors', () => {
    const rising = [100, 101, 102, 103, 110];
    expect(evaluateSignal(rising, { ...base, indicator: 'ma', direction: 'momentum' }).buy).toBe(true);
    expect(evaluateSignal(rising, { ...base, indicator: 'ma', direction: 'reversion' }).buy).toBe(false);
  });

  it('breakout: buys new highs (momentum), holds to the MA in between', () => {
    const breakoutUp = [100, 101, 100, 101, 105];
    expect(evaluateSignal(breakoutUp, { ...base, indicator: 'breakout', direction: 'momentum' }).buy).toBe(true);
    // Inside the prior range: falls back to price-vs-MA.
    const inside = [100, 110, 100, 110, 104];
    const v = evaluateSignal(inside, { ...base, indicator: 'breakout', direction: 'momentum' });
    expect(v.buy).toBe(104 > (100 + 110 + 100 + 110 + 104) / 5);
  });

  it('emaCross: fast above slow buys (momentum)', () => {
    const up = [100, 102, 104, 106, 108];
    expect(
      evaluateSignal(up, { ...base, indicator: 'emaCross', direction: 'momentum', maFast: 2, maSlow: 4 }).buy,
    ).toBe(true);
  });

  it('rsi: reversion buys only below the oversold band', () => {
    const falling = [110, 108, 106, 104, 100];
    expect(
      evaluateSignal(falling, { ...base, indicator: 'rsi', direction: 'reversion', rsiPeriod: 4, rsiOversold: 30 }).buy,
    ).toBe(true);
    const rising = [100, 104, 106, 108, 110];
    expect(
      evaluateSignal(rising, { ...base, indicator: 'rsi', direction: 'reversion', rsiPeriod: 4, rsiOversold: 30 }).buy,
    ).toBe(false);
  });

  it('fib: momentum holds the upper golden zone, reversion buys the discount zone', () => {
    // Swing 100..200 -> 38.2% = 138.2, 61.8% = 161.8.
    const upperZone = [100, 200, 150, 160, 170];
    expect(evaluateSignal(upperZone, { ...base, indicator: 'fib', direction: 'momentum' }).buy).toBe(true);
    const midZone = [100, 200, 150, 160, 150];
    expect(evaluateSignal(midZone, { ...base, indicator: 'fib', direction: 'momentum' }).buy).toBe(false);
    const discount = [100, 200, 150, 130, 120];
    expect(evaluateSignal(discount, { ...base, indicator: 'fib', direction: 'reversion' }).buy).toBe(true);
  });

  it('fib: flat swing falls back to the MA', () => {
    const flat = [100, 100, 100, 100, 100];
    const v = evaluateSignal(flat, { ...base, indicator: 'fib', direction: 'momentum' });
    expect(v.ref).toBe(100);
    expect(v.buy).toBe(false); // price == ma, not strictly above
  });
});
