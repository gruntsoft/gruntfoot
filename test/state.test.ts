import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createUiState, type UiStateFileSystem } from "../src/state.ts";

let counter = 0;

/** Fresh sandbox dir per test. */
function setup(): string {
	const dir = join(tmpdir(), `gruntfoot-state-${process.pid}-${counter++}`);
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	return dir;
}

/** Real node fs against the sandbox; lock is a no-op success unless overridden. */
function makeFs(overrides: Partial<UiStateFileSystem> = {}): UiStateFileSystem {
	return {
		readFileSync: (path) => readFileSync(path, "utf8"),
		writeFileSync,
		existsSync,
		mkdirSync,
		lockSync: () => () => {},
		...overrides,
	};
}

test("missing file defaults to off and is never created proactively", () => {
	const file = join(setup(), "gruntfoot.json");
	const state = createUiState({ path: file, fs: makeFs() });

	assert.equal(state.isEnabled(), false);
	assert.equal(state.hadMalformedFile, false);
	assert.equal(existsSync(file), false);
});

test("reads enabled: true/false from the file", () => {
	const file = join(setup(), "gruntfoot.json");

	writeFileSync(file, JSON.stringify({ enabled: true }));
	assert.equal(createUiState({ path: file, fs: makeFs() }).isEnabled(), true);

	writeFileSync(file, JSON.stringify({ enabled: false }));
	assert.equal(createUiState({ path: file, fs: makeFs() }).isEnabled(), false);
});

test("first toggle creates the file with enabled: true, parent dirs included", () => {
	const file = join(setup(), "deep", "nested", "gruntfoot.json");
	const state = createUiState({ path: file, fs: makeFs() });

	assert.deepEqual(state.toggle(), { enabled: true, persisted: true });
	assert.equal(state.isEnabled(), true);
	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { enabled: true });
});

test("second toggle writes enabled: false", () => {
	const file = join(setup(), "gruntfoot.json");
	const state = createUiState({ path: file, fs: makeFs() });

	state.toggle();
	assert.deepEqual(state.toggle(), { enabled: false, persisted: true });
	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { enabled: false });
});

test("malformed file: in-memory default off, file untouched, persistence disabled", () => {
	const file = join(setup(), "gruntfoot.json");
	writeFileSync(file, "not json");
	const state = createUiState({ path: file, fs: makeFs() });

	assert.equal(state.isEnabled(), false);
	assert.equal(state.hadMalformedFile, true);

	// toggle flips in-memory state but never writes
	assert.deepEqual(state.toggle(), { enabled: true, persisted: false });
	assert.equal(state.isEnabled(), true);
	assert.deepEqual(state.toggle(), { enabled: false, persisted: false });
	assert.equal(readFileSync(file, "utf8"), "not json");
});

test("valid JSON without a boolean enabled key counts as malformed", () => {
	const file = join(setup(), "gruntfoot.json");
	for (const contents of ["{}", '{"enabled": "yes"}', "[1, 2]", '"hi"']) {
		writeFileSync(file, contents);
		const state = createUiState({ path: file, fs: makeFs() });
		assert.equal(state.isEnabled(), false);
		assert.equal(state.hadMalformedFile, true);
		assert.equal(state.toggle().persisted, false);
		assert.equal(readFileSync(file, "utf8"), contents);
	}
});

test("unknown top-level keys survive a toggle (merge-preserving write)", () => {
	const file = join(setup(), "gruntfoot.json");
	writeFileSync(file, JSON.stringify({ enabled: true, custom: { keep: 1 }, other: "x" }));
	const state = createUiState({ path: file, fs: makeFs() });

	state.toggle();
	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
		enabled: false,
		custom: { keep: 1 },
		other: "x",
	});
});

test("merge reads the file fresh at toggle time (created after load)", () => {
	const file = join(setup(), "gruntfoot.json");
	const state = createUiState({ path: file, fs: makeFs() });
	assert.equal(state.isEnabled(), false); // file missing at load

	// file appears externally before the toggle
	writeFileSync(file, JSON.stringify({ enabled: false, custom: 1 }));
	state.toggle();

	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { enabled: true, custom: 1 });
});

test("file that becomes malformed after load is never overwritten", () => {
	const file = join(setup(), "gruntfoot.json");
	writeFileSync(file, JSON.stringify({ enabled: true }));
	const state = createUiState({ path: file, fs: makeFs() });
	assert.equal(state.isEnabled(), true);

	writeFileSync(file, "not json"); // externally corrupted
	assert.deepEqual(state.toggle(), { enabled: false, persisted: false });
	assert.equal(state.hadMalformedFile, true);
	assert.equal(readFileSync(file, "utf8"), "not json");
});

