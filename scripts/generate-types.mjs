// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// Generates TypeScript types for packages/core from the JSON Schemas (ADR-0016: the JSON
// Schemas are the single source of truth; TypeScript types are generated from them).
//
// json-schema-to-typescript does not follow cross-file `$ref`s with sibling keywords or
// 2020-12 conditionals well, so the schemas are first bundled into one document:
//  - every schema and every `$defs` entry becomes a named definition (its `title`);
//  - `$ref`s are rewritten to those definitions; a `$ref` with sibling keywords becomes
//    `allOf: [ref, siblings]` (an intersection type);
//  - validation-only keywords (`if`/`then`/`else`, `not`, `dependentRequired`, formats inside
//    `anyOf`) are dropped: they constrain values but do not change the TypeScript shape;
//  - a property whose schema is `{ "not": {} }` (reserved or forbidden) becomes `never`;
//  - `required` names declared as `true` next to a `$ref` become `Required<Pick<Ref, ...>>`;
//  - an `allOf` of `if: {kind: const}` / `then: {payload: ...}` pairs becomes a discriminated
//    union, so the payload type follows the discriminator.
//
// Usage: node scripts/generate-types.mjs          write packages/core/src/generated/contracts.ts
//        node scripts/generate-types.mjs --check  exit 1 if the committed file is out of date
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';
import prettier from 'prettier';

export const OUTPUT = 'packages/core/src/generated/contracts.ts';
const ROOT_TITLE = 'WorldbuilderContractsRoot';

const BANNER = `// SPDX-License-Identifier: Apache-2.0
// Copyright The Worldbuilder contributors
//
// GENERATED FILE, DO NOT EDIT. Source: schemas/*.schema.json.
// Regenerate with \`pnpm generate:types\`; a test fails if this file is out of date.
// The types describe shapes only; validate data against the JSON Schemas for the rules.`;

/** Keywords that only constrain values; they are removed before type generation. */
const VALIDATION_ONLY = new Set([
  'if',
  'then',
  'else',
  'not',
  'dependentRequired',
  'unevaluatedProperties',
  '$schema',
  '$id',
  '$defs',
  'default',
]);

/** `false` or `{ "not": {} }` (annotations aside): no value is allowed. */
const isForbidden = (s) =>
  s === false ||
  (s !== null &&
    typeof s === 'object' &&
    isEmptyNot(s) &&
    Object.keys(s).every((k) => ['not', 'description', 'title'].includes(k)));
const isEmptyNot = (s) =>
  s.not !== null && typeof s.not === 'object' && Object.keys(s.not).length === 0;

const pascal = (s) => s.replace(/(^|[-_.\s]+)([a-z0-9])/gi, (_m, _sep, c) => c.toUpperCase());

/** Assign a unique type name to every schema and `$defs` entry. */
function nameDefinitions(schemas) {
  const names = new Map(); // "file#pointer" -> Name
  const used = new Set();
  const claim = (key, wanted) => {
    if (used.has(wanted)) throw new Error(`duplicate type name ${wanted} (${key})`);
    used.add(wanted);
    names.set(key, wanted);
  };
  for (const [file, schema] of schemas) {
    claim(`${file}#`, schema.title ?? pascal(file.replace('.schema.json', '')));
    for (const [key, def] of Object.entries(schema.$defs ?? {})) {
      claim(`${file}#/$defs/${key}`, def.title ?? `${schema.title}${pascal(key)}`);
    }
  }
  return names;
}

function resolveRef(ref, currentFile) {
  const [filePart, pointer = ''] = ref.split('#');
  const file = filePart === '' ? currentFile : filePart;
  return `${file}#${pointer}`;
}

