import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { buildColorCompletions, parseColorCommand } from "./src/command.ts";
import { resolveColors, type ColorRole } from "./src/colors.ts";
import { GruntfootEditor } from "./src/editor.ts";
import { createGruntfootFooter } from "./src/footer.ts";
import { IconPicker } from "./src/icon-picker.ts";
import type { IconRole } from "./src/icons.ts";
import { ColorPicker } from "./src/picker.ts";
import { refreshAutoCompactEnabled } from "./src/probes.ts";
import { createUiState } from "./src/state.ts";
import { createThemeStore } from "./src/themes.ts";
import { ThemePicker, type ThemePickerTarget } from "./src/theme-picker.ts";

/**
 * gruntfoot: custom footer (model/thinking colors, context bar, usage stats),
 * static accent editor separators with a session-name chip, a /gruntfoot toggle,
 * configurable colors and icons for every UI role (`/gruntfoot color`,
 * `/gruntfoot icon`, fluent set/reset forms for both), and named themes
 * (`/gruntfoot theme`). Installs only in TUI mode; a silent no-op everywhere
 * else.
 */
export default function (pi: ExtensionAPI): void {
	const state = createUiState();
	const themeStore = createThemeStore();
	let activeTui: TUI | undefined;
	let uiInstalled = false;

	const notify = (ctx: ExtensionContext, message: string, type: "info" | "warning" | "error"): void => {
		ctx.ui.notify?.(message, type);
	};

	/** Warn when a write failed (malformed file or lock failure). */
	const warnIfNotPersisted = (ctx: ExtensionContext, persisted: boolean): void => {
		if (persisted) return;
		notify(
			ctx,
			state.hadMalformedFile
				? "gruntfoot: state not saved (malformed state file)"
				: "gruntfoot: state not saved (could not lock state file)",
			"warning",
		);
	};

	const install = (ctx: ExtensionContext): void => {
		if (uiInstalled || ctx.mode !== "tui") return;

		ctx.ui.setFooter(
			createGruntfootFooter(
				ctx,
				() => state.getColors(),
				() => state.getIcons(),
				(tui) => {
					activeTui = tui;
				},
			),
		);

		// Composition: another extension may have replaced the editor first.
		const previous = ctx.ui.getEditorComponent();
		ctx.ui.setEditorComponent((tui, theme, keybindings) =>
			new GruntfootEditor(tui, theme, keybindings, {
				base: previous?.(tui, theme, keybindings),
				getSessionName: () => ctx.sessionManager.getSessionName(),
				getTheme: () => ctx.ui.theme,
				getColors: () => resolveColors(state.getColors()),
			}),
		);

		uiInstalled = true;
	};

	const uninstall = (ctx: ExtensionContext): void => {
		if (!uiInstalled) return;
		ctx.ui.setFooter(undefined);
		ctx.ui.setEditorComponent(undefined);
		activeTui = undefined;
		uiInstalled = false;
	};

	const handleToggle = (ctx: ExtensionCommandContext): void => {
		const { enabled, persisted } = state.toggle();
		if (ctx.mode === "tui") {
			if (enabled) {
				install(ctx);
			} else {
				uninstall(ctx);
			}
		}
		notify(ctx, `gruntfoot ${enabled ? "enabled" : "disabled"}`, "info");
		warnIfNotPersisted(ctx, persisted);
	};

	const handleColorSet = (ctx: ExtensionCommandContext, role: ColorRole, value: string): void => {
		const { persisted } = state.setColor(role, value);
		activeTui?.requestRender();
		notify(ctx, `gruntfoot: ${role} set to ${value}`, "info");
		warnIfNotPersisted(ctx, persisted);
	};

	const handleColorReset = (ctx: ExtensionCommandContext): void => {
		const { persisted } = state.resetColors();
		activeTui?.requestRender();
		notify(ctx, "gruntfoot: colors reset to theme defaults", "info");
		warnIfNotPersisted(ctx, persisted);
	};

	const handleIconSet = (ctx: ExtensionCommandContext, role: IconRole, value: string): void => {
		const { persisted } = state.setIcon(role, value);
		activeTui?.requestRender();
		notify(ctx, `gruntfoot: ${role} icon set to ${value}`, "info");
		warnIfNotPersisted(ctx, persisted);
	};

	const handleIconReset = (ctx: ExtensionCommandContext): void => {
		const { persisted } = state.resetIcons();
		activeTui?.requestRender();
		notify(ctx, "gruntfoot: icons reset to defaults", "info");
		warnIfNotPersisted(ctx, persisted);
	};

	/**
	 * CLI form of `theme save <name>`: confirm overwrites via `ctx.ui.confirm`
	 * (returns false on cancel/timeout/no-UI, so non-interactive modes fail
	 * safe), then save the current colors. Nothing is written on decline or
	 * failure.
	 */
	const handleThemeSave = async (ctx: ExtensionCommandContext, name: string): Promise<void> => {
		let overwrite = false;
		if (themeStore.themeExists(name)) {
			const confirmed = await ctx.ui.confirm("Overwrite theme", `Theme "${name}" already exists. Overwrite it?`);
			if (!confirmed) {
				notify(ctx, `gruntfoot: theme ${name} not saved (overwrite declined)`, "error");
				return;
			}
			overwrite = true;
		}
		const { ok, reason } = themeStore.saveTheme(name, { colors: state.getColors(), icons: state.getIcons() }, { overwrite });
		if (!ok) {
			notify(ctx, `gruntfoot: could not save theme ${name} (${reason})`, "error");
			return;
		}
		notify(ctx, `gruntfoot: theme ${name} saved`, "info");
	};

	/** CLI form of `theme load <name>`: replaces the whole colors + icons config. */
	const handleThemeLoad = (ctx: ExtensionCommandContext, name: string): void => {
		const result = themeStore.loadTheme(name);
		if (!result.ok) {
			notify(
				ctx,
				result.reason === "malformed"
					? `gruntfoot: malformed theme file: ${name}.json`
					: `gruntfoot: theme not found: ${name}`,
				"error",
			);
			return;
		}
		warnIfNotPersisted(ctx, state.applyTheme(result.colors, result.icons).persisted);
		activeTui?.requestRender();
		notify(ctx, `gruntfoot: theme ${name} loaded`, "info");
	};

	const openColorPicker = async (ctx: ExtensionCommandContext, initialRole?: ColorRole): Promise<void> => {
		if (ctx.mode !== "tui") {
			notify(ctx, "gruntfoot: the color picker is only available in TUI mode; use /gruntfoot color <role> <value>", "error");
			return;
		}
		await ctx.ui.custom<null>(
			(tui, theme, keybindings, done) =>
				new ColorPicker(
					tui,
					theme,
					keybindings,
					{
						getColors: () => state.getColors(),
						apply: (role, value) => {
							warnIfNotPersisted(ctx, state.setColor(role, value).persisted);
							activeTui?.requestRender();
						},
						notifyError: (message) => notify(ctx, `gruntfoot: ${message}`, "error"),
					},
					() => done(null),
					initialRole,
				),
		);
	};

	const openIconPicker = async (ctx: ExtensionCommandContext, initialRole?: IconRole): Promise<void> => {
		if (ctx.mode !== "tui") {
			notify(ctx, "gruntfoot: the icon picker is only available in TUI mode; use /gruntfoot icon <role> <glyph>", "error");
			return;
		}
		await ctx.ui.custom<null>(
			(tui, theme, keybindings, done) =>
				new IconPicker(
					tui,
					theme,
					keybindings,
					{
						getIcons: () => state.getIcons(),
						apply: (role, value) => {
							warnIfNotPersisted(ctx, state.setIcon(role, value).persisted);
							activeTui?.requestRender();
						},
						notifyError: (message) => notify(ctx, `gruntfoot: ${message}`, "error"),
					},
					() => done(null),
					initialRole,
				),
		);
	};

	const openThemePicker = async (ctx: ExtensionCommandContext, target: ThemePickerTarget): Promise<void> => {
		if (ctx.mode !== "tui") {
			notify(
				ctx,
				"gruntfoot: the theme picker is only available in TUI mode; use /gruntfoot theme save <name> or /gruntfoot theme load <name>",
				"error",
			);
			return;
		}
		await ctx.ui.custom<null>(
			(tui, theme, keybindings, done) =>
				new ThemePicker(
					tui,
					theme,
					keybindings,
					{
						listThemes: () => themeStore.listThemeNames(),
						themeExists: (name) => themeStore.themeExists(name),
						save: (name, overwrite) =>
							themeStore.saveTheme(name, { colors: state.getColors(), icons: state.getIcons() }, { overwrite }),
						onSaved: (name) => {
							notify(ctx, `gruntfoot: theme ${name} saved`, "info");
							activeTui?.requestRender();
						},
						onLoaded: (name) => {
							const result = themeStore.loadTheme(name);
							if (!result.ok) {
								notify(ctx, `gruntfoot: malformed theme file: ${name}.json`, "error");
								return;
							}
							warnIfNotPersisted(ctx, state.applyTheme(result.colors, result.icons).persisted);
							activeTui?.requestRender();
							notify(ctx, `gruntfoot: theme ${name} loaded`, "info");
						},
						notifyError: (message) => notify(ctx, `gruntfoot: ${message}`, "error"),
					},
					() => done(null),
					target,
				),
		);
	};

	pi.registerCommand("gruntfoot", {
		description:
			"Toggle gruntfoot custom footer and editor, or configure its colors, icons, and themes (/gruntfoot color, /gruntfoot color <role> <value>, /gruntfoot color-reset, /gruntfoot icon, /gruntfoot icon <role> <glyph>, /gruntfoot icon-reset, /gruntfoot theme)",
		getArgumentCompletions: (argumentText) => buildColorCompletions(argumentText, () => themeStore.listThemeNames()),
		handler: async (args, ctx: ExtensionCommandContext) => {
			if (args.trim() === "") {
				handleToggle(ctx);
				return;
			}
			const parsed = parseColorCommand(args);
			switch (parsed.kind) {
				case "picker":
					await openColorPicker(ctx, parsed.role);
					return;
				case "set":
					handleColorSet(ctx, parsed.role, parsed.value);
					return;
				case "reset":
					handleColorReset(ctx);
					return;
				case "icon-picker":
					await openIconPicker(ctx, parsed.role);
					return;
				case "icon-set":
					handleIconSet(ctx, parsed.role, parsed.value);
					return;
				case "icon-reset":
					handleIconReset(ctx);
					return;
				case "theme-menu":
					await openThemePicker(ctx, "menu");
					return;
				case "theme-save":
					if (parsed.name === undefined) {
						await openThemePicker(ctx, "save");
					} else {
						await handleThemeSave(ctx, parsed.name);
					}
					return;
				case "theme-load":
					if (parsed.name === undefined) {
						await openThemePicker(ctx, "load");
					} else {
						handleThemeLoad(ctx, parsed.name);
					}
					return;
				case "invalid":
					notify(ctx, `gruntfoot: ${parsed.reason}`, "error");
					return;
			}
		},
	});

	pi.on("session_start", (_event, ctx) => {
		if (state.isEnabled()) install(ctx);
		if (state.hadMalformedFile) {
			notify(ctx, "gruntfoot: state file is malformed; using in-memory state (default off)", "warning");
		}
	});

	pi.on("session_shutdown", (_event, ctx) => {
		uninstall(ctx);
	});

	// Live updates: chip (session name), model/thinking colors, usage totals.
	pi.on("session_info_changed", () => activeTui?.requestRender());
	pi.on("model_select", () => activeTui?.requestRender());
	pi.on("thinking_level_select", () => activeTui?.requestRender());
	pi.on("message_end", () => activeTui?.requestRender());

	// Refresh the auto-compaction probe after agent runs (settings may have changed).
	pi.on("agent_settled", (_event, ctx) => {
		refreshAutoCompactEnabled(ctx.cwd);
	});
}
