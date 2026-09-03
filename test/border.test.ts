import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBottomBorder, type BorderStyle } from "../src/border.ts";
import { visibleWidth } from "@earendil-works/pi-tui";

const ARROW = "─── ↓ 3 more ";

function stubStyle(): BorderStyle {
	return {
		dash: (text) => `D[${text}]`,
		chip: (text) => `C[${text}]`,
	};
}

function plainStyle(): BorderStyle {
	return {
		dash: (text) => text,
		chip: (text) => `[${text}]`,
	};
}

test("plain separator without chip or arrows fills with dashes", () => {
	assert.equal(buildBottomBorder(20, null, null, stubStyle()), "D[────────────────────]");
});

test("zero or negative width yields an empty line", () => {
	assert.equal(buildBottomBorder(0, null, null, stubStyle()), "");
	assert.equal(buildBottomBorder(-5, null, null, stubStyle()), "");
});

test("arrow block is preserved left-aligned", () => {
	const result = buildBottomBorder(30, ARROW, null, stubStyle());
	assert.equal(result, `${ARROW}${stubStyle().dash("─".repeat(30 - visibleWidth(ARROW)))}`);
});

test("chip alone is right-aligned with a dash flank on both sides", () => {
	const result = buildBottomBorder(20, null, "name", plainStyle());
	assert.equal(result, `${"─".repeat(11)}[ name ]─`);
	assert.equal(visibleWidth(result), 20);
});

test("chip coexists with the arrow block when there is room", () => {
	const result = buildBottomBorder(30, ARROW, "name", plainStyle());
	// arrow (13) + gap (2) + chip (8) + right flank (1) = 24 <= 30
	assert.equal(result, `${ARROW}${"─".repeat(8)}[ name ]─`);
	assert.equal(visibleWidth(result), 30);
	assert.ok(result.startsWith(ARROW));
});

test("chip yields (null) when it would collide with the arrow block", () => {
	assert.equal(buildBottomBorder(23, ARROW, "name", plainStyle()), null);
	assert.equal(buildBottomBorder(24, ARROW, "name", plainStyle()), `${ARROW}${"─".repeat(2)}[ name ]─`);
});

test("chip yields (null) when the terminal is too narrow even without arrows", () => {
	assert.equal(buildBottomBorder(5, null, "name", plainStyle()), null);
});

test("empty chip text renders a plain separator", () => {
	assert.equal(buildBottomBorder(10, null, "", plainStyle()), "──────────");
});

test("ANSI-styled arrow text is measured by visible width", () => {
	const styledArrow = `\x1b[31m${ARROW}\x1b[0m`;
	const result = buildBottomBorder(30, styledArrow, "name", plainStyle());
	assert.equal(result, `${styledArrow}${"─".repeat(8)}[ name ]─`);
	assert.equal(visibleWidth(result), 30);
});

test("styled chip wrapper is measured by visible width", () => {
	const style: BorderStyle = {
		dash: (text) => text,
		chip: (text) => `\x1b[7m${text}\x1b[0m`,
	};
	const result = buildBottomBorder(20, null, "name", style);
	assert.notEqual(result, null);
	assert.equal(visibleWidth(result!), 20);
	assert.equal(result, `${"─".repeat(13)}\x1b[7m name \x1b[0m─`);
});
