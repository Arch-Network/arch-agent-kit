import { describe, expect, it } from 'vitest';
import {
  CAREER_BASE_RATING,
  CAREER_ELO_K,
  computeCareers,
  computePrizePool,
  computeStandings,
  prizeForRank,
  type SettledEpochLike,
} from '../src/tournament.js';

const entry = (tokenId: string) => ({ tokenId });

describe('computeStandings', () => {
  it('ranks qualified agents by RoC, unqualified last', () => {
    const standings = computeStandings(
      {
        entries: [entry('a'), entry('b'), entry('c')],
        stats: {
          a: { realizedPnl: 50, collateralDeployed: 1000, closedPositions: 10 },
          b: { realizedPnl: 200, collateralDeployed: 1000, closedPositions: 3 },
          c: { realizedPnl: 100, collateralDeployed: 1000, closedPositions: 12 },
        },
      },
      10,
    );
    expect(standings.map((s) => s.tokenId)).toEqual(['c', 'a', 'b']);
    expect(standings[0]!.roc).toBeCloseTo(0.1);
    expect(standings[2]!.qualified).toBe(false);
  });

  it('entered agents without stats rank as zeros', () => {
    const standings = computeStandings({ entries: [entry('a')], stats: {} }, 10);
    expect(standings).toHaveLength(1);
    expect(standings[0]).toMatchObject({ roc: 0, closedPositions: 0, qualified: false });
  });

  it('dedupes duplicate entries', () => {
    const standings = computeStandings(
      { entries: [entry('a'), entry('a')], stats: {} },
      10,
    );
    expect(standings).toHaveLength(1);
  });
});

describe('computePrizePool', () => {
  it('pool = entries net of rake + seed + recycled', () => {
    const p = computePrizePool({
      entrants: 10,
      entryFeeBaseUnits: 25_000_000,
      rakeBps: 1000,
      seedBaseUnits: 100_000_000,
      recycledBaseUnits: 5_000_000,
    });
    expect(p.rake).toBe(10 * 2_500_000);
    expect(p.pool).toBe(10 * 22_500_000 + 100_000_000 + 5_000_000);
  });

  it('free season: pool is seed + recycled, rake is zero', () => {
    const p = computePrizePool({
      entrants: 12,
      entryFeeBaseUnits: 0,
      rakeBps: 1000,
      seedBaseUnits: 1_000_000,
      recycledBaseUnits: 250,
    });
    expect(p.rake).toBe(0);
    expect(p.pool).toBe(1_000_250);
  });

  it('prizeForRank floors and returns 0 beyond the curve', () => {
    expect(prizeForRank(1001, [5000, 2500, 1500, 1000], 0)).toBe(500);
    expect(prizeForRank(1001, [5000, 2500, 1500, 1000], 4)).toBe(0);
  });
});

describe('computeCareers', () => {
  const season = (
    epochId: number,
    stats: Record<string, { realizedPnl: number; collateralDeployed: number; closedPositions: number }>,
    winners: { tokenId: string; prizeBaseUnits: number }[],
    cancelled = false,
  ): SettledEpochLike => ({
    epochId,
    entries: Object.keys(stats).map(entry),
    stats,
    settled: true,
    settlement: { cancelled, winners },
  });

  it('aggregates wins, podiums, prizes, and rating across seasons', () => {
    const s = (pnl: number) => ({ realizedPnl: pnl, collateralDeployed: 1000, closedPositions: 10 });
    const careers = computeCareers(
      [
        season(0, { a: s(100), b: s(50) }, [{ tokenId: 'a', prizeBaseUnits: 500 }]),
        season(1, { a: s(80), b: s(90) }, [{ tokenId: 'b', prizeBaseUnits: 600 }]),
      ],
      10,
    );
    const a = careers.find((c) => c.tokenId === 'a')!;
    const b = careers.find((c) => c.tokenId === 'b')!;
    expect(a.wins).toBe(1);
    expect(b.wins).toBe(1);
    expect(a.podiums).toBe(2);
    expect(a.totalPrizeBaseUnits).toBe(500);
    expect(b.totalPrizeBaseUnits).toBe(600);
    // One win + one loss each in a 2-agent field → ratings back at base.
    expect(a.rating).toBeCloseTo(CAREER_BASE_RATING);
    expect(b.rating).toBeCloseTo(CAREER_BASE_RATING);
  });

  it('cancelled seasons do not count', () => {
    const s = { realizedPnl: 100, collateralDeployed: 1000, closedPositions: 10 };
    const careers = computeCareers([season(0, { a: s }, [], true)], 10);
    expect(careers).toHaveLength(0);
  });

  it('winner of a multi-agent field gains rating', () => {
    const s = (pnl: number) => ({ realizedPnl: pnl, collateralDeployed: 1000, closedPositions: 10 });
    const careers = computeCareers(
      [season(0, { a: s(300), b: s(200), c: s(100) }, [])],
      10,
    );
    expect(careers[0]!.tokenId).toBe('a');
    expect(careers[0]!.rating).toBeCloseTo(CAREER_BASE_RATING + CAREER_ELO_K * 0.5);
  });
});
