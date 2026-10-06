// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Contract check for schemas/ (ADR-0016):
//  1. every `*.schema.json` compiles under Ajv strict mode, with a versioned `$id`;
//  2. every example under examples/ validates against its declared schema and every id it
//     references exists in the same example world;
//  3. every valid fixture under schemas/fixtures/valid passes;
//  4. every invalid fixture under schemas/fixtures/invalid fails with its declared error;
//  5. every schema (except the shared definitions) has at least one valid and one invalid case.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020Module from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { isDeepStrictEqual } from 'node:util';
import { parse as parseYaml } from 'yaml';
import { toPosix, walk } from './lib.mjs';
import { splitFrontMatter, toCanonicalCard } from './markdown-cards.mjs';

// ajv ships CommonJS; under NodeNext its default export is typed as the module namespace.
const Ajv2020 = /** @type {any} */ (Ajv2020Module);
const addFormats = /** @type {any} */ (addFormatsModule);

/** Placeholder base of all schema ids; see schemas/README.md. Never fetched. */
export const SCHEMA_BASE = 'https://worldbuilder.invalid/schemas/v0/';
export const DRAFT_2020_12 = 'https://json-schema.org/draft/2020-12/schema';
/** Schemas that only hold shared `$defs` and need no examples of their own. */
export const DEFINITION_ONLY = new Set(['common.schema.json']);
export const STORE_CONFIG_FILE = 'worldbuilder-store.yaml';

const ULID_EXACT = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export const schemaId = (name) => `${SCHEMA_BASE}${name}`;

/** Create an Ajv instance in strict mode with formats. */
export function createAjv() {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  return ajv;
}

/** Load and compile all schemas. Returns { ajv, names, problems }. */
export function loadSchemas(repoRoot) {
  const dir = path.join(repoRoot, 'schemas');
  const ajv = createAjv();
  const problems = [];
  const names = [];
  if (!existsSync(dir)) return { ajv, names, problems };
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.schema.json'))
    .sort();
  for (const name of files) {
    const rel = `schemas/${name}`;
    let schema;
    try {
      schema = JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
    } catch (err) {
      problems.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (schema.$schema !== DRAFT_2020_12) problems.push(`${rel}: $schema must be ${DRAFT_2020_12}`);
    if (schema.$id !== schemaId(name)) problems.push(`${rel}: $id must be ${schemaId(name)}`);
    if (typeof schema.title !== 'string') problems.push(`${rel}: title missing`);
    try {
      ajv.addSchema(schema);
      names.push(name);
    } catch (err) {
      problems.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  for (const name of [...names]) {
    try {
      ajv.getSchema(schemaId(name));
    } catch (err) {
      problems.push(`schemas/${name}: ${err instanceof Error ? err.message : String(err)}`);
      names.splice(names.indexOf(name), 1);
    }
  }
  return { ajv, names, problems };
}

/** Count a passing valid case or a correctly failing invalid case for a schema. */
function bump(coverage, name, kind) {
  const c = coverage.get(name) ?? { valid: 0, invalid: 0 };
  c[kind]++;
  coverage.set(name, c);
}

const formatErrors = (errors) =>
  (errors ?? []).map((e) => `${e.instancePath || '/'} ${e.keyword}: ${e.message}`).join('; ');

/** Collect every string that looks exactly like a ULID, with its JSON path. */
export function collectUlids(value, at = '', out = []) {
  if (typeof value === 'string') {
    if (ULID_EXACT.test(value)) out.push({ id: value, at: at || '/' });
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => collectUlids(v, `${at}/${i}`, out));
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collectUlids(v, `${at}/${k}`, out);
  }
  return out;
}

function readJson(file, rel, problems) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    problems.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/** All ULIDs anywhere in `value`, except under the given keys (which hold other kinds of id). */
function ulidsOutside(value, skipKeys, out = []) {
  if (typeof value === 'string') {
    // Also ids embedded in text (for example a Markdown body that lists card ids).
    for (const m of value.matchAll(/(?<![0-9A-Z])[0-7][0-9A-HJKMNP-TV-Z]{25}(?![0-9A-Z])/g))
      out.push(m[0]);
  } else if (Array.isArray(value)) {
    value.forEach((v) => ulidsOutside(v, skipKeys, out));
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value))
      if (!skipKeys.has(k)) ulidsOutside(v, skipKeys, out);
  }
  return out;
}

