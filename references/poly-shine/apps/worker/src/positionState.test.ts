import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compareLeaderEvents,
  effectiveLineState,
  evaluateLineGate,
  isLeaderEventBefore,
  netLeaderSharesFromFills,
} from "./positionState.js";
import { netLeaderSharesFromActivityFills } from "./leaderActivity.js";
import { computeProportionalSell } from "./sizing.js";

describe("effectiveLineState", () => {
  it("maps shadow_active to watching in live", () => {
    assert.equal(effectiveLineState("shadow_active", "live"), "watching");
  });

  it("maps shadow_active to active in shadow", () => {
    assert.equal(effectiveLineState("shadow_active", "shadow"), "active");
  });
});

describe("evaluateLineGate", () => {
  it("blocks SELL when abandoned and leader still holds", () => {
    const r = evaluateLineGate({ lineState: "abandoned", side: "SELL", leaderPositionBefore: 50 });
    assert.equal(r.allow, false);
    if (!r.allow) assert.equal(r.skipReason, "line_abandoned");
  });

  it("allows BUY when abandoned and leader flat at a new timestamp", () => {
    const r = evaluateLineGate({ lineState: "abandoned", side: "BUY", leaderPositionBefore: 0 });
    assert.equal(r.allow, true);
    if (r.allow) assert.equal(r.lineState, "watching");
  });

  it("allows BUY when abandoned and leader flat (new line)", () => {
    const r = evaluateLineGate({ lineState: "abandoned", side: "BUY", leaderPositionBefore: 0 });
    assert.equal(r.allow, true);
    if (r.allow) assert.equal(r.lineState, "watching");
  });

  it("blocks BUY when abandoned and leader still holds", () => {
    const r = evaluateLineGate({ lineState: "abandoned", side: "BUY", leaderPositionBefore: 50 });
    assert.equal(r.allow, false);
    if (!r.allow) assert.equal(r.skipReason, "line_abandoned");
  });

  it("blocks SELL when untracked", () => {
    const r = evaluateLineGate({ lineState: "untracked", side: "SELL", leaderPositionBefore: 0 });
    assert.equal(r.allow, false);
    if (!r.allow) assert.equal(r.skipReason, "entry_not_established");
  });

  it("blocks BUY add-on when untracked and leader already holds", () => {
    const r = evaluateLineGate({ lineState: "untracked", side: "BUY", leaderPositionBefore: 50 });
    assert.equal(r.allow, false);
    if (!r.allow) assert.equal(r.skipReason, "leader_already_in_position");
  });
});

describe("leader event ordering", () => {
  const ts = 1_700_000_000_000;

  it("orders same-timestamp fills by createdAt then id", () => {
    const a = { tradeTimestamp: ts, createdAt: "2026-05-17T10:00:00.100Z", id: "z-last-id" };
    const b = { tradeTimestamp: ts, createdAt: "2026-05-17T10:00:00.050Z", id: "a-first-id" };
    assert.ok(isLeaderEventBefore(b, a));
    assert.ok(compareLeaderEvents(b, a) < 0);
  });

  it("sums only fills strictly before the reference event", () => {
    const fills = [
      { side: "BUY", size: 98 },
      { side: "BUY", size: 92.74 },
      { side: "BUY", size: 176.53 },
    ];
    assert.equal(netLeaderSharesFromFills(fills.slice(0, 2)), 190.74);
  });

  it("subtracts MERGE from reconstructed leader position", () => {
    const fills = [
      { side: "BUY", size: 100 },
      { side: "MERGE", size: 25 },
    ];
    assert.equal(netLeaderSharesFromActivityFills(fills), 75);
  });
});

describe("evaluateLineGate for MERGE", () => {
  it("treats MERGE like SELL when untracked", () => {
    const r = evaluateLineGate({ lineState: "untracked", side: "MERGE", leaderPositionBefore: 10 });
    assert.equal(r.allow, false);
    if (!r.allow) assert.equal(r.skipReason, "entry_not_established");
  });
});

describe("computeProportionalSell", () => {
  it("sells 20% of follower when leader sells 20% of book", () => {
    const r = computeProportionalSell({
      leaderSellShares: 20,
      leaderPositionBefore: 100,
      followerPosition: 10,
    });
    assert.equal(r.shares, 2);
    assert.equal(r.meta.closeFraction, 0.2);
  });

  it("full close when leader liquidates line", () => {
    const r = computeProportionalSell({
      leaderSellShares: 100,
      leaderPositionBefore: 100,
      followerPosition: 10,
    });
    assert.equal(r.shares, 10);
    assert.equal(r.meta.closeFraction, 1);
  });
});
