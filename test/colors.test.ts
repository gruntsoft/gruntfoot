import assert from "node:assert/strict";
import { test } from "node:test";
import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import {
	THEME_COLOR_TOKENS,
	colorizeText,
	describeResolvedColor,
	parseColorValue,
	resolveColors,
	rgbToAnsi256,
	roleValueDescription,
	type ResolvedColor,
	type ThemeLike,
} from "../src/colors.ts";

// ---------------------------------------------------------------------------
// parseColorValue
// ---------------------------------------------------------------------------

test("parseColorValue accepts auto, tokens, hex, and indexes", () => {
	assert.deepEqual(parseColorValue("auto"), { kind: "auto" });
	assert.deepEqual(parseColorValue("dim"), { kind: "token", token: "dim" });
	assert.deepEqual(parseColorValue("borderAccent"), { kind: "token", token: "borderAccent" });
	assert.deepEqual(parseColorValue("#B9D175"), { kind: "hex", hex: "#b9d175", r: 185, g: 209, b: 117 });
	assert.deepEqual(parseColorValue("#f0a"), { kind: "hex", hex: "#ff00aa", r: 255, g: 0, b: 170 });
	assert.deepEqual(parseColorValue("#000000"), { kind: "hex", hex: "#000000", r: 0, g: 0, b: 0 });
	assert.deepEqual(parseColorValue("208"), { kind: "index", index: 208 });
	assert.deepEqual(parseColorValue(208), { kind: "index", index: 208 });
	assert.deepEqual(parseColorValue(0), { kind: "index", index: 0 });
	assert.deepEqual(parseColorValue(255), { kind: "index", index: 255 });
	// surrounding whitespace tolerated in strings
	assert.deepEqual(parseColorValue("  dim "), { kind: "token", token: "dim" });
});

test("parseColorValue rejects junk", () => {
	for (const junk of [
		"",
		"   ",
		"red",
		"banana",
		"#12345",
		"#gggggg",
		"#fff0",
		"#fffffff",
		"12.5",
		"256",
		"-1",
		"1e3",
		"NaN",
		"Infinity",
		256,
		-1,
		12.5,
		NaN,
		Infinity,
		null,
		undefined,
		true,
		false,
		{},
		[],
	]) {
		assert.equal(parseColorValue(junk), undefined, `expected ${JSON.stringify(junk)} to be rejected`);
	}
});

// ---------------------------------------------------------------------------
// resolveColors
// ---------------------------------------------------------------------------

const token = (name: ThemeColor): ResolvedColor => ({ kind: "token", token: name });

test("resolveColors: auto chains for every role", () => {
	const resolved = resolveColors({});
	assert.deepEqual(resolved.separator, token("borderAccent"));
	assert.deepEqual(resolved.chip, token("borderAccent"));
	assert.deepEqual(resolved.base, token("muted"));
	assert.equal(resolved.model, undefined);
	assert.equal(resolved.thinking, undefined);
	assert.deepEqual(resolved.contextLow, token("success"));
	assert.deepEqual(resolved.contextMedium, token("warning"));
	assert.deepEqual(resolved.contextHigh, token("error"));
	assert.deepEqual(resolved.path, token("muted"));
	assert.deepEqual(resolved.usage, token("muted"));
	assert.deepEqual(resolved.branch, token("muted"));
});

test("resolveColors: chip follows the resolved separator", () => {
	assert.deepEqual(resolveColors({ separator: "dim" }).chip, token("dim"));
	assert.deepEqual(resolveColors({ separator: "#B9D175" }).chip, {
		kind: "hex",
		hex: "#b9d175",
		r: 185,
		g: 209,
		b: 117,
	});
	// explicit chip wins over the chain
	assert.deepEqual(resolveColors({ separator: "dim", chip: "accent" }).chip, token("accent"));
	// chip: auto falls back to the separator
	assert.deepEqual(resolveColors({ separator: "dim", chip: "auto" }).chip, token("dim"));
});

test("resolveColors: path/usage/branch follow base", () => {
	const resolved = resolveColors({ base: "accent" });
	assert.deepEqual(resolved.path, token("accent"));
	assert.deepEqual(resolved.usage, token("accent"));
	assert.deepEqual(resolved.branch, token("accent"));
	assert.deepEqual(resolveColors({ base: "accent", path: "dim" }).path, token("dim"));
});

test("resolveColors: model/thinking pins and auto", () => {
	assert.deepEqual(resolveColors({ model: "accent" }).model, token("accent"));
	assert.deepEqual(resolveColors({ thinking: "208" }).thinking, { kind: "index", index: 208 });
	assert.equal(resolveColors({ model: "auto", thinking: "auto" }).model, undefined);
});

test("resolveColors: junk entries fall back to auto per-role", () => {
	const resolved = resolveColors({ separator: "banana", base: true, "context-low": {} as unknown });
	assert.deepEqual(resolved.separator, token("borderAccent"));
	assert.deepEqual(resolved.base, token("muted"));
	assert.deepEqual(resolved.contextLow, token("success"));
	// numeric 42 is a valid index, not junk
	assert.deepEqual(resolveColors({ base: 42 }).base, { kind: "index", index: 42 });
});

