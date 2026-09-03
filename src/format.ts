import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Format a token count for compact display, mirroring pi's own footer:
 * 999 -> "999", 1500 -> "1.5k", 12300 -> "12k", 1.5M -> "1.5M", 12M -> "12M".
 */
export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

/** Format a cost in dollars with 4 decimals, e.g. 0.0042 -> "$0.0042". */
export function formatCost(cost: number): string {
	return `$${cost.toFixed(4)}`;
}

/** Format a percentage with 1 decimal, e.g. 33.333 -> "33.3". */
export function formatPercent(percent: number): string {
	return percent.toFixed(1);
}

/**
 * Abbreviate a cwd with a leading `~` when it lives under the home directory,
 * mirroring pi's own footer behavior ("/home/user/dev" -> "~/dev").
 */
export function formatCwd(cwd: string, home: string = process.env.HOME ?? process.env.USERPROFILE ?? ""): string {
	if (!home) return cwd;
	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));
	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

/**
 * Sanitize and truncate a session name for display in the chip.
 *
 * Control characters (newlines, tabs, etc.) are stripped first. Names longer
 * than `max` characters are truncated to `max - 3` characters plus "...".
 */
export function truncateName(name: string, max = 64): string {
	const sanitized = name.replace(/[\x00-\x1f\x7f]/g, "").trim();
	if (sanitized.length === 0) return "";
	const chars = [...sanitized];
	if (chars.length <= max) return sanitized;
	const keep = Math.max(0, max - 3);
	return chars.slice(0, keep).join("") + "...";
}
