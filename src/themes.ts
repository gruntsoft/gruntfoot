import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ColorRole } from "./colors.ts";
import type { IconRole } from "./icons.ts";
import { filterKnownColors, filterKnownIcons } from "./state.ts";

/**
 * Named themes for gruntfoot, one file per theme in
 * `~/.pi/agent/gruntfoot/themes/<name>.json`. The file content is a wrapper
 * object `{"colors": {...}, "icons": {...}}` — save always writes both keys
 * (even when empty, so the format stays explicit); load replaces both maps
 * wholesale. Both keys are optional individually, but a file with neither
 * key (e.g. a flat legacy colors-only file) is malformed. This shape is
 * deliberately strict and NOT backward compatible with the pre-0.5 flat
 * colors-only files.
 *
 * Names are normalized (`Neon Pi` → `neon-pi`) via `normalizeThemeName`.
 * Save refuses to overwrite an existing theme unless explicitly asked; load
 * refuses malformed files (unparseable JSON, a non-object, a non-object
 * `colors`/`icons` key, or neither key present). Junk role values inside a
 * well-formed object do NOT count as malformed — they are filtered per-role
 * (strings/numbers for colors, strings only for icons), mirroring state.ts's
 * philosophy. The themes dir is created only on the first save, like the
 * settings file. No path in here throws: every fs failure degrades to an
 * empty list or `{ok: false}`.
 */

/** Injectable fs hooks so tests can run without touching the real agent dir. */
export interface ThemeFileSystem {
	readFileSync(path: string): string;
	writeFileSync(path: string, contents: string): void;
	existsSync(path: string): boolean;
	mkdirSync(path: string, options: { recursive: true }): void;
	readdirSync(path: string): string[];
}

export interface ThemeStoreOptions {
	/** Themes directory. Defaults to `<agentDir>/gruntfoot/themes/`. */
	dir?: string;
	/** fs hooks (for tests). Defaults to node:fs. */
	fs?: ThemeFileSystem;
}

export interface ThemeStore {
	/** Normalize a user-supplied theme name; "" means invalid (normalizes to nothing). */
	normalizeThemeName(input: string): string;
	/**
	 * `<basename>.json` entries in the themes dir minus the suffix, sorted.
	 * Skips dotfiles and non-`.json` entries; a missing/unreadable dir lists
	 * as empty. Never throws.
	 */
	listThemeNames(): string[];
	/** True when `<name>.json` exists. Defensive: false on invalid names or fs errors. */
	themeExists(name: string): boolean;
	/**
	 * Write the current colors + icons as `{"colors": …, "icons": …}` to
	 * `<name>.json`, creating the themes dir on the first save. Both keys are
	 * always written (even when empty — explicit format). Refuses to overwrite
	 * an existing file unless `options.overwrite` is set.
	 */
	saveTheme(
		name: string,
		theme: { colors: Partial<Record<ColorRole, string | number>>; icons: Partial<Record<IconRole, string>> },
		options?: { overwrite?: boolean },
	): { ok: boolean; reason?: string };
	/**
	 * Read `<name>.json` and filter both maps per-role (colors: non-string/
	 * number entries dropped; icons: non-string entries dropped). Malformed
	 * (unparseable JSON, a non-object, a non-object `colors`/`icons` key, or
	 * neither key present — e.g. a flat legacy colors-only file) →
	 * `{ok: false, reason: "malformed"}`; missing → `{ok: false,
	 * reason: "not found"}`. A discriminated union: `colors` and `icons` are
	 * always present on success.
	 */
	loadTheme(name: string): LoadThemeResult;
}

/** Result of {@link ThemeStore.loadTheme}: colors + icons on success, a reason on failure. */
export type LoadThemeResult =
	| {
			ok: true;
			colors: Partial<Record<ColorRole, string | number>>;
			icons: Partial<Record<IconRole, string>>;
	  }
	| { ok: false; reason: "invalid name" | "not found" | "malformed" };

