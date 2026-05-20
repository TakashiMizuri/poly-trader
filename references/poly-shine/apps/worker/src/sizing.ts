import { gateSideForActivity, isCtfActivitySide } from "./leaderActivity.js";

export const MIN_SHARES = 0.01;
export const MIN_BUY_NOTIONAL_USD = 1;

export type CapReason = "max_notional" | "cash" | "position" | "rounding";

export function parseProportionalScale(pctBalance: string | null): number {
  const scale = Number(pctBalance ?? 1);
  if (!Number.isFinite(scale) || scale < 0.01 || scale > 10) return NaN;
  return scale;
}

export function computeBalanceRatio(
  leaderCash: number,
  followerUsdc: number,
  scale: number
): { ratio: number } | { skipReason: string } {
  if (!Number.isFinite(leaderCash) || leaderCash <= 0) {
    return { skipReason: "leader_cash_zero" };
  }
  if (!Number.isFinite(followerUsdc) || followerUsdc <= 0) {
    return { skipReason: "missing_follower_balance" };
  }
  if (!Number.isFinite(scale) || scale <= 0) {
    return { skipReason: "invalid_proportional_scale" };
  }
  return { ratio: (followerUsdc * scale) / leaderCash };
}

export function roundSharesDown(shares: number, decimals = 2): number {
  if (!Number.isFinite(shares) || shares <= 0) return 0;
  const factor = 10 ** decimals;
  return Math.floor(shares * factor) / factor;
}

export function applySellPositionCap(
  shares: number,
  position: number | null
): { shares: number; skipReason?: string; cappedBy?: CapReason } {
  if (position == null || !Number.isFinite(position)) {
    return { shares, cappedBy: undefined };
  }
  if (position <= 0) return { shares: 0, skipReason: "no_position_to_sell" };
  if (shares <= position) return { shares };
  return { shares: position, cappedBy: "position" };
}

export function applyBuyCashCap(
  shares: number,
  price: number,
  followerUsdc: number,
  buffer = 0.98
): { shares: number; skipReason?: string; cappedBy?: CapReason } {
  if (!Number.isFinite(shares) || shares <= 0) return { shares: 0 };
  if (!Number.isFinite(price) || price <= 0) return { shares };
  if (!Number.isFinite(followerUsdc) || followerUsdc <= 0) {
    return { shares: 0, skipReason: "insufficient_cash_for_buy", cappedBy: "cash" };
  }
  const maxShares = roundSharesDown((followerUsdc * buffer) / price);
  if (shares <= maxShares) return { shares };
  if (maxShares < MIN_SHARES) {
    return { shares: 0, skipReason: "insufficient_cash_for_buy", cappedBy: "cash" };
  }
  return { shares: maxShares, cappedBy: "cash" };
}

export function applyMaxNotional(params: {
  shares: number;
  price: number;
  maxNotionalPerTrade: string | null;
}): { shares: number; skipReason?: string; cappedBy?: CapReason } {
  const maxN = params.maxNotionalPerTrade != null ? Number(params.maxNotionalPerTrade) : null;
  if (maxN == null || !Number.isFinite(maxN) || maxN <= 0) return { shares: params.shares };
  const notional = params.shares * params.price;
  if (notional <= maxN) return { shares: params.shares };
  const capped = maxN / params.price;
  if (capped < MIN_SHARES) return { shares: 0, skipReason: "max_notional_too_small_for_tick" };
  return { shares: capped, cappedBy: "max_notional" };
}

export type SizingBasis = "cash_ratio" | "position_fraction";

export type MirrorSizingMeta = {
  sizingMode?: string;
  sizingBasis?: SizingBasis;
  followLineState?: string;
  leaderCash?: number;
  followerCash?: number;
  balanceRatio?: number;
  proportionalScale?: number;
  leaderPositionBefore?: number;
  followerPosition?: number;
  closeFraction?: number;
  rawShares?: number;
  cappedBy?: CapReason;
  roundedShares?: number;
};

export function computeProportionalSell(input: {
  leaderSellShares: number;
  leaderPositionBefore: number;
  followerPosition: number | null;
}): { shares: number; skipReason?: string; meta: Partial<MirrorSizingMeta> } {
  const { leaderSellShares, leaderPositionBefore } = input;
  if (!Number.isFinite(leaderSellShares) || leaderSellShares <= 0) {
    return { shares: 0, skipReason: "invalid_leader_price", meta: {} };
  }
  if (!Number.isFinite(leaderPositionBefore) || leaderPositionBefore <= 0) {
    return { shares: 0, skipReason: "invalid_leader_position", meta: { leaderPositionBefore } };
  }
  const followerPos = input.followerPosition;
  if (followerPos == null || !Number.isFinite(followerPos)) {
    return { shares: 0, skipReason: "no_position_to_sell", meta: { leaderPositionBefore } };
  }
  if (followerPos <= 0) {
    return { shares: 0, skipReason: "no_position_to_sell", meta: { leaderPositionBefore, followerPosition: 0 } };
  }

  const closeFraction = Math.min(1, leaderSellShares / leaderPositionBefore);
  const rawShares = followerPos * closeFraction;

  return {
    shares: rawShares,
    meta: {
      sizingBasis: "position_fraction",
      leaderPositionBefore,
      followerPosition: followerPos,
      closeFraction,
      rawShares,
    },
  };
}