/** Rewrite one schema node for json-schema-to-typescript. */
function transform(node, file, names) {
  if (Array.isArray(node)) return node.map((n) => transform(n, file, names));
  if (node === true) return {};
  if (node === null || typeof node !== 'object') return node;
  /** @type {Record<string, any>} */
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (VALIDATION_ONLY.has(key)) continue;
    if (key === 'properties') {
      out.properties = {};
      for (const [prop, schema] of Object.entries(value)) {
        out.properties[prop] = isForbidden(schema)
          ? { tsType: 'never', description: schema.description }
          : transform(schema, file, names);
      }
    } else if (key === 'const') {
      out.enum = [value]; // json-schema-to-typescript renders `const: true` as `{}`
    } else if (key === '$ref') {
      const target = resolveRef(value, file);
      const name = names.get(target);
      if (!name) throw new Error(`${file}: cannot resolve $ref ${value}`);
      out.$ref = `#/$defs/${name}`;
    } else if (key === 'anyOf' && value.every((s) => Object.keys(s).every((k) => k === 'format'))) {
      continue; // formats only: same TypeScript type as the parent
    } else if (key === 'allOf' && isDiscriminatedUnion(value)) {
      out.oneOf = value.map((pair) => discriminatedVariant(pair, file, names));
    } else if (key === 'allOf') {
      const parts = value.map((s) => transform(s, file, names)).filter(hasShape);
      if (parts.length > 0) out.allOf = parts;
    } else {
      out[key] = transform(value, file, names);
    }
  }
  if (!out.$ref) {
    const opaqueObject =
      out.type === 'object' &&
      !['properties', 'additionalProperties', 'allOf', 'anyOf', 'oneOf'].some((k) => k in out);
    if (opaqueObject) return { ...out, tsType: 'Record<string, unknown>' };
    const closedEmpty =
      out.type === 'object' &&
      Object.keys(out.properties ?? { x: 1 }).length === 0 &&
      out.additionalProperties === false;
    return closedEmpty ? { ...out, tsType: 'Record<string, never>' } : out;
  }
  // A bare $ref: drop annotations so json-schema-to-typescript reuses the named type.
  if (!Object.keys(out).some((k) => SHAPE_KEYS.has(k))) return { $ref: out.$ref };
  // A $ref with siblings that shape the type becomes an intersection.
  const { $ref, description, title, ...rest } = out;
  /** @type {Record<string, any>[]} */
  const parts = [{ $ref }];
  const declaredOnly = Object.entries(rest.properties ?? {})
    .filter(([, s]) => Object.keys(s).length === 0)
    .map(([p]) => p);
  if (declaredOnly.length > 0) {
    const refName = $ref.replace('#/$defs/', '');
    const picked = declaredOnly.filter((p) => rest.required?.includes(p));
    for (const p of declaredOnly) delete rest.properties[p];
    rest.required = rest.required?.filter((p) => !declaredOnly.includes(p));
    if (picked.length > 0) {
      parts.push({
        tsType: `Required<Pick<${refName}, ${picked.map((p) => `'${p}'`).join(' | ')}>>`,
      });
    }
  }
  if (Object.keys(rest.properties ?? {}).length > 0 || rest.allOf || rest.oneOf) parts.push(rest);
  return { title, description, allOf: parts };
}

/** `{ if: { properties: { d: { const } } }, then: { properties: {...} } }` */
function isDiscriminatorPair(s) {
  const ifProps = Object.entries(s?.if?.properties ?? {});
  return (
    ifProps.length === 1 &&
    ifProps[0]?.[1]?.const !== undefined &&
    s.then?.properties !== undefined &&
    s.else === undefined
  );
}

/** At least two if/then pairs on the same discriminator property. */
function isDiscriminatedUnion(entries) {
  if (entries.length < 2 || !entries.every(isDiscriminatorPair)) return false;
  return new Set(entries.map((e) => Object.keys(e.if.properties)[0])).size === 1;
}

function discriminatedVariant(pair, file, names) {
  const [discriminator, { const: value }] = /** @type {[string, any]} */ (
    Object.entries(pair.if.properties)[0]
  );
  const then = transform(pair.then, file, names);
  return {
    type: 'object',
    properties: { [discriminator]: { const: value }, ...then.properties },
    required: [discriminator, ...Object.keys(then.properties)],
  };
}

const SHAPE_KEYS = new Set([
  'type',
  'properties',
  'required',
  'items',
  'enum',
  'const',
  'allOf',
  'anyOf',
  'oneOf',
  'additionalProperties',
]);
const hasShape = (s) => Object.keys(s).some((k) => SHAPE_KEYS.has(k) || k === '$ref');

