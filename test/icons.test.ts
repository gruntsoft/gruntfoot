import assert from "node:assert/strict";
import { test } from "node:test";
import {
	DEFAULT_ICONS,
	ICON_MAX_WIDTH,
	ICON_ROLE_INFO,
	ICON_ROLES,
	ICON_SUGGESTIONS,
	parseIconValue,
	resolveIcons,
	roleValueDescription,
	type IconConfig,
} from "../src/icons.ts";

// ---------------------------------------------------------------------------
// parseIconValue
// ---------------------------------------------------------------------------

test("parseIconValue: auto and none are keywords", () => {
	assert.deepEqual(parseIconValue("auto"), { kind: "auto" });
	assert.deepEqual(parseIconValue("  auto  "), { kind: "auto" });
	assert.deepEqual(parseIconValue("none"), { kind: "none" });
	assert.deepEqual(parseIconValue(" none "), { kind: "none" });
});

test("parseIconValue: custom glyphs are trimmed and pass through", () => {
	assert.deepEqual(parseIconValue("❯"), { kind: "custom", text: "❯" });
	assert.deepEqual(parseIconValue("  ✦  "), { kind: "custom", text: "✦" });
	assert.deepEqual(parseIconValue("~"), { kind: "custom", text: "~" });
	assert.deepEqual(parseIconValue("»"), { kind: "custom", text: "»" });
	assert.deepEqual(parseIconValue("🤖"), { kind: "custom", text: "🤖" });
	// multi-glyph within the cap
	assert.deepEqual(parseIconValue("»~"), { kind: "custom", text: "»~" });
});

test("parseIconValue: non-strings are junk (numbers included)", () => {
	assert.equal(parseIconValue(42), undefined);
	assert.equal(parseIconValue(0), undefined);
	assert.equal(parseIconValue(undefined), undefined);
	assert.equal(parseIconValue(null), undefined);
	assert.equal(parseIconValue({}), undefined);
	assert.equal(parseIconValue(["✦"]), undefined);
	assert.equal(parseIconValue(true), undefined);
});

test("parseIconValue: empty and whitespace-only are junk", () => {
	assert.equal(parseIconValue(""), undefined);
	assert.equal(parseIconValue("   "), undefined);
	assert.equal(parseIconValue("\t\n"), undefined);
});

test("parseIconValue: control characters are rejected (C0, DEL, C1)", () => {
	assert.equal(parseIconValue("a\nb"), undefined); // newline
	assert.equal(parseIconValue("a\tb"), undefined); // tab
	assert.equal(parseIconValue("a\rb"), undefined); // carriage return
	assert.equal(parseIconValue("\x1b[31m"), undefined); // ESC / ANSI escape
	assert.equal(parseIconValue("\x00"), undefined); // NUL
	assert.equal(parseIconValue("\x07"), undefined); // BEL
	assert.equal(parseIconValue("\x7f"), undefined); // DEL
	assert.equal(parseIconValue("\u{85}"), undefined); // C1 U+0085 (NEL)
	assert.equal(parseIconValue("\u{9b}"), undefined); // C1 U+009B
	// controls anywhere in the string, not just the edges
	assert.equal(parseIconValue("ok\x1bbad"), undefined);
});

test("parseIconValue: width cap of 4 visible columns", () => {
	assert.equal(ICON_MAX_WIDTH, 4);
	// 1-column ASCII
	assert.equal(parseIconValue("x")?.kind, "custom");
	// 2-column emoji and CJK
	assert.equal(parseIconValue("🤖")?.kind, "custom");
	assert.equal(parseIconValue("漢")?.kind, "custom");
	// exactly 4 columns passes
	assert.equal(parseIconValue("————")?.kind, "custom"); // 4 × 1-column em dash
	assert.equal(parseIconValue("🤖🤖")?.kind, "custom"); // 2 × 2-column emoji
	// 5 columns is rejected
	assert.equal(parseIconValue("—————"), undefined);
	assert.equal(parseIconValue("🤖🤖🤖"), undefined);
	assert.equal(parseIconValue("ab cd"), undefined);
	// trim happens before the width check
	assert.equal(parseIconValue("  ————  ")?.kind, "custom");
});

