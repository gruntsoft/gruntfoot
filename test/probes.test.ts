import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	compactionEnabledFrom,
	isAutoCompactEnabled,
	isExperimentalMode,
	isSubscriptionProvider,
	readCompactionEnabled,
	readSettingsJson,
	refreshAutoCompactEnabled,
	type SubscriptionProbeContext,
} from "../src/probes.ts";

let tempRoot: string | undefined;
const settings = (dir: string, content: string) => writeFileSync(join(dir, "settings.json"), content);

test("compactionEnabledFrom: defaults to true, project wins over global", () => {
	assert.equal(compactionEnabledFrom(undefined, undefined), true);
	assert.equal(compactionEnabledFrom({}, {}), true);
	assert.equal(compactionEnabledFrom({ compaction: { enabled: false } }, undefined), false);
	assert.equal(compactionEnabledFrom(undefined, { compaction: { enabled: true } }), true);
	assert.equal(compactionEnabledFrom({ compaction: { enabled: false } }, { compaction: { enabled: true } }), true);
	assert.equal(compactionEnabledFrom({ compaction: { enabled: true } }, { compaction: { enabled: false } }), false);
	assert.equal(compactionEnabledFrom({ compaction: { enabled: false } }, { compaction: {} }), false);
	assert.equal(compactionEnabledFrom({ compaction: { enabled: "yes" } }, undefined), true);
});

test("readSettingsJson tolerates missing and malformed files", () => {
	tempRoot = join(tmpdir(), `gruntfoot-probes-${process.pid}`);
	rmSync(tempRoot, { recursive: true, force: true });
	mkdirSync(tempRoot, { recursive: true });
	const missing = join(tempRoot, "missing.json");
	assert.equal(readSettingsJson(missing), undefined);
	writeFileSync(missing, "{not json");
	assert.equal(readSettingsJson(missing), undefined);
});

test("readCompactionEnabled: missing files default to true", () => {
	const dir = join(tempRoot!, "empty");
	mkdirSync(dir, { recursive: true });
	assert.equal(readCompactionEnabled(join(dir, "global.json"), join(dir, "project.json")), true);
});

test("isAutoCompactEnabled reads user and project settings with caching", () => {
	const agentDir = join(tempRoot!, "agent");
	const projectDir = join(tempRoot!, "project");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(projectDir, { recursive: true });
	process.env.PI_CODING_AGENT_DIR = agentDir;

	// no files -> default true
	assert.equal(isAutoCompactEnabled(projectDir), true);

	// global disables
	settings(agentDir, JSON.stringify({ compaction: { enabled: false } }));
	assert.equal(isAutoCompactEnabled(projectDir), true); // cached
	assert.equal(refreshAutoCompactEnabled(projectDir), false);

	// project re-enables (project wins)
	mkdirSync(join(projectDir, ".pi"), { recursive: true });
	settings(join(projectDir, ".pi"), JSON.stringify({ compaction: { enabled: true } }));
	assert.equal(refreshAutoCompactEnabled(projectDir), true);

	// project disables over global true
	settings(agentDir, JSON.stringify({ compaction: { enabled: true } }));
	settings(join(projectDir, ".pi"), JSON.stringify({ compaction: { enabled: false } }));
	assert.equal(refreshAutoCompactEnabled(projectDir), false);

	// malformed project falls back to global
	settings(join(projectDir, ".pi"), "{broken");
	assert.equal(refreshAutoCompactEnabled(projectDir), true);

	// cache keyed by cwd
	const otherProject = join(tempRoot!, "other");
	mkdirSync(otherProject, { recursive: true });
	assert.equal(isAutoCompactEnabled(otherProject), true);
});

test("isExperimentalMode matches PI_EXPERIMENTAL === 1", () => {
	const original = process.env.PI_EXPERIMENTAL;
	try {
		delete process.env.PI_EXPERIMENTAL;
		assert.equal(isExperimentalMode(), false);
		process.env.PI_EXPERIMENTAL = "0";
		assert.equal(isExperimentalMode(), false);
		process.env.PI_EXPERIMENTAL = "1";
		assert.equal(isExperimentalMode(), true);
	} finally {
		if (original === undefined) delete process.env.PI_EXPERIMENTAL;
		else process.env.PI_EXPERIMENTAL = original;
	}
});

function subscriptionCtx(overrides: Partial<SubscriptionProbeContext> = {}): SubscriptionProbeContext {
	return {
		model: null,
		modelRegistry: {
			getProvider: () => undefined,
			isUsingOAuth: () => false,
		},
		...overrides,
	};
}

test("isSubscriptionProvider is false without a provider id or provider", () => {
	assert.equal(isSubscriptionProvider(undefined, subscriptionCtx()), false);
	assert.equal(isSubscriptionProvider("openai", subscriptionCtx()), false);
});

test("isSubscriptionProvider detects oauth isSubscription", () => {
	const ctx = subscriptionCtx({
		modelRegistry: {
			getProvider: () => ({ auth: { oauth: { isSubscription: true } } }),
			isUsingOAuth: () => true,
		},
	});
	assert.equal(isSubscriptionProvider("kimi", ctx), true);
});

test("isSubscriptionProvider is false when the model does not use OAuth", () => {
	const ctx = subscriptionCtx({
		model: { provider: "kimi" },
		modelRegistry: {
			getProvider: () => ({ auth: { oauth: { isSubscription: true } } }),
			isUsingOAuth: () => false,
		},
	});
	assert.equal(isSubscriptionProvider("kimi", ctx), false);
});

test("isSubscriptionProvider caches the negative result per provider", () => {
	let provider: { auth?: { oauth?: { isSubscription?: boolean } } } | undefined = undefined;
	const ctx = subscriptionCtx({
		modelRegistry: {
			getProvider: () => provider,
			isUsingOAuth: () => true,
		},
	});
	assert.equal(isSubscriptionProvider("cached-provider", ctx), false);
	// provider appears later, but the negative result stays cached
	provider = { auth: { oauth: { isSubscription: true } } };
	assert.equal(isSubscriptionProvider("cached-provider", ctx), false);
});