/**
 * Rules JSON Schema cannot express. Each returns the problems found in a valid instance;
 * an invalid fixture may expect one by name (`"expect": { "check": "<name>" }`).
 */
export const CROSS_CHECKS = {
  /** ADR-0017, ADR-0028: a training record names no card that did not opt in, not even by id. */
  'training-opt-in': {
    schema: 'training-export-record.schema.json',
    run(record) {
      const opted = new Set(
        [record.decision, ...(record.usedCards ?? []), record.lage]
          .filter((c) => c?.training === true)
          .map((c) => c.id),
      );
      const proposals = new Set((record.brainstorm ?? []).map((p) => p.id));
      // World ids are not card ids; proposal ids name the proposals themselves.
      return ulidsOutside(record, new Set(['worlds']))
        .filter((id) => !opted.has(id) && !proposals.has(id))
        .map((id) => `card ${id} did not opt in to training but appears in the record`);
    },
  },
  /** ADR-0015: the choice of a level-1 answer is one of its options. */
  'level1-choice': {
    schema: 'level1-answer.schema.json',
    run(answer) {
      return answer.options.includes(answer.choice)
        ? []
        : [`choice "${answer.choice}" is not one of the options`];
    },
  },
};

/** Run every cross-check that applies to `name`; returns [{ check, message }]. */
export function crossCheck(name, data) {
  return Object.entries(CROSS_CHECKS)
    .filter(([, c]) => c.schema === name)
    .flatMap(([check, c]) => c.run(data).map((message) => ({ check, message })));
}

/** Check an example/fixture envelope: { synthetic, schema, description, data, expect? }. */
function checkEnvelope(doc, rel, names, problems, { requireSynthetic, requireExpect }) {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    problems.push(`${rel}: envelope must be an object`);
    return null;
  }
  if (requireSynthetic && doc.synthetic !== true) problems.push(`${rel}: needs "synthetic": true`);
  const name = typeof doc.schema === 'string' ? doc.schema.replace(SCHEMA_BASE, '') : '';
  if (!doc.schema?.startsWith?.(SCHEMA_BASE) || !names.includes(name)) {
    problems.push(`${rel}: "schema" must be the $id of a schema in schemas/ (got ${doc.schema})`);
    return null;
  }
  if (typeof doc.description !== 'string' || doc.description.length === 0) {
    problems.push(`${rel}: "description" missing`);
  }
  if (!('data' in doc)) {
    problems.push(`${rel}: "data" missing`);
    return null;
  }
  const expectOk =
    typeof doc.expect === 'object' &&
    (typeof doc.expect?.keyword === 'string' || CROSS_CHECKS[doc.expect?.check] !== undefined);
  if (requireExpect && !expectOk) {
    problems.push(
      `${rel}: "expect": { "keyword", "instancePath"? } or { "check": <cross-check> } missing`,
    );
    return null;
  }
  return name;
}

/**
 * Validate the example worlds. Each directory directly under examples/ is one world:
 * a markdown-files store (worldbuilder-store.yaml + cards/*.md) plus JSON envelopes.
 */
