import assert from "node:assert/strict";
import { test } from "node:test";
import { buildColorCompletions, parseColorCommand } from "../src/command.ts";
import { ICON_SUGGESTIONS } from "../src/icons.ts";

test("empty args open the picker untargeted", () => {
	assert.deepEqual(parseColorCommand(""), { kind: "picker", role: undefined });
	assert.deepEqual(parseColorCommand("   "), { kind: "picker", role: undefined });
});

test("color without a role opens the picker untargeted", () => {
	assert.deepEqual(parseColorCommand("color"), { kind: "picker", role: undefined });
});

test("color <role> opens the picker pre-targeted", () => {
	assert.deepEqual(parseColorCommand("color separator"), { kind: "picker", role: "separator" });
	assert.deepEqual(parseColorCommand("color context-low"), { kind: "picker", role: "context-low" });
});

test("color <role> <value> sets the role", () => {
	assert.deepEqual(parseColorCommand("color separator dim"), { kind: "set", role: "separator", value: "dim" });
	assert.deepEqual(parseColorCommand("color model auto"), { kind: "set", role: "model", value: "auto" });
	assert.deepEqual(parseColorCommand("color chip #B9D175"), { kind: "set", role: "chip", value: "#B9D175" });
	assert.deepEqual(parseColorCommand("color base 208"), { kind: "set", role: "base", value: "208" });
});

test("unknown roles are rejected", () => {
	assert.deepEqual(parseColorCommand("color banana dim"), { kind: "invalid", reason: "unknown color role: banana" });
	assert.deepEqual(parseColorCommand("color separatorx dim"), {
		kind: "invalid",
		reason: "unknown color role: separatorx",
	});
});

test("invalid values are rejected", () => {
	assert.deepEqual(parseColorCommand("color separator #12345"), {
		kind: "invalid",
		reason: "invalid color value: #12345",
	});
	assert.deepEqual(parseColorCommand("color separator red"), { kind: "invalid", reason: "invalid color value: red" });
	assert.deepEqual(parseColorCommand("color separator 300"), { kind: "invalid", reason: "invalid color value: 300" });
});

test("extra arguments are rejected", () => {
	assert.deepEqual(parseColorCommand("color separator dim extra"), {
		kind: "invalid",
		reason: "unexpected argument: extra",
	});
	assert.deepEqual(parseColorCommand("color-reset extra"), { kind: "invalid", reason: "unexpected argument: extra" });
});

test("color-reset parses", () => {
	assert.deepEqual(parseColorCommand("color-reset"), { kind: "reset" });
});

// ---------------------------------------------------------------------------
// icon subcommand parsing
// ---------------------------------------------------------------------------

test("icon without a role opens the icon picker untargeted", () => {
	assert.deepEqual(parseColorCommand("icon"), { kind: "icon-picker", role: undefined });
});

test("icon <role> opens the icon picker pre-targeted", () => {
	assert.deepEqual(parseColorCommand("icon model"), { kind: "icon-picker", role: "model" });
	assert.deepEqual(parseColorCommand("icon branch"), { kind: "icon-picker", role: "branch" });
});

test("icon <role> <value> sets the role", () => {
	assert.deepEqual(parseColorCommand("icon model none"), { kind: "icon-set", role: "model", value: "none" });
	assert.deepEqual(parseColorCommand("icon model auto"), { kind: "icon-set", role: "model", value: "auto" });
	assert.deepEqual(parseColorCommand("icon branch ❯"), { kind: "icon-set", role: "branch", value: "❯" });
	assert.deepEqual(parseColorCommand("icon path ~"), { kind: "icon-set", role: "path", value: "~" });
});

test("unknown icon roles are rejected", () => {
	assert.deepEqual(parseColorCommand("icon banana none"), { kind: "invalid", reason: "unknown icon role: banana" });
	// color roles are not icon roles
	assert.deepEqual(parseColorCommand("icon separator none"), { kind: "invalid", reason: "unknown icon role: separator" });
});