test("file created by another process before locking is merged, not overwritten", () => {
	const file = join(setup(), "gruntfoot.json");
	const fs = makeFs({
		lockSync: () => {
			// Another process wins the race and creates the file with unknown keys.
			writeFileSync(file, JSON.stringify({ enabled: false, custom: 1 }));
			return () => {};
		},
	});
	const state = createUiState({ path: file, fs });
	assert.equal(state.isEnabled(), false); // missing at load

	state.toggle();
	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { enabled: true, custom: 1 });
});

test("file created malformed by another process before locking is never overwritten", () => {
	const file = join(setup(), "gruntfoot.json");
	const fs = makeFs({
		lockSync: () => {
			writeFileSync(file, "not json");
			return () => {};
		},
	});
	const state = createUiState({ path: file, fs });

	assert.deepEqual(state.toggle(), { enabled: true, persisted: false });
	assert.equal(state.hadMalformedFile, true);
	assert.equal(readFileSync(file, "utf8"), "not json");
});

test("lock failure degrades to in-memory state without writing", () => {
	const file = join(setup(), "gruntfoot.json");
	const state = createUiState({
		path: file,
		fs: makeFs({
			lockSync: () => {
				throw Object.assign(new Error("lock unavailable"), { code: "ENOENT" });
			},
		}),
	});

	assert.deepEqual(state.toggle(), { enabled: true, persisted: false });
	assert.equal(state.isEnabled(), true);
	assert.equal(state.hadMalformedFile, false);
	assert.equal(existsSync(file), false);
});

test("release is called after a successful locked write", () => {
	const file = join(setup(), "gruntfoot.json");
	let released = false;
	const fs = makeFs({
		lockSync: () => () => {
			released = true;
		},
	});
	const state = createUiState({ path: file, fs });

	state.toggle();
	assert.equal(released, true);
	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { enabled: true });
});

// ---------------------------------------------------------------------------
// Colors map
// ---------------------------------------------------------------------------

test("missing file: no colors, and setColor creates the file with both keys", () => {
	const file = join(setup(), "gruntfoot", "settings.json");
	const state = createUiState({ path: file, fs: makeFs() });

	assert.deepEqual(state.getColors(), {});
	assert.deepEqual(state.setColor("separator", "dim"), { persisted: true });
	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { enabled: false, colors: { separator: "dim" } });
});

test("colors are read from the file, junk entries filtered per-role", () => {
	const file = join(setup(), "settings.json");
	writeFileSync(
		file,
		JSON.stringify({
			enabled: true,
			colors: { separator: "dim", "context-high": "#ff0000", base: 208, chip: { bogus: true }, unknown: "x" },
		}),
	);
	const state = createUiState({ path: file, fs: makeFs() });

	assert.deepEqual(state.getColors(), { separator: "dim", "context-high": "#ff0000", base: 208 });
	assert.equal(state.isEnabled(), true);
	assert.equal(state.hadMalformedFile, false);
});

test("junk color values do not disable persistence", () => {
	const file = join(setup(), "settings.json");
	writeFileSync(file, JSON.stringify({ enabled: false, colors: { separator: "banana" } }));
	const state = createUiState({ path: file, fs: makeFs() });

	// "banana" is kept as written; format validation happens at resolve time.
	assert.deepEqual(state.getColors(), { separator: "banana" });
	assert.deepEqual(state.toggle(), { enabled: true, persisted: true });
	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { enabled: true, colors: { separator: "banana" } });
});

test("setColor merges with the file: unknown top-level and colors keys survive", () => {
	const file = join(setup(), "settings.json");
	writeFileSync(
		file,
		JSON.stringify({ enabled: true, custom: 1, colors: { separator: "dim", future: "keep" } }),
	);
	const state = createUiState({ path: file, fs: makeFs() });

	state.setColor("model", "accent");
	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
		enabled: true,
		custom: 1,
		colors: { separator: "dim", future: "keep", model: "accent" },
	});
});

test("setColor replaces the same role and persists as written (including auto)", () => {
	const file = join(setup(), "settings.json");
	const state = createUiState({ path: file, fs: makeFs() });

	state.setColor("separator", "#B9D175");
	state.setColor("separator", "auto");
	state.setColor("chip", "208");
	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
		enabled: false,
		colors: { separator: "auto", chip: "208" },
	});
});

test("colors survive a toggle (merge-preserving)", () => {
	const file = join(setup(), "settings.json");
	const state = createUiState({ path: file, fs: makeFs() });

	state.setColor("base", "dim");
	state.toggle();
	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { enabled: true, colors: { base: "dim" } });
});

test("no colors key is written when nothing is set", () => {
	const file = join(setup(), "settings.json");
	const state = createUiState({ path: file, fs: makeFs() });

	state.toggle();
	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { enabled: true });
});

