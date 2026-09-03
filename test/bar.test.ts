import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContextBar } from "../src/bar.ts";

const cells = (filled: number, total = 20) => `[${"▓".repeat(filled)}${"░".repeat(total - filled)}]`;

test("unknown percent renders an empty bar with null level", () => {
	assert.deepEqual(buildContextBar(null), { text: cells(0), level: null });
});

test("percent maps to cells at exactly 5% per cell", () => {
	assert.deepEqual(buildContextBar(0), { text: cells(0), level: "low" });
	assert.deepEqual(buildContextBar(5), { text: cells(1), level: "low" });
	assert.deepEqual(buildContextBar(50), { text: cells(10), level: "medium" });
	assert.deepEqual(buildContextBar(90), { text: cells(18), level: "high" });
	assert.deepEqual(buildContextBar(100), { text: cells(20), level: "high" });
});

test("threshold levels: <50 low, 50-<90 medium, >=90 high", () => {
	assert.equal(buildContextBar(49.9).level, "low");
	assert.equal(buildContextBar(50).level, "medium");
	assert.equal(buildContextBar(89.9).level, "medium");
	assert.equal(buildContextBar(90).level, "high");
});

test("filled cells round to the nearest cell", () => {
	assert.equal(buildContextBar(4.9).text, cells(1));
	assert.equal(buildContextBar(49.9).text, cells(10));
	assert.equal(buildContextBar(89.9).text, cells(18));
});

test("out-of-range percents clamp to 0..cells", () => {
	assert.deepEqual(buildContextBar(-5), { text: cells(0), level: "low" });
	assert.deepEqual(buildContextBar(150), { text: cells(20), level: "high" });
});

test("custom cell count", () => {
	assert.deepEqual(buildContextBar(50, 10), { text: cells(5, 10), level: "medium" });
});
