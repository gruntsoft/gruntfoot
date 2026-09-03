import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCost, formatCwd, formatPercent, formatTokens, truncateName } from "../src/format.ts";

test("formatTokens mirrors the default footer compaction", () => {
	assert.equal(formatTokens(0), "0");
	assert.equal(formatTokens(999), "999");
	assert.equal(formatTokens(1000), "1.0k");
	assert.equal(formatTokens(9999), "10.0k");
	assert.equal(formatTokens(10000), "10k");
	assert.equal(formatTokens(12345), "12k");
	assert.equal(formatTokens(999999), "1000k");
	assert.equal(formatTokens(1000000), "1.0M");
	assert.equal(formatTokens(1234567), "1.2M");
	assert.equal(formatTokens(9999999), "10.0M");
	assert.equal(formatTokens(10000000), "10M");
});

test("formatCost renders 4 decimals", () => {
	assert.equal(formatCost(0.0042), "$0.0042");
	assert.equal(formatCost(0), "$0.0000");
	assert.equal(formatCost(1.5), "$1.5000");
	assert.equal(formatCost(12.34567), "$12.3457");
});

test("formatPercent renders 1 decimal", () => {
	assert.equal(formatPercent(33.333), "33.3");
	assert.equal(formatPercent(90), "90.0");
	assert.equal(formatPercent(0), "0.0");
});

test("formatCwd abbreviates home with ~", () => {
	assert.equal(formatCwd("/home/user", "/home/user"), "~");
	assert.equal(formatCwd("/home/user/dev", "/home/user"), "~/dev");
	assert.equal(formatCwd("/home/user/dev/sub", "/home/user"), "~/dev/sub");
	assert.equal(formatCwd("/home/user2/dev", "/home/user"), "/home/user2/dev");
	assert.equal(formatCwd("/etc", "/home/user"), "/etc");
	assert.equal(formatCwd("/opt/proj", ""), "/opt/proj");
});

test("truncateName keeps short names and control chars stripped", () => {
	assert.equal(truncateName("short"), "short");
	assert.equal(truncateName("a\nb\tc\x1b[d"), "abc[d");
	assert.equal(truncateName("   "), "");
	assert.equal(truncateName(""), "");
});

test("truncateName truncates above max to max-3 chars plus ...", () => {
	const name64 = "a".repeat(64);
	assert.equal(truncateName(name64), name64);
	const name65 = "a".repeat(65);
	assert.equal(truncateName(name65), "a".repeat(61) + "...");
	assert.equal(truncateName(name65).length, 64);
});

test("truncateName is code-point aware (emoji)", () => {
	const emoji70 = "😀".repeat(70);
	const truncated = truncateName(emoji70);
	assert.equal([...truncated].length, 64);
	assert.equal(truncated, "😀".repeat(61) + "...");
});
