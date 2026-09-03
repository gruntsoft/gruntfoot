import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createThemeStore, normalizeThemeName, type ThemeFileSystem, type ThemeStore } from "../src/themes.ts";
import type { ColorRole } from "../src/colors.ts";
import type { IconRole } from "../src/icons.ts";

let counter = 0;

/** Fresh sandbox dir per test. */
function setup(): string {
	const dir = join(tmpdir(), `gruntfoot-themes-${process.pid}-${counter++}`);
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	return dir;
}

/** Real node fs against the sandbox; individual hooks overridable per test. */
function makeFs(overrides: Partial<ThemeFileSystem> = {}): ThemeFileSystem {
	return {
		readFileSync: (path) => readFileSync(path, "utf8"),
		writeFileSync,
		existsSync,
		mkdirSync,
		readdirSync,
		...overrides,
	};
}

function makeStore(overrides: { dir?: string; fs?: Partial<ThemeFileSystem> } = {}): {
	store: ThemeStore;
	dir: string;
} {
	const dir = overrides.dir ?? join(setup(), "themes");
	return { store: createThemeStore({ dir, fs: makeFs(overrides.fs) }), dir };
}

// ---------------------------------------------------------------------------
// Name normalization
// ---------------------------------------------------------------------------

test("normalizeThemeName lowercases and collapses non-alphanumeric runs to dashes", () => {
	assert.equal(normalizeThemeName("Neon Pi"), "neon-pi");
	assert.equal(normalizeThemeName("  Neon   Pi!!  "), "neon-pi");
	assert.equal(normalizeThemeName("my.theme_v2"), "my-theme-v2");
	assert.equal(normalizeThemeName("ALLCAPS"), "allcaps");
	assert.equal(normalizeThemeName("a--b"), "a-b");
	assert.equal(normalizeThemeName("---x---"), "x");
	assert.equal(normalizeThemeName("123"), "123");
});

test("normalizeThemeName returns empty for names that normalize to nothing", () => {
	assert.equal(normalizeThemeName(""), "");
	assert.equal(normalizeThemeName("!!!"), "");
	assert.equal(normalizeThemeName("   "), "");
	assert.equal(normalizeThemeName("---"), "");
});

test("the store exposes normalizeThemeName", () => {
	const { store } = makeStore();
	assert.equal(store.normalizeThemeName("Neon Pi"), "neon-pi");
});

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

test("listThemeNames: missing or unreadable dir lists as empty, never throws", () => {
	assert.deepEqual(makeStore().store.listThemeNames(), []);
	const { store } = makeStore({
		fs: {
			readdirSync: () => {
				throw new Error("EACCES");
			},
		},
	});
	assert.deepEqual(store.listThemeNames(), []);
});

test("listThemeNames: only .json files minus the suffix, dotfiles skipped, sorted", () => {
	const { store, dir } = makeStore();
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "b.json"), "{}");
	writeFileSync(join(dir, "a.json"), "{}");
	writeFileSync(join(dir, "notes.txt"), "{}");
	writeFileSync(join(dir, ".hidden.json"), "{}");
	writeFileSync(join(dir, "UPPER.JSON"), "{}");
	assert.deepEqual(store.listThemeNames(), ["a", "b"]);
});

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

test("saveTheme creates the themes dir on first save and writes the {colors, icons} wrapper", () => {
	const { store, dir } = makeStore();
	assert.deepEqual(
		store.saveTheme("neon-pi", { colors: { separator: "dim", base: 208 }, icons: { model: "⚡" } }),
		{ ok: true },
	);
	const file = join(dir, "neon-pi.json");
	assert.equal(existsSync(file), true);
	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
		colors: { separator: "dim", base: 208 },
		icons: { model: "⚡" },
	});
});

test("saveTheme always writes both keys, even when a map is empty", () => {
	const { store, dir } = makeStore();
	store.saveTheme("a", { colors: {}, icons: {} });
	assert.deepEqual(JSON.parse(readFileSync(join(dir, "a.json"), "utf8")), { colors: {}, icons: {} });
	store.saveTheme("b", { colors: { base: "dim" }, icons: {} });
	assert.deepEqual(JSON.parse(readFileSync(join(dir, "b.json"), "utf8")), { colors: { base: "dim" }, icons: {} });
});

test("saveTheme refuses to overwrite without the flag and honors it with", () => {
	const { store, dir } = makeStore();
	store.saveTheme("a", { colors: { separator: "dim" }, icons: {} });
	assert.deepEqual(store.saveTheme("a", { colors: { base: "muted" }, icons: {} }), { ok: false, reason: "exists" });
	assert.deepEqual(JSON.parse(readFileSync(join(dir, "a.json"), "utf8")), { colors: { separator: "dim" }, icons: {} });
	assert.deepEqual(store.saveTheme("a", { colors: { base: "muted" }, icons: {} }, { overwrite: true }), { ok: true });
	assert.deepEqual(JSON.parse(readFileSync(join(dir, "a.json"), "utf8")), { colors: { base: "muted" }, icons: {} });
});