export function computeMirrorShares(input: {
  sizingMode: string;
  side?: string;
  fixedUsd: string | null;
  pctBalance: string | null;
  pctLeaderNotional: string | null;
  leaderShares: number;
  leaderPrice: number;
  followerUsdc: number | null;
  leaderCash?: number | null;
  leaderPositionBefore?: number | null;
  followerTokenPosition?: number | null;
}): { shares: number; skipReason?: string; meta?: MirrorSizingMeta } {
  const p = input.leaderPrice;
  const ctf = isCtfActivitySide(input.side ?? "");
  if (!ctf && (!Number.isFinite(p) || p <= 0 || p >= 1)) {
    return { shares: 0, skipReason: "invalid_leader_price" };
  }
  if (ctf && (!Number.isFinite(p) || p <= 0)) {
    return { shares: 0, skipReason: "invalid_leader_price" };
  }
  if (input.sizingMode === "fixed_usd") {
    const usd = Number(input.fixedUsd ?? 0);
    if (!Number.isFinite(usd) || usd <= 0) return { shares: 0, skipReason: "invalid_fixed_usd" };
    return { shares: usd / p };
  }
  if (input.sizingMode === "pct_balance") {
    const frac = Number(input.pctBalance ?? 0);
    const bal = input.followerUsdc;
    if (bal == null || !Number.isFinite(bal)) return { shares: 0, skipReason: "missing_follower_balance" };
    if (!Number.isFinite(frac) || frac <= 0) return { shares: 0, skipReason: "invalid_pct_balance" };
    return { shares: (bal * frac) / p };
  }
  if (input.sizingMode === "pct_leader_notional") {
    const pct = Number(input.pctLeaderNotional ?? 0);
    if (!Number.isFinite(pct) || pct <= 0) return { shares: 0, skipReason: "invalid_pct_leader" };
    return { shares: input.leaderShares * (pct / 100) };
  }
  if (input.sizingMode === "proportional_equity") {
    const actionSide = gateSideForActivity(input.side ?? "BUY");
    if (actionSide === "SELL") {
      const sell = computeProportionalSell({
        leaderSellShares: input.leaderShares,
        leaderPositionBefore: input.leaderPositionBefore ?? 0,
        followerPosition: input.followerTokenPosition ?? null,
      });
      return {
        shares: sell.shares,
        skipReason: sell.skipReason,
        meta: { sizingMode: "proportional_equity", ...sell.meta },
      };
    }

    const scale = parseProportionalScale(input.pctBalance);
    if (!Number.isFinite(scale)) {
      return { shares: 0, skipReason: "invalid_proportional_scale" };
    }
    const leaderCash = input.leaderCash;
    if (leaderCash == null || !Number.isFinite(leaderCash)) {
      return { shares: 0, skipReason: "missing_leader_cash" };
    }
    const followerUsdc = input.followerUsdc;
    if (followerUsdc == null || !Number.isFinite(followerUsdc)) {
      return { shares: 0, skipReason: "missing_follower_balance" };
    }
    const ratioResult = computeBalanceRatio(leaderCash, followerUsdc, scale);
    if ("skipReason" in ratioResult) {
      return { shares: 0, skipReason: ratioResult.skipReason };
    }
    const rawShares = input.leaderShares * ratioResult.ratio;
    return {
      shares: rawShares,
      meta: {
        sizingMode: "proportional_equity",
        sizingBasis: "cash_ratio",
        leaderCash,
        followerCash: followerUsdc,
        balanceRatio: ratioResult.ratio,
        proportionalScale: scale,
        rawShares,
      },
    };
  }
  return { shares: 0, skipReason: "unknown_sizing_mode" };
}

export function finalizeMirrorShares(params: {
  shares: number;
  price: number;
  side: string;
  maxNotionalPerTrade: string | null;
  followerUsdc: number | null;
  tokenPosition: number | null;
  meta?: MirrorSizingMeta;
}): {
  shares: number;
  skipReason?: string;
  meta?: MirrorSizingMeta;
} {
  let shares = params.shares;
  const meta: MirrorSizingMeta = { ...params.meta };
  let cappedBy = meta.cappedBy;
  const actionSide = gateSideForActivity(params.side);

  const notionalCap = applyMaxNotional({
    shares,
    price: params.price,
    maxNotionalPerTrade: params.maxNotionalPerTrade,
  });
  shares = notionalCap.shares;
  if (notionalCap.skipReason) return { shares: 0, skipReason: notionalCap.skipReason, meta };
  if (notionalCap.cappedBy) cappedBy = notionalCap.cappedBy;

  if (actionSide === "SELL") {
    const sellCap = applySellPositionCap(shares, params.tokenPosition);
    if (sellCap.skipReason) return { shares: 0, skipReason: sellCap.skipReason, meta };
    shares = sellCap.shares;
    if (sellCap.cappedBy) cappedBy = sellCap.cappedBy;
  } else if (actionSide === "BUY" && params.followerUsdc != null) {
    const buyCap = applyBuyCashCap(shares, params.price, params.followerUsdc);
    shares = buyCap.shares;
    if (buyCap.skipReason) {
      return { shares: 0, skipReason: buyCap.skipReason, meta: { ...meta, cappedBy: buyCap.cappedBy } };
    }
    if (buyCap.cappedBy) cappedBy = buyCap.cappedBy;
  }

  const rounded = roundSharesDown(shares);
  if (rounded < shares) cappedBy = cappedBy ?? "rounding";
  shares = rounded;

  if (!Number.isFinite(shares) || shares < MIN_SHARES) {
    return { shares: 0, skipReason: "size_too_small", meta: { ...meta, cappedBy, roundedShares: shares } };
  }

  if (actionSide === "BUY" && params.side !== "SPLIT") {
    const notional = shares * params.price;
    if (notional < MIN_BUY_NOTIONAL_USD) {
      return { shares: 0, skipReason: "below_min_notional", meta: { ...meta, cappedBy, roundedShares: shares } };
    }
  }

  return {
    shares,
    meta: { ...meta, cappedBy, roundedShares: shares },
  };
}