const defaultFs: ThemeFileSystem = {
	readFileSync: (path) => readFileSync(path, "utf8"),
	writeFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
};

/** Normalized names are lowercase alphanumerics and dashes only — never empty, no leading/trailing dash. */
const SAFE_NAME_RE = /^[a-z0-9-]+$/;

/**
 * Normalize a theme name: lowercase, replace every run of non-alphanumeric
 * characters with a single dash, trim/collapse leading and trailing dashes.
 * Returns "" for names that normalize to nothing (e.g. `!!!`).
 */
export function normalizeThemeName(input: string): string {
	const lower = input.toLowerCase();
	const dashed = lower.replace(/[^a-z0-9]+/g, "-");
	return dashed.replace(/^-+|-+$/g, "");
}

/** Guard against empty, path-escaping, or dot-prefixed names (callers pass normalized names). */
function isSafeName(name: string): boolean {
	return name !== "" && SAFE_NAME_RE.test(name);
}

/** A JSON value that is an object but not an array (the only map shape we accept). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createThemeStore(options: ThemeStoreOptions = {}): ThemeStore {
	const dir = options.dir ?? join(getAgentDir(), "gruntfoot", "themes");
	const fs = options.fs ?? defaultFs;

	function listThemeNames(): string[] {
		let entries: string[];
		try {
			entries = fs.readdirSync(dir);
		} catch {
			return [];
		}
		const names: string[] = [];
		for (const entry of entries) {
			if (entry.startsWith(".")) continue;
			if (!entry.endsWith(".json")) continue;
			names.push(entry.slice(0, -".json".length));
		}
		names.sort();
		return names;
	}

	function themeExists(name: string): boolean {
		if (!isSafeName(name)) return false;
		try {
			return fs.existsSync(join(dir, `${name}.json`));
		} catch {
			return false;
		}
	}

	function saveTheme(
		name: string,
		theme: { colors: Partial<Record<ColorRole, string | number>>; icons: Partial<Record<IconRole, string>> },
		options: { overwrite?: boolean } = {},
	): { ok: boolean; reason?: string } {
		if (!isSafeName(name)) return { ok: false, reason: "invalid name" };
		try {
			if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
			const file = join(dir, `${name}.json`);
			if (fs.existsSync(file) && !options.overwrite) return { ok: false, reason: "exists" };
			// Always write both keys — even when empty — so the format stays explicit.
			fs.writeFileSync(file, JSON.stringify({ colors: theme.colors, icons: theme.icons }, null, 2));
			return { ok: true };
		} catch {
			return { ok: false, reason: "write failed" };
		}
	}

	function loadTheme(name: string): LoadThemeResult {
		if (!isSafeName(name)) return { ok: false, reason: "invalid name" };
		let raw: string;
		try {
			raw = fs.readFileSync(join(dir, `${name}.json`));
		} catch {
			return { ok: false, reason: "not found" };
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			return { ok: false, reason: "malformed" };
		}
		if (!isPlainObject(parsed)) {
			return { ok: false, reason: "malformed" };
		}
		// Strict wrapper shape: both keys optional individually, at least one
		// required — a flat legacy colors-only file must not silently load as
		// "reset everything".
		const hasColors = "colors" in parsed;
		const hasIcons = "icons" in parsed;
		if (!hasColors && !hasIcons) return { ok: false, reason: "malformed" };
		if (hasColors && !isPlainObject(parsed.colors)) return { ok: false, reason: "malformed" };
		if (hasIcons && !isPlainObject(parsed.icons)) return { ok: false, reason: "malformed" };
		return {
			ok: true,
			colors: filterKnownColors(parsed.colors as Record<string, unknown> | undefined),
			icons: filterKnownIcons(parsed.icons as Record<string, unknown> | undefined),
		};
	}

	return {
		normalizeThemeName,
		listThemeNames,
		themeExists,
		saveTheme,
		loadTheme,
	};
}