test("resetColors removes only the colors key (enabled and unknown keys survive)", () => {
	const file = join(setup(), "settings.json");
	writeFileSync(file, JSON.stringify({ enabled: true, custom: { keep: 1 }, colors: { separator: "dim" } }));
	const state = createUiState({ path: file, fs: makeFs() });

	assert.deepEqual(state.resetColors(), { persisted: true });
	assert.deepEqual(state.getColors(), {});
	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { enabled: true, custom: { keep: 1 } });
});

test("resetColors with a malformed file: in-memory reset, nothing written", () => {
	const file = join(setup(), "settings.json");
	writeFileSync(file, "not json");
	const state = createUiState({ path: file, fs: makeFs() });

	assert.deepEqual(state.resetColors(), { persisted: false });
	assert.equal(state.hadMalformedFile, true);
	assert.equal(readFileSync(file, "utf8"), "not json");
});

test("setColor with a malformed file keeps in-memory state but does not write", () => {
	const file = join(setup(), "settings.json");
	writeFileSync(file, "not json");
	const state = createUiState({ path: file, fs: makeFs() });

	assert.deepEqual(state.setColor("separator", "dim"), { persisted: false });
	assert.deepEqual(state.getColors(), { separator: "dim" });
	assert.equal(state.hadMalformedFile, true);
	assert.equal(readFileSync(file, "utf8"), "not json");
});

test("resetColors replaces a non-object colors entry with nothing", () => {
	const file = join(setup(), "settings.json");
	writeFileSync(file, JSON.stringify({ enabled: false, colors: "junk-string" }));
	const state = createUiState({ path: file, fs: makeFs() });

	assert.deepEqual(state.getColors(), {});
	assert.deepEqual(state.resetColors(), { persisted: true });
	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { enabled: false });
});

test("setColor replaces a non-object colors entry with a proper map", () => {
	const file = join(setup(), "settings.json");
	writeFileSync(file, JSON.stringify({ enabled: false, colors: "junk-string" }));
	const state = createUiState({ path: file, fs: makeFs() });

	state.setColor("usage", "accent");
	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { enabled: false, colors: { usage: "accent" } });
});

// ---------------------------------------------------------------------------
// Icons map
// ---------------------------------------------------------------------------

test("missing file: no icons, and setIcon creates the file with both keys", () => {
	const file = join(setup(), "gruntfoot", "settings.json");
	const state = createUiState({ path: file, fs: makeFs() });

	assert.deepEqual(state.getIcons(), {});
	assert.deepEqual(state.setIcon("model", "❯"), { persisted: true });
	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { enabled: false, icons: { model: "❯" } });
});

test("icons are read from the file, junk entries filtered per-role (strings only)", () => {
	const file = join(setup(), "settings.json");
	writeFileSync(
		file,
		JSON.stringify({
			enabled: true,
			icons: { model: "⚡", branch: "none", cost: 42, path: { bogus: true }, unknown: "x" },
		}),
	);
	const state = createUiState({ path: file, fs: makeFs() });

	assert.deepEqual(state.getIcons(), { model: "⚡", branch: "none" });
	assert.equal(state.isEnabled(), true);
	assert.equal(state.hadMalformedFile, false);
});

test("setIcon merges with the file: colors, unknown top-level and icons keys survive", () => {
	const file = join(setup(), "settings.json");
	writeFileSync(
		file,
		JSON.stringify({ enabled: true, custom: 1, colors: { separator: "dim" }, icons: { model: "⚡", future: "keep" } }),
	);
	const state = createUiState({ path: file, fs: makeFs() });

	state.setIcon("branch", "none");
	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
		enabled: true,
		custom: 1,
		colors: { separator: "dim" },
		icons: { model: "⚡", future: "keep", branch: "none" },
	});
});

test("setIcon and setColor do not clobber each other", () => {
	const file = join(setup(), "settings.json");
	const state = createUiState({ path: file, fs: makeFs() });

	state.setColor("base", "dim");
	state.setIcon("model", "none");
	state.setIcon("model", "⚡");
	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
		enabled: false,
		colors: { base: "dim" },
		icons: { model: "⚡" },
	});
});

test("no icons key is written when nothing is set", () => {
	const file = join(setup(), "settings.json");
	const state = createUiState({ path: file, fs: makeFs() });

	state.toggle();
	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { enabled: true });
});

