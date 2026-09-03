import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import { KeybindingsManager as RealKeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import {
	ICON_HELP_LINE,
	ICON_SAMPLES,
	IconPicker,
	buildIconRoleItems,
	buildIconValueItems,
	type IconPickerDeps,
} from "../src/icon-picker.ts";
import { ICON_ROLES, ICON_SUGGESTIONS, type IconConfig, type IconRole } from "../src/icons.ts";

function stubTheme(): Theme {
	return {
		fg: (_color: string, text: string) => text,
		bold: (text: string) => text,
		getColorMode: () => "truecolor" as const,
	} as unknown as Theme;
}

function stubTui(): TUI {
	return { requestRender: () => {} } as unknown as TUI;
}

function stubKeybindings(): KeybindingsManager {
	return new RealKeybindingsManager(TUI_KEYBINDINGS) as unknown as KeybindingsManager;
}

function makeDeps(overrides: Partial<IconPickerDeps> = {}): IconPickerDeps {
	return {
		getIcons: () => ({}),
		apply: () => {},
		notifyError: () => {},
		...overrides,
	};
}

interface PickerHarness {
	picker: IconPicker;
	applied: Array<[string, string]>;
	errors: string[];
	canceled(): boolean;
	customInput(): { handleInput(data: string): void; setValue(value: string): void };
}

function makePicker(overrides: { deps?: Partial<IconPickerDeps>; initialRole?: IconRole } = {}): PickerHarness {
	const applied: Array<[string, string]> = [];
	const errors: string[] = [];
	let canceled = false;
	const picker = new IconPicker(
		stubTui(),
		stubTheme(),
		stubKeybindings(),
		{
			...makeDeps(overrides.deps),
			apply: (role, value) => {
				applied.push([role, value]);
				overrides.deps?.apply?.(role, value);
			},
			notifyError: (message) => {
				errors.push(message);
				overrides.deps?.notifyError?.(message);
			},
		},
		() => {
			canceled = true;
		},
		overrides.initialRole,
	);
	return {
		picker,
		applied,
		errors,
		canceled: () => canceled,
		customInput: () =>
			(picker as unknown as { customInput: { handleInput(d: string): void; setValue(v: string): void } }).customInput,
	};
}

// ---------------------------------------------------------------------------
// Pure builders
// ---------------------------------------------------------------------------

test("buildIconRoleItems lists every role with label and current-value description", () => {
	const config: IconConfig = { model: "⚡", branch: "none" };
	const items = buildIconRoleItems(config);
	assert.equal(items.length, ICON_ROLES.length);
	const model = items.find((item) => item.value === "model")!;
	assert.equal(model.label, "model [Model segment]");
	assert.equal(model.description, "⚡");
	const branch = items.find((item) => item.value === "branch")!;
	assert.equal(branch.description, "none");
	const path = items.find((item) => item.value === "path")!;
	assert.equal(path.description, "auto → 📁");
});

test("buildIconValueItems: auto, none, custom…, then suggestions with sample previews", () => {
	const items = buildIconValueItems("model");
	const expected = 3 + ICON_SUGGESTIONS.model.length;
	assert.equal(items.length, expected);
	assert.equal(items[0].value, "auto");
	assert.equal(items[0].description, "default emoji");
	assert.equal(items[1].value, "none");
	assert.equal(items[1].description, "remove the icon");
	assert.equal(items[2].value, "custom");
	assert.equal(items[2].label, "custom…");
	// suggestion labels are the glyphs; descriptions carry a sample segment
	const suggestion = items[3];
	assert.equal(suggestion.value, ICON_SUGGESTIONS.model[0]);
	assert.equal(suggestion.label, ICON_SUGGESTIONS.model[0]);
	assert.equal(suggestion.description, `${ICON_SUGGESTIONS.model[0]} ${ICON_SAMPLES.model}`);
});

test("buildIconValueItems works for every role", () => {
	for (const role of ICON_ROLES) {
		const items = buildIconValueItems(role);
		assert.equal(items.length, 3 + ICON_SUGGESTIONS[role].length);
	}
});

test("ICON_HELP_LINE documents the accepted syntax", () => {
	assert.ok(ICON_HELP_LINE.includes("auto"));
	assert.ok(ICON_HELP_LINE.includes("none"));
	assert.ok(ICON_HELP_LINE.includes("4 columns"));
});

// ---------------------------------------------------------------------------
// Component flow
// ---------------------------------------------------------------------------

test("roles screen: enter selects the first role and shows its values", () => {
	const { picker, applied } = makePicker();
	picker.handleInput("\r"); // model → values screen
	const lines = picker.render(60).join("\n");
	assert.ok(lines.includes("Set icon for Model segment"), lines);
	assert.equal(applied.length, 0);
});

test("value screen: enter applies the selected value and returns to roles", () => {
	const { picker, applied } = makePicker();
	picker.handleInput("\r"); // model → values
	picker.handleInput("\r"); // auto → apply
	assert.deepEqual(applied, [["model", "auto"]]);
	const lines = picker.render(60).join("\n");
	assert.ok(lines.includes("gruntfoot icons"), lines);
});

test("value screen: none applies the none keyword", () => {
	const { picker, applied } = makePicker();
	picker.handleInput("\r"); // model → values
	picker.handleInput("\x1b[B"); // down to none
	picker.handleInput("\r");
	assert.deepEqual(applied, [["model", "none"]]);
});

test("value screen: backspace with no filter resets the role to auto", () => {
	const { picker, applied } = makePicker();
	picker.handleInput("\r"); // model → values
	picker.handleInput("\x7f"); // backspace → auto
	assert.deepEqual(applied, [["model", "auto"]]);
});

test("value screen: backspace with an active filter deletes the filter char instead", () => {
	const { picker, applied } = makePicker();
	picker.handleInput("\r"); // model → values
	picker.handleInput("n"); // type-to-filter
	picker.handleInput("\x7f"); // deletes "n" from the filter
	assert.deepEqual(applied, []);
	picker.handleInput("\x7f"); // filter empty → auto
	assert.deepEqual(applied, [["model", "auto"]]);
});

test("filtering narrows the value list to matching entries", () => {
	const { picker } = makePicker();
	picker.handleInput("\r"); // model → values
	picker.handleInput("n"); // matches auto, none; filters suggestions (glyph labels)
	const lines = picker.render(60).join("\n");
	assert.ok(lines.includes("none"), lines);
});

test("esc backs out one level: values → roles → cancel", () => {
	const { picker, canceled } = makePicker();
	picker.handleInput("\r"); // model → values
	picker.handleInput("\x1b"); // back to roles
	assert.equal(canceled(), false);
	assert.ok(picker.render(60).join("\n").includes("gruntfoot icons"));
	picker.handleInput("\x1b"); // cancel
	assert.equal(canceled(), true);
});

test("initial role opens the picker directly on its value screen", () => {
	const { picker } = makePicker({ initialRole: "branch" });
	const lines = picker.render(60).join("\n");
	assert.ok(lines.includes("Set icon for Git branch"), lines);
});

test("custom… opens the inline input; valid glyph applies; junk errors without saving", () => {
	const { picker, applied, errors, customInput } = makePicker();
	picker.handleInput("\r"); // model → values
	// custom… is the third entry: two arrows down land on it, confirmed by render
	picker.handleInput("\x1b[B");
	picker.handleInput("\x1b[B");
	const valueScreen = picker.render(60).join("\n");
	assert.ok(valueScreen.includes("→ custom…"), valueScreen);
	picker.handleInput("\r"); // select custom…
	assert.equal(applied.length, 0);
	// invalid value → error notify, nothing applied
	const input = customInput();
	input.handleInput("ab cd"); // 5 columns — over the cap
	input.handleInput("\r");
	assert.equal(applied.length, 0);
	assert.equal(errors.length, 1);
	assert.ok(errors[0].includes("invalid icon value"));
	// valid glyph applies
	input.setValue("");
	input.handleInput("❯");
	input.handleInput("\r");
	assert.deepEqual(applied, [["model", "❯"]]);
});

test("custom input: empty submit cancels back to the value list without applying", () => {
	const { picker, applied, customInput } = makePicker();
	picker.handleInput("\r"); // model → values
	picker.handleInput("\x1b[B");
	picker.handleInput("\x1b[B");
	picker.handleInput("\r"); // custom…
	customInput().handleInput("\r"); // empty submit → cancel
	assert.equal(applied.length, 0);
	assert.ok(picker.render(60).join("\n").includes("Set icon for Model segment"));
});

test("custom input: esc returns to the value list without applying", () => {
	const { picker, applied, customInput } = makePicker();
	picker.handleInput("\r"); // model → values
	picker.handleInput("\x1b[B");
	picker.handleInput("\x1b[B");
	picker.handleInput("\r"); // custom…
	customInput().handleInput("⚡");
	customInput().handleInput("\x1b");
	assert.equal(applied.length, 0);
	assert.ok(picker.render(60).join("\n").includes("Set icon for Model segment"));
});

test("render shows the muted help line on every screen", () => {
	const { picker } = makePicker();
	const rolesLines = picker.render(120).join("\n");
	assert.ok(rolesLines.includes(ICON_HELP_LINE), rolesLines);
	picker.handleInput("\r"); // values screen
	const valuesLines = picker.render(120).join("\n");
	assert.ok(valuesLines.includes(ICON_HELP_LINE), valuesLines);
});

test("role screen: backspace resets the selected role to auto", () => {
	const { picker, applied } = makePicker();
	// navigate to the second role (thinking) and press backspace
	picker.handleInput("\x1b[B");
	picker.handleInput("\x7f");
	assert.deepEqual(applied, [["thinking", "auto"]]);
	// the role list refreshes with the new current value
	const lines = picker.render(120).join("\n");
	assert.ok(lines.includes("Thinking segment"), lines);
});

test("kitty-protocol escape and backspace sequences are recognized", () => {
	const { picker, canceled } = makePicker();
	picker.handleInput("\r"); // model → values
	picker.handleInput("\x1b[27u"); // kitty esc → back to roles
	assert.equal(canceled(), false);
	assert.ok(picker.render(60).join("\n").includes("gruntfoot icons"));
	picker.handleInput("\x1b[27u"); // kitty esc → cancel
	assert.equal(canceled(), true);

	const { picker: picker2, applied: applied2 } = makePicker();
	picker2.handleInput("\r"); // model → values
	picker2.handleInput("\x1b[127u"); // kitty backspace → auto
	assert.deepEqual(applied2, [["model", "auto"]]);
});
