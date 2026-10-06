/**
 * Real-harness smoke test: imports the extension entry point with **no**
 * module resolve hook, so its bare `@earendil-works/pi-coding-agent` and
 * `@earendil-works/pi-tui` specifiers resolve through `node_modules` — the
 * actual installed packages. gruntfoot's other tests don't register resolve
 * hooks either (unlike piflux, whose sibling tests stub the packages), so
 * this file's specific value is the exact registration-surface assertion
 * against the real package types plus the hard-fail on a missing
 * `node_modules`: it invokes the default factory with a minimal stub
 * `ExtensionAPI` and asserts that everything the extension registers
 * survives contact with the real package surface (a renamed or removed
 * export fails the import loudly).
 *
 * This test intentionally does not skip when `node_modules` is missing: a
 * silent skip would recreate the drift blind spot it exists to close. Run
 * `npm install` first.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

if (!existsSync(join(packageRoot, "node_modules"))) {
	throw new Error(
		"node_modules is missing — the real-harness smoke test resolves the actual installed @earendil-works packages. Run `npm install` before testing.",
	);
}

let extensionModule: typeof import("../index.ts");
try {
	extensionModule = await import("../index.ts");
} catch (error) {
	const detail = error instanceof Error ? error.stack ?? error.message : String(error);
	throw new Error(
		`Failed to import the extension against the real installed @earendil-works packages — run \`npm install\` and retry (installed copies may be missing or drifted).\n${detail}`,
	);
}

interface RecordedCommand {
	description?: string;
	handler: (args: string, ctx: unknown) => Promise<void> | void;
}

test("real harness: the extension registers the gruntfoot command and 7 events against the installed pi packages", () => {
	const commands = new Map<string, RecordedCommand>();
	const events = new Map<string, unknown[]>();

	const fakePi = {
		registerCommand(name: string, options: RecordedCommand) {
			commands.set(name, options);
		},
		on(event: string, handler: unknown) {
			const list = events.get(event) ?? [];
			list.push(handler);
			events.set(event, list);
		},
	} as unknown as ExtensionAPI;

	extensionModule.default(fakePi);

	assert.deepEqual(
		[...commands.keys()].sort(),
		["gruntfoot"],
		"the extension must register exactly the gruntfoot command",
	);
	for (const [name, options] of commands) {
		assert.equal(typeof options.handler, "function", `command /${name} must have a handler function`);
	}

	assert.deepEqual(
		[...events.keys()].sort(),
		[
			"agent_settled",
			"message_end",
			"model_select",
			"session_info_changed",
			"session_shutdown",
			"session_start",
			"thinking_level_select",
		],
		"the extension must register exactly the 7 lifecycle/render events",
	);
	for (const [event, handlers] of events) {
		assert.equal(handlers.length, 1, `event ${event} must be registered exactly once`);
		for (const handler of handlers) {
			assert.equal(typeof handler, "function", `event ${event} must have a handler function`);
		}
	}
});
