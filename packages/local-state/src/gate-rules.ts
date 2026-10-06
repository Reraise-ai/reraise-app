// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Gate rules loader (ADR-0031, fail closed): `<state>/gate-rules.yaml` and adapter fragments
// are validated against the contract schemas; anything invalid, unreadable or ambiguous
// yields a deny-everything rule set with the reason, never a partial rule set.

import type {
  DisclosureTarget,
  GateRuleFragment,
  GateRules,
  GateRulesLoad,
  SourcedGateRule,
} from '@worldbuilder/core';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { validatorFor } from './validate.js';

const TARGETS: DisclosureTarget[] = ['screen', 'local_model', 'cloud_model', 'demo'];
const MAX_RULE_FILE_BYTES = 1024 * 1024;

/** The rule set that denies every card for every target. */
export const DENY_ALL_RULES: GateRules = Object.freeze({
  rules: [{ id: 'deny-all', effect: 'deny', targets: TARGETS, match: {} }],
}) as GateRules;

function denyAll(reason: string): GateRulesLoad {
  return {
    ok: false,
    reason,
    rules: DENY_ALL_RULES,
    fragments: [],
    effective: DENY_ALL_RULES.rules.map((r) => ({ ...r, source: 'fail-closed' })),
  };
}

/** Parse YAML text without aliases, anchors-as-bombs or multiple documents. */
function parseRuleYaml(text: string): unknown {
  return parse(text, { maxAliasCount: 0, uniqueKeys: true, strict: true });
}

/**
 * Merge a parsed user rule file (or undefined if absent) with adapter fragments, validating
 * both. Pure; the file-reading wrapper is `loadGateRulesFile`.
 */
export function buildGateRules(
  user: unknown,
  fragments: readonly unknown[] = [],
  missing = false,
): GateRulesLoad {
  if (user !== undefined) {
    const result = validatorFor('gate-rules.schema.json')(user);
    if (!result.ok) return denyAll(`gate rules invalid: ${result.message}`);
  }
  const effective: SourcedGateRule[] = ((user as GateRules | undefined)?.rules ?? []).map((r) => ({
    ...r,
    source: 'user',
  }));
  const validFragments: GateRuleFragment[] = [];
  const checkFragment = validatorFor('gate-rules.schema.json#/$defs/fragment');
  for (const fragment of fragments) {
    const result = checkFragment(fragment);
    if (!result.ok) {
      const source = (fragment as { source?: unknown } | null)?.source;
      const name = typeof source === 'string' ? source : 'unknown';
      return denyAll(
        `gate rule fragment from ${name} invalid (deny rules only): ${result.message}`,
      );
    }
    const f = fragment as GateRuleFragment;
    validFragments.push(f);
    effective.push(...f.rules.map((r) => ({ ...r, source: f.source })));
  }
  const seen = new Set<string>();
  for (const rule of effective) {
    if (seen.has(rule.id)) return denyAll(`gate rule id "${rule.id}" is defined more than once`);
    seen.add(rule.id);
  }
  return {
    ok: true,
    ...(missing ? { missing: true } : {}),
    rules: (user as GateRules | undefined) ?? { rules: [] },
    fragments: validFragments,
    effective,
  };
}

/** Read and validate a rule file. A missing file is valid (no rules, default deny). */
export async function loadGateRulesFile(
  file: string,
  fragments: readonly unknown[] = [],
): Promise<GateRulesLoad> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT')
      return buildGateRules(undefined, fragments, true);
    return denyAll(`gate rules unreadable: ${(e as NodeJS.ErrnoException).code ?? 'error'}`);
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_RULE_FILE_BYTES) {
    return denyAll('gate rules file is larger than 1 MiB');
  }
  let parsed: unknown;
  try {
    parsed = parseRuleYaml(text);
  } catch (e) {
    return denyAll(`gate rules are not valid YAML: ${(e as Error).message.split('\n')[0]}`);
  }
  // An empty file parses to null, which is not a rule set.
  return buildGateRules(parsed === null ? 'empty' : parsed, fragments);
}
