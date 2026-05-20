import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeBalanceRatio,
  computeMirrorShares,
  finalizeMirrorShares,
  roundSharesDown,
  applyBuyCashCap,
  applySellPositionCap,
  applyMaxNotional,
} from "./sizing.js";

describe("computeBalanceRatio", () => {
  it("computes 10% for 100/1000", () => {
    const r = computeBalanceRatio(1000, 100, 1);
    assert.equal("ratio" in r && r.ratio, 0.1);
  });

  it("applies scale", () => {
    const r = computeBalanceRatio(1000, 100, 0.5);
    assert.equal("ratio" in r && r.ratio, 0.05);
  });

  it("rejects zero leader cash", () => {
    const r = computeBalanceRatio(0, 100, 1);
    assert.equal("skipReason" in r && r.skipReason, "leader_cash_zero");
  });
});

describe("computeMirrorShares proportional_equity", () => {
  it("mirrors BUY at 10% cash ratio", () => {
    const r = computeMirrorShares({
      sizingMode: "proportional_equity",
      side: "BUY",
      fixedUsd: null,
      pctBalance: "1",
      pctLeaderNotional: null,
      leaderShares: 100,
      leaderPrice: 0.5,
      followerUsdc: 100,
      leaderCash: 1000,
    });
    assert.equal(r.shares, 10);
    assert.equal(r.meta?.balanceRatio, 0.1);
    assert.equal(r.meta?.sizingBasis, "cash_ratio");
  });

  it("mirrors SELL by position fraction", () => {
    const r = computeMirrorShares({
      sizingMode: "proportional_equity",
      side: "SELL",
      fixedUsd: null,
      pctBalance: "1",
      pctLeaderNotional: null,
      leaderShares: 20,
      leaderPrice: 0.5,
      followerUsdc: 100,
      leaderCash: 1000,
      leaderPositionBefore: 100,
      followerTokenPosition: 10,
    });
    assert.equal(r.shares, 2);
    assert.equal(r.meta?.sizingBasis, "position_fraction");
    assert.equal(r.meta?.closeFraction, 0.2);
  });

  it("skips BUY when leader cash missing", () => {
    const r = computeMirrorShares({
      sizingMode: "proportional_equity",
      side: "BUY",
      fixedUsd: null,
      pctBalance: "1",
      pctLeaderNotional: null,
      leaderShares: 100,
      leaderPrice: 0.5,
      followerUsdc: 100,
      leaderCash: null,
    });
    assert.equal(r.skipReason, "missing_leader_cash");
  });
});

describe("finalizeMirrorShares", () => {
  it("caps sell to position", () => {
    const r = finalizeMirrorShares({
      shares: 50,
      price: 0.5,
      side: "SELL",
      maxNotionalPerTrade: null,
      followerUsdc: null,
      tokenPosition: 5,
      meta: { sizingMode: "proportional_equity", balanceRatio: 0.1 },
    });
    assert.equal(r.shares, 5);
    assert.equal(r.meta?.cappedBy, "position");
  });

  it("skips sell with no position", () => {
    const r = finalizeMirrorShares({
      shares: 10,
      price: 0.5,
      side: "SELL",
      maxNotionalPerTrade: null,
      followerUsdc: null,
      tokenPosition: 0,
    });
    assert.equal(r.skipReason, "no_position_to_sell");
  });

  it("caps buy to available cash", () => {
    const r = finalizeMirrorShares({
      shares: 100,
      price: 0.5,
      side: "BUY",
      maxNotionalPerTrade: null,
      followerUsdc: 10,
      tokenPosition: null,
    });
    assert.equal(r.shares, 19.6);
    assert.equal(r.meta?.cappedBy, "cash");
  });

  it("rejects below min notional after rounding", () => {
    const r = finalizeMirrorShares({
      shares: 1,
      price: 0.5,
      side: "BUY",
      maxNotionalPerTrade: null,
      followerUsdc: 100,
      tokenPosition: null,
    });
    assert.equal(r.skipReason, "below_min_notional");
  });
});

describe("roundSharesDown", () => {
  it("rounds to 2 decimals", () => {
    assert.equal(roundSharesDown(10.999), 10.99);
  });
});

describe("applyMaxNotional", () => {
  it("caps shares by max notional", () => {
    const r = applyMaxNotional({ shares: 100, price: 0.5, maxNotionalPerTrade: "25" });
    assert.equal(r.shares, 50);
    assert.equal(r.cappedBy, "max_notional");
  });
});

describe("applySellPositionCap", () => {
  it("passes through when position is null", () => {
    const r = applySellPositionCap(10, null);
    assert.equal(r.shares, 10);
  });
});

describe("applyBuyCashCap", () => {
  it("limits shares by cash buffer", () => {
    const r = applyBuyCashCap(100, 0.5, 10);
    assert.equal(r.shares, 19.6);
  });
});
