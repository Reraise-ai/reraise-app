// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// Self-contained JSON Schemas for the MCP tool list. The contract schemas of schemas/ refer to
// each other by relative `$ref`; an MCP client that receives a tool schema has no access to
// those files and a language model should not see them either. `bundleSchema` follows every
// reference and returns one schema with the referenced parts under `$defs`, no `$id`, no file
// reference left.

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

type Json = Record<string, unknown>;
export type SchemaTable = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

/** Keywords whose value is data, not a schema: a `$ref` inside is not a reference. */
const DATA_KEYWORDS = new Set(['enum', 'const', 'default', 'examples']);

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

interface Target {
  readonly id: string;
  readonly pointer: string;
}

/** `common.schema.json#/$defs/text` relative to the schema `$id` of the file that holds it. */
function targetOf(ref: string, from: string): Target {
  const hash = ref.indexOf('#');
  const file = hash === -1 ? ref : ref.slice(0, hash);
  const pointer = hash === -1 ? '' : ref.slice(hash + 1);
  return { id: file === '' ? from : new URL(file, from).href, pointer };
}

const unescape = (part: string) => part.replace(/~1/g, '/').replace(/~0/g, '~');

function nameOf({ id, pointer }: Target): string {
  const file = id.slice(id.lastIndexOf('/') + 1).replace(/\.schema\.json$/, '');
  const rest = pointer
    .split('/')
    .filter((p) => p !== '' && p !== '$defs')
    .map(unescape)
    .join('.');
  return rest === '' ? file : `${file}.${rest}`;
}

/** The schema node a reference names. */
function nodeOf(table: SchemaTable, { id, pointer }: Target): unknown {
  let node: unknown = table[id];
  if (node === undefined) throw new Error(`unknown schema ${id}`);
  for (const part of pointer.split('/').filter((p) => p !== '')) {
    if (!isObject(node)) throw new Error(`bad pointer ${pointer} in ${id}`);
    node = node[unescape(part)];
  }
  if (node === undefined) throw new Error(`bad pointer ${pointer} in ${id}`);
  return node;
}

/** The schema without its own `$defs`: the parts that are reachable are pulled in by reference. */
const withoutDefs = (node: Json): Json =>
  Object.fromEntries(Object.entries(node).filter(([key]) => key !== '$defs'));

/**
 * Bundle the schema named by `ref` (a schema `$id`, optionally with a `#/pointer`) into one
 * self-contained draft 2020-12 schema.
 */
export function bundleSchema(table: SchemaTable, ref: string): Json {
  const root = targetOf(ref, ref);
  const defs: Record<string, unknown> = {};
  const queued: Target[] = [];

  const rewrite = (node: unknown, from: string): unknown => {
    if (Array.isArray(node)) return node.map((n) => rewrite(n, from));
    if (!isObject(node)) return node;
    const out: Json = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') {
        const target = targetOf(value, from);
        const name = nameOf(target);
        if (!(name in defs)) {
          defs[name] = null; // reserved; filled when the queue is drained
          queued.push(target);
        }
        out[key] = `#/$defs/${name}`;
      } else if (key === '$id' || key === '$schema') {
        continue;
      } else if (DATA_KEYWORDS.has(key)) {
        out[key] = value;
      } else if (key === 'properties' || key === '$defs' || key === 'patternProperties') {
        // A map of names to schemas: the names are not keywords.
        // A boolean schema becomes its object form: MCP clients (the SDK among them) accept only
        // objects as property schemas.
        const asObject = (v: unknown) => (v === true ? {} : v === false ? { not: {} } : v);
        out[key] = isObject(value)
          ? Object.fromEntries(
              Object.entries(value).map(([k, v]) => [k, rewrite(asObject(v), from)]),
            )
          : value;
      } else {
        out[key] = rewrite(value, from);
      }
    }
    return out;
  };

  const base = nodeOf(table, root);
  if (!isObject(base)) throw new Error(`${ref} is not a schema object`);
  const bundled = rewrite(withoutDefs(base), root.id) as Json;
  while (queued.length > 0) {
    const target = queued.shift()!;
    const node = nodeOf(table, target);
    defs[nameOf(target)] = isObject(node) ? rewrite(withoutDefs(node), target.id) : node;
  }
  return {
    $schema: DRAFT,
    ...(bundled['type'] === undefined ? { type: 'object' } : {}),
    ...bundled,
    ...(Object.keys(defs).length > 0 ? { $defs: defs } : {}),
  };
}