test("saveTheme rejects invalid names (empty, symbols, path separators, dots)", () => {
	const { store, dir } = makeStore();
	assert.deepEqual(store.saveTheme("", { colors: {}, icons: {} }), { ok: false, reason: "invalid name" });
	assert.deepEqual(store.saveTheme("!!!", { colors: {}, icons: {} }), { ok: false, reason: "invalid name" });
	assert.deepEqual(store.saveTheme("a/b", { colors: {}, icons: {} }), { ok: false, reason: "invalid name" });
	assert.deepEqual(store.saveTheme("..", { colors: {}, icons: {} }), { ok: false, reason: "invalid name" });
	assert.equal(existsSync(dir), false);
});

test("saveTheme write failure degrades to {ok: false, reason: write failed}", () => {
	const { store } = makeStore({
		fs: {
			writeFileSync: () => {
				throw new Error("ENOSPC");
			},
		},
	});
	assert.deepEqual(store.saveTheme("a", { colors: {}, icons: {} }), { ok: false, reason: "write failed" });
});

test("themeExists reflects the file system and is defensive", () => {
	const { store } = makeStore();
	assert.equal(store.themeExists("a"), false);
	store.saveTheme("a", { colors: {}, icons: {} });
	assert.equal(store.themeExists("a"), true);
	assert.equal(store.themeExists(""), false);
	assert.equal(store.themeExists("a/b"), false);
	assert.equal(store.themeExists(".."), false);
});

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

test("loadTheme reads both maps and filters junk entries per-role", () => {
	const { store, dir } = makeStore();
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "a.json"),
		JSON.stringify({
			colors: { separator: "banana", chip: { bogus: true }, base: 208, unknown: "x" },
			icons: { model: "⚡", branch: "none", cost: 42, bogus: true },
		}),
	);
	// "banana" is a string, kept as written (resolve-time filtering); objects
	// and unknown roles are dropped, mirroring state.ts's philosophy. Numbers
	// are junk for icons.
	const result = store.loadTheme("a");
	assert.equal(result.ok, true);
	if (result.ok) {
		// type-level: colors and icons are guaranteed on success (union)
		const colors: Partial<Record<ColorRole, string | number>> = result.colors;
		const icons: Partial<Record<IconRole, string>> = result.icons;
		assert.deepEqual(colors, { separator: "banana", base: 208 });
		assert.deepEqual(icons, { model: "⚡", branch: "none" });
	}
});

test("loadTheme: a colors-only wrapper is valid (icons default to empty)", () => {
	const { store, dir } = makeStore();
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "colors-only.json"), JSON.stringify({ colors: { base: "dim" } }));
	assert.deepEqual(store.loadTheme("colors-only"), { ok: true, colors: { base: "dim" }, icons: {} });
});

test("loadTheme: an icons-only wrapper is valid (colors default to empty)", () => {
	const { store, dir } = makeStore();
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "icons-only.json"), JSON.stringify({ icons: { model: "none" } }));
	assert.deepEqual(store.loadTheme("icons-only"), { ok: true, colors: {}, icons: { model: "none" } });
});

test("loadTheme: both keys empty is a valid (all-auto) theme", () => {
	const { store, dir } = makeStore();
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "empty.json"), JSON.stringify({ colors: {}, icons: {} }));
	assert.deepEqual(store.loadTheme("empty"), { ok: true, colors: {}, icons: {} });
});

test("loadTheme: a flat legacy colors-only file (no wrapper) is malformed", () => {
	const { store, dir } = makeStore();
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "legacy.json"), JSON.stringify({ separator: "dim", base: 208 }));
	assert.deepEqual(store.loadTheme("legacy"), { ok: false, reason: "malformed" });
	// and so is an object with neither key
	writeFileSync(join(dir, "hollow.json"), "{}");
	assert.deepEqual(store.loadTheme("hollow"), { ok: false, reason: "malformed" });
});

test("loadTheme: non-object colors/icons keys are malformed", () => {
	const { store, dir } = makeStore();
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "bad1.json"), JSON.stringify({ colors: "dim", icons: {} }));
	writeFileSync(join(dir, "bad2.json"), JSON.stringify({ colors: {}, icons: [1, 2] }));
	writeFileSync(join(dir, "bad3.json"), JSON.stringify({ colors: 42 }));
	for (const name of ["bad1", "bad2", "bad3"]) {
		assert.deepEqual(store.loadTheme(name), { ok: false, reason: "malformed" });
	}
});

test("loadTheme: unparseable JSON or a non-object is malformed", () => {
	const { store, dir } = makeStore();
	mkdirSync(dir, { recursive: true });
	for (const [name, contents] of [
		["bad1", "not json"],
		["bad2", "[1, 2]"],
		["bad3", "42"],
		["bad4", "null"],
		["bad5", '"just a string"'],
	] as const) {
		writeFileSync(join(dir, `${name}.json`), contents);
		assert.deepEqual(store.loadTheme(name), { ok: false, reason: "malformed" });
	}
});

test("loadTheme: missing theme or invalid name fails without throwing", () => {
	const { store } = makeStore();
	assert.deepEqual(store.loadTheme("missing"), { ok: false, reason: "not found" });
	assert.deepEqual(store.loadTheme(""), { ok: false, reason: "invalid name" });
	assert.deepEqual(store.loadTheme("a/b"), { ok: false, reason: "invalid name" });
});

test("loadTheme: read failure degrades to not found", () => {
	const { store } = makeStore({
		fs: {
			readFileSync: () => {
				throw new Error("EACCES");
			},
		},
	});
	assert.deepEqual(store.loadTheme("a"), { ok: false, reason: "not found" });
});
