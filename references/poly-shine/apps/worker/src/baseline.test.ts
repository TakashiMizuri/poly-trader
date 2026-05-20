import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isBeforeFollowBaseline } from "./baseline.js";

describe("isBeforeFollowBaseline", () => {
  const followFromMs = 1_700_000_000_000;

  it("treats second-precision API timestamps as before ms watermark", () => {
    assert.equal(isBeforeFollowBaseline(1_699_999_999, followFromMs), true);
  });

  it("allows activity at or after watermark", () => {
    assert.equal(isBeforeFollowBaseline(1_700_000_000, followFromMs), false);
    assert.equal(isBeforeFollowBaseline(followFromMs, followFromMs), false);
  });
});