// ---------------------------------------------------------------------------
// resolveIcons
// ---------------------------------------------------------------------------

test("resolveIcons: defaults for an empty config", () => {
	const resolved = resolveIcons({});
	assert.deepEqual(resolved, DEFAULT_ICONS);
	for (const role of ICON_ROLES) {
		assert.equal(typeof resolved[role], "string");
		assert.ok(resolved[role].length > 0);
	}
});

test("resolveIcons: none resolves to the empty string", () => {
	const resolved = resolveIcons({ model: "none", branch: "none" });
	assert.equal(resolved.model, "");
	assert.equal(resolved.branch, "");
	assert.equal(resolved.path, DEFAULT_ICONS.path); // untouched roles keep defaults
});

test("resolveIcons: auto and junk fall back to defaults per-role", () => {
	const resolved = resolveIcons({ model: "auto", thinking: 42, context: "", compact: "—————", path: "\x1b" });
	assert.equal(resolved.model, DEFAULT_ICONS.model);
	assert.equal(resolved.thinking, DEFAULT_ICONS.thinking);
	assert.equal(resolved.context, DEFAULT_ICONS.context);
	assert.equal(resolved.compact, DEFAULT_ICONS.compact);
	assert.equal(resolved.path, DEFAULT_ICONS.path);
});

test("resolveIcons: custom glyphs pass through", () => {
	const resolved = resolveIcons({ model: "❯", tokens: "⇅", cost: "$" });
	assert.equal(resolved.model, "❯");
	assert.equal(resolved.tokens, "⇅");
	assert.equal(resolved.cost, "$");
});

test("resolveIcons: undefined config behaves like empty", () => {
	assert.deepEqual(resolveIcons(), resolveIcons({}));
});

// ---------------------------------------------------------------------------
// roleValueDescription
// ---------------------------------------------------------------------------

test("roleValueDescription: auto form shows the default glyph", () => {
	assert.equal(roleValueDescription("model", {}), "auto → 🤖");
	assert.equal(roleValueDescription("branch", { branch: 42 }), "auto → 🌿"); // junk → auto
	assert.equal(roleValueDescription("cost", { cost: "auto" }), "auto → 💸");
	assert.equal(roleValueDescription("path", { path: "junk-value" }), "auto → 📁"); // too wide → auto
});

test("roleValueDescription: none and custom values as written", () => {
	assert.equal(roleValueDescription("model", { model: "none" }), "none");
	assert.equal(roleValueDescription("model", { model: "⚡" }), "⚡");
});

// ---------------------------------------------------------------------------
// Registry shape
// ---------------------------------------------------------------------------

test("every icon role has info, a default, and at least 5 valid suggestions", () => {
	for (const role of ICON_ROLES) {
		assert.ok(ICON_ROLE_INFO[role].label.length > 0, `label for ${role}`);
		assert.ok(DEFAULT_ICONS[role].length > 0, `default for ${role}`);
		const suggestions = ICON_SUGGESTIONS[role];
		assert.ok(suggestions.length >= 5, `at least 5 suggestions for ${role}`);
		assert.equal(new Set(suggestions).size, suggestions.length, `no duplicate suggestions for ${role}`);
		for (const glyph of suggestions) {
			assert.equal(parseIconValue(glyph)?.kind, "custom", `suggestion ${glyph} for ${role} must be valid`);
			assert.notEqual(glyph, "auto");
			assert.notEqual(glyph, "none");
		}
	}
});

test("the default emoji are themselves valid icon values", () => {
	for (const role of ICON_ROLES) {
		assert.equal(parseIconValue(DEFAULT_ICONS[role])?.kind, "custom", `default for ${role}`);
	}
});

test("IconConfig accepts arbitrary junk at the type level (filtered at resolve)", () => {
	const config = { model: "⚡", bogus: "whatever" } as IconConfig;
	assert.equal(resolveIcons(config).model, "⚡");
});