function validateExamples(repoRoot, ajv, names, coverage, problems) {
  const root = path.join(repoRoot, 'examples');
  let examples = 0;
  if (!existsSync(root)) return examples;
  const check = (name, data, rel, where = '') => {
    const validate = ajv.getSchema(schemaId(name));
    if (!validate) {
      problems.push(`${rel}: schema ${name} not found`);
      return false;
    }
    if (!validate(data)) {
      problems.push(`${rel}${where}: invalid against ${name}: ${formatErrors(validate.errors)}`);
      return false;
    }
    bump(coverage, name, 'valid');
    return true;
  };

  for (const world of readdirSync(root).sort()) {
    const worldDir = path.join(root, world);
    if (!statSync(worldDir).isDirectory()) continue;
    /** @type {Map<string, any>} canonical cards by id */
    const cards = new Map();
    const defined = new Set();
    const referencing = [];
    let storeInstanceId = null;

    const storeFile = path.join(worldDir, STORE_CONFIG_FILE);
    if (existsSync(storeFile)) {
      const rel = toPosix(path.relative(repoRoot, storeFile));
      try {
        const config = parseYaml(readFileSync(storeFile, 'utf8'));
        if (check('store-config.schema.json', config, rel))
          storeInstanceId = config.storeInstanceId;
        examples++;
      } catch (err) {
        problems.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    /** @type {Map<string, string>} world name -> id, from the world examples */
    const worldNames = new Map();
    // JSON envelopes first, so that cards can resolve world names.
    const files = walk(worldDir).sort((a, b) => {
      const order = (f) => (f.endsWith('.json') ? 0 : 1);
      return order(a) - order(b) || a.localeCompare(b);
    });
    for (const file of files) {
      const rel = toPosix(path.relative(repoRoot, file));
      const base = path.basename(file);
      if (base === 'README.md' || base === STORE_CONFIG_FILE) continue;
      if (rel.startsWith(`examples/${world}/cards/`) && base.endsWith('.md')) {
        if (storeInstanceId === null) {
          problems.push(`${rel}: card outside a valid store (missing ${STORE_CONFIG_FILE})`);
          continue;
        }
        let card;
        let marked;
        try {
          const text = readFileSync(file, 'utf8');
          marked = splitFrontMatter(text).data.synthetic === true;
          card = toCanonicalCard(text, { storeInstanceId, worlds: worldNames });
        } catch (err) {
          problems.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }
        examples++;
        if (!marked) problems.push(`${rel}: needs synthetic: true`);
        if (!check('card.schema.json', card, rel)) continue;
        if (card.type === 'decision' && card.format === 2) check('decision.schema.json', card, rel);
        if (card.lage) check('lage.schema.json', card.lage, rel, ' (lage)');
        if (card.rule) check('rule.schema.json', card.rule, rel, ' (rule)');
        (card.edges ?? []).forEach((e, i) => check('edge.schema.json', e, rel, ` (edge ${i})`));
        if (cards.has(card.id)) problems.push(`${rel}: duplicate card id ${card.id}`);
        cards.set(card.id, card);
        defined.add(card.id);
        referencing.push({ rel, value: card, skip: '/id' });
      } else if (base.endsWith('.json')) {
        const doc = readJson(file, rel, problems);
        if (doc === undefined) continue;
        const name = checkEnvelope(doc, rel, names, problems, {
          requireSynthetic: true,
          requireExpect: false,
        });
        if (name === null) continue;
        examples++;
        if (!check(name, doc.data, rel)) continue;
        for (const f of crossCheck(name, doc.data))
          problems.push(`${rel}: ${f.check}: ${f.message}`);
        if (typeof doc.data?.id === 'string') defined.add(doc.data.id);
        if (name === 'world.schema.json') worldNames.set(doc.data.name, doc.data.id);
        referencing.push({ rel, value: doc.data, skip: '/id', name });
      } else {
        problems.push(`${rel}: unrecognised example file (expected cards/*.md or *.json)`);
      }
    }

    // Referential integrity: every id-like value must name something in this world.
    for (const { rel, value, skip, name } of referencing) {
      for (const { id, at } of collectUlids(value)) {
        if (at !== skip && !defined.has(id))
          problems.push(`${rel}: ${at} references unknown id ${id}`);
      }
      // Context packages must carry the canonical cards exactly as the store yields them.
      if (name === 'context-package.schema.json') {
        value.items.forEach((item, i) => {
          const card = cards.get(item.card.id);
          if (card && !isDeepStrictEqual(item.card, card)) {
            problems.push(
              `${rel}: /items/${i}/card differs from the canonical card ${item.card.id}`,
            );
          }
        });
      }
    }
  }
  return examples;
}

function validateFixtures(repoRoot, ajv, names, coverage, problems) {
  let valid = 0;
  let invalid = 0;
  for (const kind of ['valid', 'invalid']) {
    const dir = path.join(repoRoot, 'schemas', 'fixtures', kind);
    if (!existsSync(dir)) continue;
    for (const file of walk(dir).sort()) {
      const rel = toPosix(path.relative(repoRoot, file));
      if (!file.endsWith('.json')) {
        problems.push(`${rel}: fixtures must be .json`);
        continue;
      }
      const doc = readJson(file, rel, problems);
      if (doc === undefined) continue;
      const name = checkEnvelope(doc, rel, names, problems, {
        requireSynthetic: false,
        requireExpect: kind === 'invalid',
      });
      if (name === null) continue;
      const validate = ajv.getSchema(schemaId(name));
      const ok = validate(doc.data);
      const crossFindings = ok ? crossCheck(name, doc.data) : [];
      if (kind === 'valid') {
        valid++;
        for (const f of crossFindings) problems.push(`${rel}: ${f.check}: ${f.message}`);
        if (ok && crossFindings.length === 0) bump(coverage, name, 'valid');
        else
          problems.push(
            `${rel}: should be valid against ${name}: ${formatErrors(validate.errors)}`,
          );
        continue;
      }
      invalid++;
      if (doc.expect.check !== undefined) {
        if (!ok) {
          problems.push(
            `${rel}: must pass the schema and fail cross-check ${doc.expect.check}: ${formatErrors(validate.errors)}`,
          );
        } else if (crossFindings.some((f) => f.check === doc.expect.check)) {
          bump(coverage, name, 'invalid');
        } else {
          problems.push(`${rel}: should fail cross-check ${doc.expect.check} but passed`);
        }
        continue;
      }
      if (ok) {
        problems.push(`${rel}: should be INVALID against ${name} but passed`);
        continue;
      }
      const { keyword, instancePath } = doc.expect;
      const hit = validate.errors.some(
        (e) =>
          e.keyword === keyword && (instancePath === undefined || e.instancePath === instancePath),
      );
      if (hit) bump(coverage, name, 'invalid');
      else {
        problems.push(
          `${rel}: failed, but not with ${keyword}${instancePath === undefined ? '' : ` at ${instancePath}`}: ${formatErrors(validate.errors)}`,
        );
      }
    }
  }
  return { valid, invalid };
}

/** Run the whole contract check. */
export function validateSchemas(repoRoot) {
  const { ajv, names, problems } = loadSchemas(repoRoot);
  const coverage = new Map();
  const examples = validateExamples(repoRoot, ajv, names, coverage, problems);
  const fixtures = validateFixtures(repoRoot, ajv, names, coverage, problems);
  for (const name of names) {
    if (DEFINITION_ONLY.has(name)) continue;
    const c = coverage.get(name) ?? { valid: 0, invalid: 0 };
    if (c.valid === 0) problems.push(`schemas/${name}: no valid example or fixture`);
    if (c.invalid === 0) problems.push(`schemas/${name}: no invalid fixture`);
  }
  return { count: names.length, examples, fixtures, problems };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { count, examples, fixtures, problems } = validateSchemas(repoRoot);
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    console.error(`\nvalidate:schemas failed: ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log(
    `validate:schemas ok: ${count} schemas, ${examples} examples, ` +
      `${fixtures.valid} valid and ${fixtures.invalid} invalid fixtures`,
  );
}