test("resetIcons removes only the icons key (enabled, colors, and unknown keys survive)", () => {
	const file = join(setup(), "settings.json");
	writeFileSync(
		file,
		JSON.stringify({ enabled: true, custom: { keep: 1 }, colors: { separator: "dim" }, icons: { model: "⚡" } }),
	);
	const state = createUiState({ path: file, fs: makeFs() });

	assert.deepEqual(state.resetIcons(), { persisted: true });
	assert.deepEqual(state.getIcons(), {});
	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
		enabled: true,
		custom: { keep: 1 },
		colors: { separator: "dim" },
	});
});

test("setIcon with a malformed file keeps in-memory state but does not write", () => {
	const file = join(setup(), "settings.json");
	writeFileSync(file, "not json");
	const state = createUiState({ path: file, fs: makeFs() });

	assert.deepEqual(state.setIcon("model", "⚡"), { persisted: false });
	assert.deepEqual(state.getIcons(), { model: "⚡" });
	assert.equal(state.hadMalformedFile, true);
	assert.equal(readFileSync(file, "utf8"), "not json");
});

test("resetIcons with a malformed file: in-memory reset, nothing written", () => {
	const file = join(setup(), "settings.json");
	writeFileSync(file, "not json");
	const state = createUiState({ path: file, fs: makeFs() });

	assert.deepEqual(state.resetIcons(), { persisted: false });
	assert.deepEqual(state.getIcons(), {});
	assert.equal(state.hadMalformedFile, true);
	assert.equal(readFileSync(file, "utf8"), "not json");
});

test("setIcon replaces a non-object icons entry with a proper map", () => {
	const file = join(setup(), "settings.json");
	writeFileSync(file, JSON.stringify({ enabled: false, icons: "junk-string" }));
	const state = createUiState({ path: file, fs: makeFs() });

	assert.deepEqual(state.getIcons(), {});
	state.setIcon("cost", "none");
	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { enabled: false, icons: { cost: "none" } });
});

// ---------------------------------------------------------------------------
// applyTheme (theme load)
// ---------------------------------------------------------------------------

test("applyTheme replaces both maps wholesale: unknown top-level keys survive, map-internal keys drop", () => {
	const file = join(setup(), "settings.json");
	writeFileSync(
		file,
		JSON.stringify({
			enabled: true,
			custom: 1,
			colors: { separator: "dim", future: "keep" },
			icons: { model: "⚡", future: "keep" },
		}),
	);
	const state = createUiState({ path: file, fs: makeFs() });

	assert.deepEqual(state.applyTheme({ base: "muted" }, { branch: "none" }), { persisted: true });
	assert.deepEqual(state.getColors(), { base: "muted" });
	assert.deepEqual(state.getIcons(), { branch: "none" });
	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
		enabled: true,
		custom: 1,
		colors: { base: "muted" },
		icons: { branch: "none" },
	});
});

test("applyTheme with empty maps clears both keys entirely", () => {
	const file = join(setup(), "settings.json");
	writeFileSync(
		file,
		JSON.stringify({ enabled: true, colors: { separator: "dim" }, icons: { model: "⚡" } }),
	);
	const state = createUiState({ path: file, fs: makeFs() });

	assert.deepEqual(state.applyTheme({}, {}), { persisted: true });
	assert.deepEqual(state.getColors(), {});
	assert.deepEqual(state.getIcons(), {});
	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { enabled: true });
});

test("applyTheme writes one document for both maps (no intermediate states)", () => {
	const file = join(setup(), "settings.json");
	writeFileSync(file, JSON.stringify({ enabled: true, colors: { separator: "dim" } }));
	const writes: string[] = [];
	const state = createUiState({
		path: file,
		fs: makeFs({ writeFileSync: (_path, contents) => writes.push(contents as string) }),
	});

	state.applyTheme({ base: "dim" }, { model: "none" });
	assert.equal(writes.length, 1);
	assert.deepEqual(JSON.parse(writes[0]), { enabled: true, colors: { base: "dim" }, icons: { model: "none" } });
});

test("applyTheme with a malformed settings file keeps in-memory state but does not write", () => {
	const file = join(setup(), "settings.json");
	writeFileSync(file, "not json");
	const state = createUiState({ path: file, fs: makeFs() });

	assert.deepEqual(state.applyTheme({ separator: "dim" }, { model: "⚡" }), { persisted: false });
	assert.deepEqual(state.getColors(), { separator: "dim" });
	assert.deepEqual(state.getIcons(), { model: "⚡" });
	assert.equal(state.hadMalformedFile, true);
	assert.equal(readFileSync(file, "utf8"), "not json");
});

test("applyTheme with a missing file creates it with all keys", () => {
	const file = join(setup(), "settings.json");
	const state = createUiState({ path: file, fs: makeFs() });

	assert.deepEqual(state.applyTheme({ base: "dim" }, {}), { persisted: true });
	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { enabled: false, colors: { base: "dim" } });
});
