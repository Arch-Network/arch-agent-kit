// Tournament season math: the single source of truth for standings (RoC
// ranking), prize-pool composition, and cross-season careers/Elo. The runtime
// engine (runtime/src/tournament.ts), the app's server reader
// (app/lib/server/tournament.ts), and the public verifier all rank agents and
// size prize pools with THESE functions. Keeping one implementation here is
// deliberate — the whole "anyone can re-derive every result" claim depends on
// every consumer agreeing on the formulas, and a dual implementation would
// drift.
//
// Everything in this module is pure: plain data in, plain data out. No fs, no
// env, no clock — persistence and configuration stay with the consumers.

// ─── Standings ──────────────────────────────────────────────────────────────

/** Per-agent accumulated stats within one epoch (reserve base units). */
export interface EpochStats {
  /** Cumulative realized P&L, net of arena fees. */
  realizedPnl: number;
  /** Cumulative collateral deployed across all positions. */
  collateralDeployed: number;
  /** Closed positions this epoch. */
  closedPositions: number;
}

export interface Standing {
  tokenId: string;
  /** Return on collateral: realizedPnl / collateralDeployed (0 if none). */
  roc: number;
  realizedPnl: number;
  collateralDeployed: number;
  closedPositions: number;
  /** Met the minimum closed-positions requirement. */
  qualified: boolean;
}

/** The minimal epoch shape standings are derived from. Both the runtime's
 *  live state and the app's parsed JSON satisfy this structurally. */
export interface EpochLike {
  entries: { tokenId: string }[];
  stats: Record<string, EpochStats | undefined>;
}

const EMPTY_STATS: EpochStats = {
  realizedPnl: 0,
  collateralDeployed: 0,
  closedPositions: 0,
};

/** Rank entered agents by RoC, qualified agents first. Agents without stats
 *  rank as zeros (entered but never closed a position). */
export function computeStandings(epoch: EpochLike, minTrades: number): Standing[] {
  const enteredIds = new Set((epoch.entries ?? []).map((e) => e.tokenId));
  const standings: Standing[] = [];
  for (const tokenId of enteredIds) {
    const s = epoch.stats?.[tokenId] ?? EMPTY_STATS;
    standings.push({
      tokenId,
      roc: s.collateralDeployed > 0 ? s.realizedPnl / s.collateralDeployed : 0,
      realizedPnl: s.realizedPnl,
      collateralDeployed: s.collateralDeployed,
      closedPositions: s.closedPositions,
      qualified: s.closedPositions >= minTrades,
    });
  }
  standings.sort((a, b) => {
    if (a.qualified !== b.qualified) return a.qualified ? -1 : 1;
    return b.roc - a.roc;
  });
  return standings;
}

// ─── Prize pool ─────────────────────────────────────────────────────────────

export interface PrizePoolInputs {
  entrants: number;
  /** Entry fee per agent, reserve base units (0 = free/sponsored season). */
  entryFeeBaseUnits: number;
  /** Rake on the entry fee, bps. */
  rakeBps: number;
  /** Sponsor/protocol seed, base units. */
  seedBaseUnits: number;
  /** Protocol fees recycled into the pool ("house takes nothing"), base units. */
  recycledBaseUnits: number;
}

export interface PrizePoolBreakdown {
  /** Total pool: entries (net of rake) + seed + recycled fees. */
  pool: number;
  /** Total rake taken across all entries. */
  rake: number;
  seed: number;
  recycled: number;
  entrants: number;
}

export function computePrizePool(inputs: PrizePoolInputs): PrizePoolBreakdown {
  const { entrants, entryFeeBaseUnits, rakeBps, seedBaseUnits, recycledBaseUnits } = inputs;
  const rakePerEntry = Math.floor((entryFeeBaseUnits * rakeBps) / 10_000);
  return {
    pool: entrants * (entryFeeBaseUnits - rakePerEntry) + seedBaseUnits + recycledBaseUnits,
    rake: entrants * rakePerEntry,
    seed: seedBaseUnits,
    recycled: recycledBaseUnits,
    entrants,
  };
}

/** Split a pool across the top-N prize curve (bps per rank), floor-rounded. */
export function prizeForRank(pool: number, prizeBps: readonly number[], rankIndex: number): number {
  const bps = prizeBps[rankIndex] ?? 0;
  return Math.floor((pool * bps) / 10_000);
}

// ─── Careers (cross-season records + Elo) ───────────────────────────────────

export const CAREER_BASE_RATING = 1200;
export const CAREER_ELO_K = 64;

export interface Career {
  tokenId: string;
  /** Cross-season Elo-style rating (placement vs. the qualified field). */
  rating: number;
  seasonsEntered: number;
  seasonsQualified: number;
  /** Season wins (rank 1). */
  wins: number;
  /** Top-4 finishes. */
  podiums: number;
  bestRoc: number | null;
  totalRealizedPnl: number;
  totalPrizeBaseUnits: number;
}

/** A settled epoch as careers need it: standings inputs + the settlement's
 *  paid winners. Cancelled or unsettled epochs must be filtered out by the
 *  caller predicate below. */
export interface SettledEpochLike extends EpochLike {
  epochId: number;
  settled?: boolean;
  settlement?: {
    cancelled: boolean;
    winners: { tokenId: string; prizeBaseUnits: number }[];
  };
}

/** True for epochs that count toward careers (settled and not cancelled). */
export function countsForCareers(epoch: SettledEpochLike): boolean {
  return Boolean(epoch.settled && epoch.settlement && !epoch.settlement.cancelled);
}

/** Aggregate cross-season records. Epochs are processed in epochId order so
 *  Elo updates are deterministic regardless of input ordering. */
export function computeCareers(epochs: SettledEpochLike[], minTrades: number): Career[] {
  const map = new Map<string, Career>();
  const ensure = (tokenId: string): Career => {
    let c = map.get(tokenId);
    if (!c) {
      c = {
        tokenId,
        rating: CAREER_BASE_RATING,
        seasonsEntered: 0,
        seasonsQualified: 0,
        wins: 0,
        podiums: 0,
        bestRoc: null,
        totalRealizedPnl: 0,
        totalPrizeBaseUnits: 0,
      };
      map.set(tokenId, c);
    }
    return c;
  };

  const settled = epochs.filter(countsForCareers).sort((a, b) => a.epochId - b.epochId);

  for (const epoch of settled) {
    const ranked = computeStandings(epoch, minTrades).filter((s) => s.qualified);
    for (const e of epoch.entries ?? []) ensure(e.tokenId).seasonsEntered += 1;
    ranked.forEach((s, i) => {
      const c = ensure(s.tokenId);
      c.seasonsQualified += 1;
      c.totalRealizedPnl += s.realizedPnl;
      if (c.bestRoc === null || s.roc > c.bestRoc) c.bestRoc = s.roc;
      if (i === 0) c.wins += 1;
      if (i < 4) c.podiums += 1;
      // Elo-style update: score is the agent's normalized placement in the
      // qualified field (1st = 1, last = 0) against an expected 0.5.
      if (ranked.length > 1) {
        const score = (ranked.length - 1 - i) / (ranked.length - 1);
        c.rating += CAREER_ELO_K * (score - 0.5);
      }
    });
    for (const w of epoch.settlement!.winners) {
      ensure(w.tokenId).totalPrizeBaseUnits += w.prizeBaseUnits;
    }
  }

  return [...map.values()].sort((a, b) => b.rating - a.rating);
}
