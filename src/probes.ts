import { readFileSync } from "node:fs";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";

/**
 * Non-render environment probes. All reads are read-only and defensive:
 * missing or malformed settings files fall back to defaults, and no probe
 * throws (each is wrapped so render paths stay safe).
 */

// ---------------------------------------------------------------------------
// Auto-compaction enabled (compaction.enabled from user + project settings).
// Project settings win; default true; cached per cwd, refreshed on agent_settled.
// ---------------------------------------------------------------------------

let autoCompactCache: { cwd: string; value: boolean } | null = null;

/** Read and parse a settings file. Returns the parsed JSON document, or undefined when missing or malformed. */
export function readSettingsJson(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return undefined;
	}
}

function readBoolPath(obj: unknown, path: string[]): boolean | undefined {
	let current: unknown = obj;
	for (const key of path) {
		if (typeof current !== "object" || current === null) return undefined;
		current = (current as Record<string, unknown>)[key];
	}
	return typeof current === "boolean" ? current : undefined;
}

/**
 * Resolve compaction.enabled from parsed global + project settings:
 * project wins, then global, then the default (true).
 */
export function compactionEnabledFrom(globalSettings: unknown, projectSettings: unknown): boolean {
	const globalValue = readBoolPath(globalSettings, ["compaction", "enabled"]);
	const projectValue = readBoolPath(projectSettings, ["compaction", "enabled"]);
	return projectValue ?? globalValue ?? true;
}

/** Read compaction.enabled from the given settings file paths. */
export function readCompactionEnabled(globalSettingsPath: string, projectSettingsPath: string): boolean {
	return compactionEnabledFrom(readSettingsJson(globalSettingsPath), readSettingsJson(projectSettingsPath));
}

/** Whether auto-compaction is enabled (project wins, default true). Cached per cwd. */
export function isAutoCompactEnabled(cwd: string): boolean {
	if (autoCompactCache && autoCompactCache.cwd === cwd) return autoCompactCache.value;
	const value = readCompactionEnabled(join(getAgentDir(), "settings.json"), join(cwd, CONFIG_DIR_NAME, "settings.json"));
	autoCompactCache = { cwd, value };
	return value;
}

/** Re-read the auto-compaction setting for a cwd (called on agent_settled). */
export function refreshAutoCompactEnabled(cwd: string): boolean {
	autoCompactCache = null;
	return isAutoCompactEnabled(cwd);
}

// ---------------------------------------------------------------------------
// Experimental mode — the exact check pi's own footer makes.
// ---------------------------------------------------------------------------

export function isExperimentalMode(): boolean {
	return process.env.PI_EXPERIMENTAL === "1";
}

// ---------------------------------------------------------------------------
// Subscription-backed provider detection (best-effort).
// ---------------------------------------------------------------------------

export interface SubscriptionProviderLike {
	auth?: { oauth?: { isSubscription?: boolean } };
}

export interface ModelRegistryLike {
	getProvider(id: string): SubscriptionProviderLike | undefined;
	isUsingOAuth?(model: { provider: string }): boolean;
}

export interface SubscriptionProbeContext {
	model?: { provider: string } | null;
	modelRegistry: ModelRegistryLike;
}

const subscriptionCache = new Map<string, boolean>();

/**
 * Best-effort detection of subscription billing: the provider declares its
 * OAuth auth as subscription-backed and (when a model is active) the model
 * actually authenticates via OAuth. Unknown results fall back to false so the
 * cost display is used instead. The negative result is cached per provider.
 */
export function isSubscriptionProvider(providerId: string | undefined, ctx: SubscriptionProbeContext): boolean {
	if (!providerId) return false;
	const cached = subscriptionCache.get(providerId);
	if (cached !== undefined) return cached;
	const provider = ctx.modelRegistry.getProvider(providerId);
	if (provider?.auth?.oauth?.isSubscription !== true) {
		subscriptionCache.set(providerId, false);
		return false;
	}
	if (ctx.model && ctx.modelRegistry.isUsingOAuth?.(ctx.model) === false) {
		subscriptionCache.set(providerId, false);
		return false;
	}
	return true;
}
