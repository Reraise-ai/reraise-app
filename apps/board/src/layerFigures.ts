// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
//
// A stance is not an input: believed is an overlay, not a fourth layer (ADR-0007, AC-01).

import type { Layer } from '@worldbuilder/core';

/** Canon order. A new `Layer` is a type error until this table names it. */
const LAYER_TABLE = {
  evidenced: true,
  said: true,
  experience: true,
} satisfies Record<Layer, true>;
const LAYER_ORDER = Object.keys(LAYER_TABLE) as Layer[];

export type CountedLayer = Layer | 'unclassified';

export interface LayerFigure {
  layer: CountedLayer;
  findings: number;
  origins: number;
}

export interface LayerCount {
  layer: CountedLayer;
  count: number;
}

/** The three layers, in canon order, plus unclassified only when a card has no layer. */
function orderedLayers(hasUnclassified: boolean): CountedLayer[] {
  return hasUnclassified ? [...LAYER_ORDER, 'unclassified'] : [...LAYER_ORDER];
}

function layerOf(layer: Layer | undefined): CountedLayer {
  return layer !== undefined && LAYER_TABLE[layer] ? layer : 'unclassified';
}

/** How many cards sit in each layer. The three layers are always present, including zeros. */
export function layerCounts(layers: readonly (Layer | undefined)[]): LayerCount[] {
  const counts = new Map<CountedLayer, number>(LAYER_ORDER.map((layer) => [layer, 0]));
  for (const layer of layers) {
    const key = layerOf(layer);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return orderedLayers(counts.has('unclassified')).map((layer) => ({
    layer,
    count: counts.get(layer) ?? 0,
  }));
}

/**
 * Findings and distinct origin roots per layer. Two cards that share an origin root count
 * once in that layer and do not add a root to any other layer.
 */
export function layerFigures(
  items: readonly { layer?: Layer; originRoot: string }[],
): LayerFigure[] {
  const findings = new Map<CountedLayer, number>(LAYER_ORDER.map((layer) => [layer, 0]));
  const origins = new Map<CountedLayer, Set<string>>(
    LAYER_ORDER.map((layer) => [layer, new Set()]),
  );
  for (const item of items) {
    const key = layerOf(item.layer);
    findings.set(key, (findings.get(key) ?? 0) + 1);
    const roots = origins.get(key) ?? new Set<string>();
    roots.add(item.originRoot);
    origins.set(key, roots);
  }
  return orderedLayers(findings.has('unclassified')).map((layer) => ({
    layer,
    findings: findings.get(layer) ?? 0,
    origins: origins.get(layer)?.size ?? 0,
  }));
}
