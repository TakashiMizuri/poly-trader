import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  activityDedupeKey,
  expandLeaderActivities,
  resolveCtfActivityAssets,
} from "./dataApi.js";
import { ctfMirrorDedupeKey } from "./leaderActivity.js";

describe("resolveCtfActivityAssets", () => {
  it("uses both outcome tokens when asset is empty", () => {
    const assets = resolveCtfActivityAssets(
      { type: "MERGE", timestamp: 1, size: 10, conditionId: "0xabc" },
      ["111", "222"]
    );
    assert.deepEqual(assets, ["111", "222"]);
  });

  it("falls back to condition pseudo-asset when tokens unknown", () => {
    const assets = resolveCtfActivityAssets(
      { type: "MERGE", timestamp: 1, size: 10, conditionId: "0xAbC" },
      null
    );
    assert.deepEqual(assets, ["condition:0xabc"]);
  });
});

describe("expandLeaderActivities", () => {
  it("maps MERGE without asset to two rows when tokens are provided", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify([
          {
            clobTokenIds: '["1001","1002"]',
            question: "Test market",
          },
        ]),
        { status: 200 }
      );

    try {
      const rows = await expandLeaderActivities({
        type: "MERGE",
        timestamp: 1_700_000_000,
        size: 50,
        usdcSize: 50,
        conditionId: "0xf404052387b0612112823ad31ca9572150cce046590c61b6c98792eb7b264ed1",
        transactionHash: "0xtx",
        asset: "",
      });
      assert.equal(rows.length, 2);
      assert.equal(rows[0]!.side, "MERGE");
      assert.equal(rows[0]!.price, 1);
      assert.equal(rows[0]!.asset, "1001");
      assert.equal(rows[1]!.asset, "1002");
      assert.notEqual(activityDedupeKey(rows[0]!), activityDedupeKey(rows[1]!));
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("dedupes CTF mirror intents per condition tx", () => {
    const key = ctfMirrorDedupeKey("sub-1", {
      side: "MERGE",
      conditionId: "0xcond",
      txHash: "0xtx",
      size: "10",
      tradeTimestamp: 100,
    });
    assert.match(key, /^m:sub-1:ctf:MERGE:/);
  });
});