/** Load all schemas from `<repoRoot>/schemas` as [file, schema] pairs. */
export function loadSchemaFiles(repoRoot) {
  const dir = path.join(repoRoot, 'schemas');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.schema.json'))
    .sort()
    .map((f) => [f, JSON.parse(readFileSync(path.join(dir, f), 'utf8'))]);
}

/** Bundle all schemas into one document whose `$defs` hold every named type. */
export function bundle(schemas) {
  const names = nameDefinitions(schemas);
  const $defs = {};
  for (const [file, schema] of schemas) {
    const top = transform(schema, file, names);
    if (hasShape(top)) $defs[names.get(`${file}#`)] = { ...top, title: names.get(`${file}#`) };
    for (const [key, def] of Object.entries(schema.$defs ?? {})) {
      const name = names.get(`${file}#/$defs/${key}`);
      const t = transform(def, file, names);
      // A definition that only aliases another one: `export type CardId = Ulid`.
      $defs[name] =
        Object.keys(t).length === 1 && t.$ref
          ? { title: name, description: def.description, tsType: t.$ref.replace('#/$defs/', '') }
          : { ...t, title: name };
    }
  }
  return { title: ROOT_TITLE, type: 'object', additionalProperties: false, $defs };
}

/** Remove json-schema-to-typescript's "referenced by the root" notes and empty doc blocks. */
function stripReferenceNotes(ts) {
  const lines = ts.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.includes(`referenced by \`${ROOT_TITLE}\``)) {
      i++; // skip the following "via the definition" line
      if (out.at(-1)?.trim() === '*') out.pop();
      continue;
    }
    if (line.trim() === '*/' && out.at(-1)?.trim() === '/**') {
      out.pop();
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

/** Generate the formatted TypeScript source. */
export async function generateTypes(repoRoot) {
  const schema = /** @type {any} */ (bundle(loadSchemaFiles(repoRoot)));
  const ts = await compile(schema, ROOT_TITLE, {
    bannerComment: '',
    additionalProperties: false,
    unreachableDefinitions: true,
    strictIndexSignatures: true,
    ignoreMinAndMaxItems: true,
    format: false,
    cwd: path.join(repoRoot, 'schemas'),
  });
  const body = stripReferenceNotes(
    ts.replace(new RegExp(`export interface ${ROOT_TITLE} \\{\\s*\\}\\n?`), ''),
  );
  const config = (await prettier.resolveConfig(path.join(repoRoot, OUTPUT))) ?? {};
  return prettier.format(`${BANNER}\n\n${body}`, { ...config, parser: 'typescript' });
}

export const SCHEMAS_OUTPUT = 'packages/core/src/generated/schemas.ts';

/**
 * The JSON Schemas as a module, so runtime validators (the disclosure gate, the conformance
 * kit) use exactly the files in schemas/ without reading the file system.
 */
export async function generateSchemasModule(repoRoot) {
  const schemas = loadSchemaFiles(repoRoot).map(([, schema]) => schema);
  const source = `${BANNER.replace('The types describe shapes only; validate data against the JSON Schemas for the rules.', 'The JSON Schemas of schemas/, for runtime validation with Ajv.')}

/** Every JSON Schema of the contract, keyed by its \`$id\`. */
export const SCHEMAS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = ${JSON.stringify(
    Object.fromEntries(schemas.map((sch) => [sch.$id, sch])),
  )};
`;
  const config = (await prettier.resolveConfig(path.join(repoRoot, SCHEMAS_OUTPUT))) ?? {};
  return prettier.format(source, { ...config, parser: 'typescript' });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  /** @type {[string, string][]} */
  const outputs = [
    [OUTPUT, await generateTypes(repoRoot)],
    [SCHEMAS_OUTPUT, await generateSchemasModule(repoRoot)],
  ];
  let stale = false;
  for (const [rel, source] of outputs) {
    const file = path.join(repoRoot, rel);
    if (process.argv.includes('--check')) {
      const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
      if (current !== source) {
        console.error(`${rel} is out of date; run pnpm generate:types`);
        stale = true;
      } else console.log(`${rel} is up to date`);
    } else {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, source);
      console.log(`wrote ${rel}`);
    }
  }
  if (stale) process.exit(1);
}
