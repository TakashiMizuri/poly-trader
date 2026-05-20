import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldFetchNextActivityPage } from "./dataApi.js";
import type { DataApiActivity } from "./dataApi.js";

function page(timestamps: number[]): DataApiActivity[] {
  return timestamps.map((timestamp) => ({ timestamp, type: "TRADE", size: 1 }));
}

describe("shouldFetchNextActivityPage", () => {
  it("stops on short page", () => {
    assert.equal(shouldFetchNextActivityPage(page([100, 99]), 100, 50, 1, 10), false);
  });

  it("stops when oldest event on a full page is at or before cursor", () => {
    const throughCursor = Array.from({ length: 100 }, (_, i) => 149 - i);
    assert.equal(shouldFetchNextActivityPage(page(throughCursor), 100, 50, 1, 10), false);

    const aboveCursor = Array.from({ length: 100 }, (_, i) => 150 - i);
    assert.equal(shouldFetchNextActivityPage(page(aboveCursor), 100, 50, 1, 10), true);
  });

  it("does not paginate without a cursor", () => {
    assert.equal(shouldFetchNextActivityPage(page([100, 99]), 100, null, 1, 10), false);
  });

  it("respects maxPages", () => {
    assert.equal(shouldFetchNextActivityPage(page([100, 99]), 100, 50, 10, 10), false);
  });
});
