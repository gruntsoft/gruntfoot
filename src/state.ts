import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { COLOR_ROLES, type ColorRole } from "./colors.ts";
import { ICON_ROLES, type IconRole } from "./icons.ts";

/**
 * Persisted /gruntfoot state for gruntfoot, stored in
 * `~/.pi/agent/gruntfoot/settings.json` as
 * `{"enabled": <boolean>, "colors": {<role>: <value>}, "icons": {<role>: <glyph>}}`
 * — global across projects and pi restarts.
 *
 * Defaults to OFF with no colors/icons when the file is missing; the file is
 * created only on the first change (never proactively). Writes are guarded by
 * a proper-lockfile lock (mirroring pi's FileSettingsStorage: 10 attempts ×
 * 20ms, sync) and are merge-preserving: unknown top-level keys in the file
 * survive, and so do unknown keys inside `colors`/`icons` — except
 * `applyTheme` (theme load), which replaces both maps wholesale. A malformed
 * file flips `hadMalformedFile` and disables persistence for the rest of the
 * session — the file is never overwritten by gruntfoot code. Junk values
 * inside a well-formed file (e.g. `"separator": "banana"`) do NOT count as
 * malformed: they are ignored per-role (fall back to auto; numbers are junk
 * for icons) and persistence keeps working. No path in here throws: every
 * fs/lock failure degrades to in-memory state.
 */

/** Options controlling how `colors`/`icons` are written (see {@link persist}). */
interface PersistOptions {
	/** Remove the `colors` key entirely (color-reset). */
	dropColors?: boolean;
	/** Write the in-memory colors map as-is instead of merging (theme load). */
	replaceColors?: boolean;
	/** Remove the `icons` key entirely (icon-reset). */
	dropIcons?: boolean;
	/** Write the in-memory icons map as-is instead of merging (theme load). */
	replaceIcons?: boolean;
}

/** Injectable fs + lock hooks so tests can run without pi or real locks. */
export interface UiStateFileSystem {
	readFileSync(path: string): string;
	writeFileSync(path: string, contents: string): void;
	existsSync(path: string): boolean;
	mkdirSync(path: string, options: { recursive: true }): void;
	/** Acquire an exclusive lock on `path`; returns the release function. Throws on failure. */
	lockSync(path: string): () => void;
}

export interface UiStateOptions {
	/** State file path. Defaults to `<agentDir>/gruntfoot/settings.json`. */
	path?: string;
	/** fs + lock hooks (for tests). Defaults to node:fs + proper-lockfile. */
	fs?: UiStateFileSystem;
}

export interface UiState {
	/** True when the state file exists but could not be parsed as `{enabled: boolean}`. */
	readonly hadMalformedFile: boolean;
	/** Whether the custom UI is currently enabled (lazy-reads the file once). */
	isEnabled(): boolean;
	/**
	 * Toggle the custom UI and persist the new state. Never throws: fs/lock
	 * failures degrade to in-memory state with `persisted: false`.
	 */
	toggle(): { enabled: boolean; persisted: boolean };
	/**
	 * Currently configured color values (role → value as written), junk
	 * entries filtered out per-role. Empty when nothing is set.
	 */
	getColors(): Partial<Record<ColorRole, string | number>>;
	/** Set one role's color value and persist. Returns `persisted: false` on failure. */
	setColor(role: ColorRole, value: string): { persisted: boolean };
	/** Remove the `colors` key entirely (merge-preserving) and reset in-memory state. */
	resetColors(): { persisted: boolean };
	/**
	 * Currently configured icon values (role → glyph as written), junk entries
	 * filtered out per-role. Empty when nothing is set.
	 */
	getIcons(): Partial<Record<IconRole, string>>;
	/** Set one role's icon value and persist. Returns `persisted: false` on failure. */
	setIcon(role: IconRole, value: string): { persisted: boolean };
	/** Remove the `icons` key entirely (merge-preserving) and reset in-memory state. */
	resetIcons(): { persisted: boolean };
	/**
	 * Replace the entire colors + icons maps (theme load) in one lock-guarded
	 * write: in-memory state is set wholesale and the file's keys are written
	 * as-is — unknown keys inside either map are dropped, unknown top-level
	 * keys survive. An empty map drops its key. Returns `persisted: false`
	 * on failure.
	 */
	applyTheme(
		colors: Partial<Record<ColorRole, string | number>>,
		icons: Partial<Record<IconRole, string>>,
	): { persisted: boolean };
}