test("invalid icon values are rejected", () => {
	// over-wide values (a single whitespace-free token) fail validation
	assert.equal(parseColorCommand("icon model —————").kind, "invalid");
	assert.equal(parseColorCommand("icon model banana").kind, "invalid");
	assert.deepEqual(parseColorCommand("icon model —————"), { kind: "invalid", reason: "invalid icon value: —————" });
	// a third token is an extra argument, not part of the value
	assert.deepEqual(parseColorCommand("icon model ❯ extra"), { kind: "invalid", reason: "unexpected argument: extra" });
});

test("icon extra arguments are rejected", () => {
	assert.equal(parseColorCommand("icon model ❯ extra").kind, "invalid");
	assert.deepEqual(parseColorCommand("icon-reset extra"), { kind: "invalid", reason: "unexpected argument: extra" });
});

test("icon-reset parses", () => {
	assert.deepEqual(parseColorCommand("icon-reset"), { kind: "icon-reset" });
});

test("unknown subcommands are rejected", () => {
	assert.deepEqual(parseColorCommand("banana"), { kind: "invalid", reason: "unknown subcommand: banana" });
	assert.deepEqual(parseColorCommand("Color separator dim"), {
		kind: "invalid",
		reason: "unknown subcommand: Color",
	});
});

// ---------------------------------------------------------------------------
// theme subcommand parsing
// ---------------------------------------------------------------------------

test("theme without a subcommand opens the theme menu picker", () => {
	assert.deepEqual(parseColorCommand("theme"), { kind: "theme-menu" });
});

test("bare theme save/load open the picker pre-targeted", () => {
	assert.deepEqual(parseColorCommand("theme save"), { kind: "theme-save", name: undefined });
	assert.deepEqual(parseColorCommand("theme load"), { kind: "theme-load", name: undefined });
});

test("theme save/load names are normalized", () => {
	assert.deepEqual(parseColorCommand("theme save Neon-Pi"), { kind: "theme-save", name: "neon-pi" });
	assert.deepEqual(parseColorCommand("theme load Neon_Pi"), { kind: "theme-load", name: "neon-pi" });
	assert.deepEqual(parseColorCommand("theme save NeonPi"), { kind: "theme-save", name: "neonpi" });
});

test("theme names that normalize to empty are rejected", () => {
	assert.deepEqual(parseColorCommand("theme save !!!"), { kind: "invalid", reason: "invalid theme name: !!!" });
	assert.deepEqual(parseColorCommand("theme load ---"), { kind: "invalid", reason: "invalid theme name: ---" });
});

test("unknown theme subcommands and extra arguments are rejected", () => {
	assert.deepEqual(parseColorCommand("theme banana"), { kind: "invalid", reason: "unknown theme subcommand: banana" });
	assert.deepEqual(parseColorCommand("theme save a b"), { kind: "invalid", reason: "unexpected argument: b" });
	assert.deepEqual(parseColorCommand("theme load a b"), { kind: "invalid", reason: "unexpected argument: b" });
});

// ---------------------------------------------------------------------------
// buildColorCompletions (slash-command autocomplete)
// ---------------------------------------------------------------------------

test("completions: empty argument suggests the subcommands", () => {
	const items = buildColorCompletions("");
	assert.deepEqual(items?.map((i) => i.value), ["color", "color-reset", "icon", "icon-reset", "theme"]);
});

test("completions: partial subcommand names fuzzy-match", () => {
	assert.deepEqual(buildColorCompletions("colo")?.map((i) => i.value), ["color", "color-reset"]);
	// "res" matches both reset subcommands (icon-reset ranks first: shorter)
	assert.deepEqual(buildColorCompletions("res")?.map((i) => i.value), ["icon-reset", "color-reset"]);
	assert.deepEqual(buildColorCompletions("ico")?.map((i) => i.value), ["icon", "icon-reset"]);
	assert.deepEqual(buildColorCompletions("the")?.map((i) => i.value), ["theme"]);
});

test("completions: color <role> suggests roles carrying the full argument text", () => {
	const items = buildColorCompletions("color ");
	assert.ok(items !== null && items.length >= 11);
	const separator = items.find((i) => i.label === "separator")!;
	assert.equal(separator.value, "color separator");
	assert.ok(separator.description);
});

test("completions: partial roles are filtered", () => {
	assert.deepEqual(buildColorCompletions("color cont")?.map((i) => i.label), [
		"context-low",
		"context-medium",
		"context-high",
	]);
});

