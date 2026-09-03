/**
 * Map pi thinking levels to the theme color keys used for the model/thinking
 * segments of the footer.
 */

export type ThinkingLevelName = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type ThinkingColorKey =
	| "thinkingOff"
	| "thinkingMinimal"
	| "thinkingLow"
	| "thinkingMedium"
	| "thinkingHigh"
	| "thinkingXhigh"
	| "thinkingMax";

export function thinkingColorKey(level: ThinkingLevelName): ThinkingColorKey {
	switch (level) {
		case "off":
			return "thinkingOff";
		case "minimal":
			return "thinkingMinimal";
		case "low":
			return "thinkingLow";
		case "medium":
			return "thinkingMedium";
		case "high":
			return "thinkingHigh";
		case "xhigh":
			return "thinkingXhigh";
		case "max":
			return "thinkingMax";
	}
}