const LOCK_RETRY_ATTEMPTS = 10;
const LOCK_RETRY_DELAY_MS = 20;

const defaultFs: UiStateFileSystem = {
	readFileSync: (path) => readFileSync(path, "utf8"),
	writeFileSync,
	existsSync,
	mkdirSync,
	lockSync: (path) => lockfile.lockSync(path, { realpath: false }),
};

interface ParsedStateFile {
	enabled: boolean;
	/** Raw `colors` object from the file, or undefined when absent/not an object. */
	colors: Record<string, unknown> | undefined;
	/** Raw `icons` object from the file, or undefined when absent/not an object. */
	icons: Record<string, unknown> | undefined;
	/** Full parsed document — unknown top-level keys must survive writes. */
	document: Record<string, unknown>;
}

/** Parse the state file. Returns undefined when missing/malformed/wrong shape. */
function parseStateFile(raw: string): ParsedStateFile | undefined {
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			typeof (parsed as Record<string, unknown>).enabled === "boolean"
		) {
			const document = parsed as Record<string, unknown>;
			const colors = document.colors;
			const icons = document.icons;
			return {
				enabled: document.enabled as boolean,
				colors: typeof colors === "object" && colors !== null ? (colors as Record<string, unknown>) : undefined,
				icons: typeof icons === "object" && icons !== null ? (icons as Record<string, unknown>) : undefined,
				document,
			};
		}
	} catch {
		// fall through
	}
	return undefined;
}

/** Keep only known roles with string/number values; junk entries are ignored per-role. */
export function filterKnownColors(raw: Record<string, unknown> | undefined): Partial<Record<ColorRole, string | number>> {
	const result: Partial<Record<ColorRole, string | number>> = {};
	if (!raw) return result;
	for (const role of COLOR_ROLES) {
		const value = raw[role];
		if (typeof value === "string" || typeof value === "number") {
			result[role] = value;
		}
	}
	return result;
}

/**
 * Keep only known icon roles with string values; junk entries (numbers
 * included — icons are strings only) are ignored per-role.
 */
export function filterKnownIcons(raw: Record<string, unknown> | undefined): Partial<Record<IconRole, string>> {
	const result: Partial<Record<IconRole, string>> = {};
	if (!raw) return result;
	for (const role of ICON_ROLES) {
		const value = raw[role];
		if (typeof value === "string") {
			result[role] = value;
		}
	}
	return result;
}