test("completions: full role followed by a space suggests values", () => {
	const items = buildColorCompletions("color separator ");
	const values = items!.map((i) => i.value);
	assert.ok(values.includes("color separator auto"));
	assert.ok(values.includes("color separator dim"));
	assert.ok(values.includes("color separator #B9D175") === false); // custom hex is picker-only
});

test("completions: value partials are filtered (best match first)", () => {
	const items = buildColorCompletions("color separator dim");
	assert.ok(items !== null && items.length >= 1);
	// the exact match ranks first; fuzzy may also match subsequences
	assert.equal(items[0].value, "color separator dim");
});

test("completions: color-reset takes no arguments", () => {
	assert.equal(buildColorCompletions("color-reset"), null);
	assert.equal(buildColorCompletions("color-reset "), null);
	assert.equal(buildColorCompletions("color banana"), null);
});

// ---------------------------------------------------------------------------
// icon completions
// ---------------------------------------------------------------------------

test("completions: icon <role> suggests icon roles carrying the full argument text", () => {
	const items = buildColorCompletions("icon ");
	assert.ok(items !== null && items.length === 10);
	const model = items.find((i) => i.label === "model")!;
	assert.equal(model.value, "icon model");
	assert.ok(model.description);
});

test("completions: partial icon roles are filtered", () => {
	// "comp" uniquely matches compact (no other "icon <role>" value has an m)
	assert.deepEqual(buildColorCompletions("icon comp")?.map((i) => i.label), ["compact"]);
	// a full role name with no trailing space still offers just that role
	assert.deepEqual(buildColorCompletions("icon branch")?.map((i) => i.label), ["branch"]);
});

test("completions: full icon role followed by a space suggests auto, none, and suggestions", () => {
	const items = buildColorCompletions("icon model ");
	const values = items!.map((i) => i.value);
	assert.equal(values[0], "icon model auto");
	assert.equal(values[1], "icon model none");
	// every curated suggestion is offered with the full argument text
	for (const glyph of ICON_SUGGESTIONS.model) {
		assert.ok(values.includes(`icon model ${glyph}`), `missing suggestion ${glyph}`);
	}
});

test("completions: icon value partials are filtered", () => {
	// a full value (keyword or glyph) matches itself alone and ranks first
	assert.deepEqual(buildColorCompletions("icon model none")?.map((i) => i.value), ["icon model none"]);
	assert.deepEqual(buildColorCompletions("icon branch 🌿")?.map((i) => i.value), ["icon branch 🌿"]);
	// a partial keyword keeps `none` in the running (fuzzy over the full value)
	const items = buildColorCompletions("icon model no");
	assert.ok(items !== null);
	assert.ok(items.some((i) => i.value === "icon model none"), "none stays offered for 'no'");
	assert.equal(buildColorCompletions("icon-reset"), null);
	assert.equal(buildColorCompletions("icon-reset "), null);
	assert.equal(buildColorCompletions("icon banana"), null);
});

test("completions: theme subcommand completes save/load", () => {
	assert.deepEqual(buildColorCompletions("theme ", () => [])?.map((i) => i.value), ["theme save", "theme load"]);
	assert.deepEqual(buildColorCompletions("theme", () => [])?.map((i) => i.value), ["theme save", "theme load"]);
	assert.deepEqual(buildColorCompletions("theme sa", () => [])?.map((i) => i.value), ["theme save"]);
});

test("completions: theme load lists existing theme names, filtered by prefix", () => {
	const names = () => ["neon-pi", "nord"];
	assert.deepEqual(buildColorCompletions("theme load ", names)?.map((i) => i.value), [
		"theme load neon-pi",
		"theme load nord",
	]);
	assert.deepEqual(buildColorCompletions("theme load neo", names)?.map((i) => i.value), ["theme load neon-pi"]);
	// defensive: a listing failure yields no completions
	assert.equal(buildColorCompletions("theme load ", () => []), null);
});

test("completions: theme save takes no name completions", () => {
	assert.equal(buildColorCompletions("theme save ", () => []), null);
	assert.equal(buildColorCompletions("theme save neo", () => ["neon-pi"]), null);
});