// ---------------------------------------------------------------------------
// roleValueDescription
// ---------------------------------------------------------------------------

test("roleValueDescription shows the set value or the effective auto chain", () => {
	const config = { separator: "dim", chip: "auto" };
	const resolved = resolveColors(config);
	assert.equal(roleValueDescription("separator", config, resolved), "dim");
	assert.equal(roleValueDescription("chip", config, resolved), "auto → dim");
	assert.equal(roleValueDescription("base", config, resolved), "auto → muted");
	assert.equal(roleValueDescription("model", config, resolved), "auto → thinking-level color");
	assert.equal(roleValueDescription("context-low", config, resolved), "auto → success");
	// junk counts as unset
	assert.equal(roleValueDescription("separator", { separator: "banana" }, resolveColors({})), "auto → borderAccent");
});

test("describeResolvedColor formats each kind", () => {
	assert.equal(describeResolvedColor(token("dim")), "dim");
	assert.equal(describeResolvedColor({ kind: "hex", hex: "#b9d175", r: 185, g: 209, b: 117 }), "#b9d175");
	assert.equal(describeResolvedColor({ kind: "index", index: 208 }), "208");
});

// ---------------------------------------------------------------------------
// rgbToAnsi256
// ---------------------------------------------------------------------------

test("rgbToAnsi256 maps primaries, extremes, and grays", () => {
	assert.equal(rgbToAnsi256(0, 0, 0), 16); // black → cube 0,0,0
	assert.equal(rgbToAnsi256(255, 255, 255), 231); // white → cube 5,5,5
	assert.equal(rgbToAnsi256(255, 0, 0), 196); // red
	assert.equal(rgbToAnsi256(0, 255, 0), 46); // green
	assert.equal(rgbToAnsi256(0, 0, 255), 21); // blue
	assert.equal(rgbToAnsi256(128, 128, 128), 244); // mid gray → grayscale ramp
	assert.equal(rgbToAnsi256(0, 0, 0) >= 16 && rgbToAnsi256(0, 0, 0) <= 255, true);
});

test("rgbToAnsi256 is deterministic across repeated and interleaved calls (memoized path)", () => {
	// Repeated calls hit the memoization cache; results must stay stable.
	for (let i = 0; i < 3; i++) {
		assert.equal(rgbToAnsi256(185, 209, 117), 150);
		assert.equal(rgbToAnsi256(0, 0, 0), 16);
		assert.equal(rgbToAnsi256(255, 255, 255), 231);
	}
	// Distinct colors do not poison each other's cache entries.
	const first = rgbToAnsi256(1, 2, 3);
	assert.equal(rgbToAnsi256(1, 2, 3), first);
	assert.equal(rgbToAnsi256(200, 20, 20), rgbToAnsi256(200, 20, 20));
	assert.notEqual(rgbToAnsi256(1, 2, 3), rgbToAnsi256(200, 20, 20));
});

// ---------------------------------------------------------------------------
// colorizeText
// ---------------------------------------------------------------------------

function stubTheme(mode: "truecolor" | "256color"): ThemeLike {
	return {
		fg: (color, text) => `[${color}]${text}`,
		getColorMode: () => mode,
	};
}

test("colorizeText: tokens go through theme.fg", () => {
	assert.equal(colorizeText(stubTheme("truecolor"), token("dim"), "x"), "[dim]x");
});

test("colorizeText: hex emits truecolor ANSI on truecolor terminals", () => {
	const theme = stubTheme("truecolor");
	assert.equal(
		colorizeText(theme, { kind: "hex", hex: "#b9d175", r: 185, g: 209, b: 117 }, "x"),
		"\x1b[38;2;185;209;117mx\x1b[39m",
	);
});

test("colorizeText: hex downconverts to xterm-256 on 256-color terminals", () => {
	const theme = stubTheme("256color");
	assert.equal(
		colorizeText(theme, { kind: "hex", hex: "#b9d175", r: 185, g: 209, b: 117 }, "x"),
		"\x1b[38;5;150mx\x1b[39m",
	);
});

test("colorizeText: indexes emit 38;5 directly", () => {
	assert.equal(colorizeText(stubTheme("256color"), { kind: "index", index: 208 }, "x"), "\x1b[38;5;208mx\x1b[39m");
	assert.equal(colorizeText(stubTheme("truecolor"), { kind: "index", index: 208 }, "x"), "\x1b[38;5;208mx\x1b[39m");
});

test("THEME_COLOR_TOKENS covers the roles' default tokens", () => {
	for (const name of ["borderAccent", "muted", "success", "warning", "error"]) {
		assert.ok(THEME_COLOR_TOKENS.includes(name as (typeof THEME_COLOR_TOKENS)[number]), name);
	}
});