export function createUiState(options: UiStateOptions = {}): UiState {
	const path = options.path ?? join(getAgentDir(), "gruntfoot", "settings.json");
	const fs = options.fs ?? defaultFs;

	let enabled = false;
	let colors: Partial<Record<ColorRole, string | number>> = {};
	let icons: Partial<Record<IconRole, string>> = {};
	let hadMalformedFile = false;
	let loaded = false;

	/** Read the file once, lazily, on first access. */
	function load(): void {
		if (loaded) return;
		loaded = true;
		let raw: string;
		try {
			raw = fs.readFileSync(path);
		} catch {
			return; // missing/unreadable ⇒ default off, no colors, nothing persisted
		}
		const parsed = parseStateFile(raw);
		if (parsed === undefined) {
			hadMalformedFile = true;
		} else {
			enabled = parsed.enabled;
			colors = filterKnownColors(parsed.colors);
			icons = filterKnownIcons(parsed.icons);
		}
	}

	/** Sync busy-wait, keeping the lock retry loop synchronous (pi's pattern). */
	function sleepSync(ms: number): void {
		const start = Date.now();
		while (Date.now() - start < ms) {
			// no-op
		}
	}

	/** proper-lockfile lock with pi's retry loop; rethrows on final failure. */
	function lockSyncWithRetry(target: string): () => void {
		let lastError: unknown;
		for (let attempt = 1; attempt <= LOCK_RETRY_ATTEMPTS; attempt++) {
			try {
				return fs.lockSync(target);
			} catch (error) {
				const code = (error as { code?: string } | null)?.code;
				if (code !== "ELOCKED" || attempt === LOCK_RETRY_ATTEMPTS) {
					throw error;
				}
				lastError = error;
				sleepSync(LOCK_RETRY_DELAY_MS);
			}
		}
		throw lastError ?? new Error("Failed to acquire lock");
	}

	/**
	 * Lock-guarded write of `{"enabled": ..., "colors": ..., "icons": ...}`.
	 * The lock is acquired before the existence check so the check, fresh read,
	 * merge, and write all happen under it: a file created by another process
	 * in between is merged into rather than clobbered, and a malformed one is
	 * never overwritten. The parent dir is created first — proper-lockfile
	 * places the `.lock` file next to the target. `dropColors`/`dropIcons`
	 * remove the respective key entirely (color-reset / icon-reset).
	 * `replaceColors`/`replaceIcons` write the in-memory maps as-is (theme
	 * load): unknown keys inside the maps are dropped, and an empty map removes
	 * its key. Default (merge) writes merge the fresh file map under the
	 * in-memory one; unknown keys inside `colors`/`icons` survive every
	 * merge-preserving write path.
	 */
	function persist(options: PersistOptions = {}): boolean {
		let release: (() => void) | undefined;
		try {
			const dir = dirname(path);
			if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
			release = lockSyncWithRetry(path);
			const fileExists = fs.existsSync(path);
			const current = fileExists ? parseStateFile(fs.readFileSync(path)) : undefined;
			if (fileExists && current === undefined) {
				// Fresh read shows a malformed file — user's data, their call to fix.
				hadMalformedFile = true;
				return false;
			}
			const next: Record<string, unknown> = { ...(current?.document ?? {}), enabled };
			if (options.dropColors) {
				delete next.colors;
			} else if (options.replaceColors) {
				// Replacing (theme load): the in-memory map replaces the file's.
				if (Object.keys(colors).length > 0) {
					next.colors = { ...colors };
				} else {
					delete next.colors;
				}
			} else {
				// Merge fresh file colors under in-memory colors; unknown keys inside
				// `colors` survive every merge-preserving write path.
				const merged = { ...(current?.colors ?? {}), ...colors };
				if (Object.keys(merged).length > 0) {
					next.colors = merged;
				}
			}
			if (options.dropIcons) {
				delete next.icons;
			} else if (options.replaceIcons) {
				if (Object.keys(icons).length > 0) {
					next.icons = { ...icons };
				} else {
					delete next.icons;
				}
			} else {
				const mergedIcons = { ...(current?.icons ?? {}), ...icons };
				if (Object.keys(mergedIcons).length > 0) {
					next.icons = mergedIcons;
				}
			}
			fs.writeFileSync(path, JSON.stringify(next, null, 2));
			return true;
		} catch {
			return false;
		} finally {
			release?.();
		}
	}

	function toggle(): { enabled: boolean; persisted: boolean } {
		load();
		enabled = !enabled;
		if (hadMalformedFile) return { enabled, persisted: false };
		return { enabled, persisted: persist() };
	}

	function setColor(role: ColorRole, value: string): { persisted: boolean } {
		load();
		colors = { ...colors, [role]: value };
		if (hadMalformedFile) return { persisted: false };
		return { persisted: persist() };
	}

	function resetColors(): { persisted: boolean } {
		load();
		colors = {};
		if (hadMalformedFile) return { persisted: false };
		return { persisted: persist({ dropColors: true }) };
	}

	function setIcon(role: IconRole, value: string): { persisted: boolean } {
		load();
		icons = { ...icons, [role]: value };
		if (hadMalformedFile) return { persisted: false };
		return { persisted: persist() };
	}

	function resetIcons(): { persisted: boolean } {
		load();
		icons = {};
		if (hadMalformedFile) return { persisted: false };
		return { persisted: persist({ dropIcons: true }) };
	}

	function applyTheme(
		incomingColors: Partial<Record<ColorRole, string | number>>,
		incomingIcons: Partial<Record<IconRole, string>>,
	): { persisted: boolean } {
		load();
		colors = { ...incomingColors };
		icons = { ...incomingIcons };
		if (hadMalformedFile) return { persisted: false };
		return { persisted: persist({ replaceColors: true, replaceIcons: true }) };
	}

	return {
		get hadMalformedFile(): boolean {
			load();
			return hadMalformedFile;
		},
		isEnabled(): boolean {
			load();
			return enabled;
		},
		getColors(): Partial<Record<ColorRole, string | number>> {
			load();
			return colors;
		},
		toggle,
		setColor,
		resetColors,
		getIcons(): Partial<Record<IconRole, string>> {
			load();
			return icons;
		},
		setIcon,
		resetIcons,
		applyTheme,
	};
}
