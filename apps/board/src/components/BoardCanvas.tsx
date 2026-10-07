// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  type Connection,
  type NodeChange,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import type { Card, Lage, Stance } from '@worldbuilder/core';
import { toEdges, toNodes } from '../flowMapping.js';
import { CardNode, type CardNodeType } from './CardNode.js';
import { EdgeMarkers, KindEdge } from './KindEdge.js';

const nodeTypes = { card: CardNode };
const edgeTypes = { kind: KindEdge };

interface Props {
  lage: Lage;
  cards: ReadonlyMap<string, Card>;
  stances: ReadonlyMap<string, Stance>;
  selectedCardId: string | null;
  selectedEdgeKey: string | null;
  /** The user dropped a card at a new place. */
  onMove(cardId: string, x: number, y: number): void;
  /** The user drew a connection from one card to another. */
  onConnect(from: string, to: string): void;
  onSelect(selection: { cardId: string | null; edgeKey: string | null }): void;
}

function Canvas(props: Props) {
  const { lage, cards, stances, selectedCardId, selectedEdgeKey } = props;
  const derived = useMemo(
    () => toNodes(lage, cards, stances, selectedCardId),
    [lage, cards, stances, selectedCardId],
  );
  // Local node state lets a card follow the pointer during a drag; the Lage is the truth.
  const [nodes, setNodes] = useState<CardNodeType[]>(derived);
  useEffect(() => setNodes(derived), [derived]);
  const edges = useMemo(() => toEdges(lage, selectedEdgeKey), [lage, selectedEdgeKey]);

  const onNodesChange = (changes: NodeChange<CardNodeType>[]) =>
    setNodes((ns) => applyNodeChanges(changes, ns));
  const onConnect = (c: Connection) => {
    if (c.source && c.target) props.onConnect(c.source, c.target);
  };
  // Selection is mirrored into the canvas (\`selected\`), so the library's own answers can lag
  // behind it. Only a non-empty answer is taken (a click or Enter on a card or an edge); an
  // empty selection comes from a click on the empty pane, handled separately. This keeps the
  // two from ping-ponging.
  const onSelectionChange = ({ nodes: ns, edges: es }: OnSelectionChangeParams) => {
    if (ns.length === 0 && es.length === 0) return;
    const cardId = ns[0]?.id ?? null;
    const edgeKey = es[0]?.id ?? null;
    if (cardId !== selectedCardId || edgeKey !== selectedEdgeKey)
      props.onSelect({ cardId, edgeKey });
  };

  return (
    <div
      className="wb-canvas-wrap wb-canvas-fill"
      data-testid="board-canvas"
      role="region"
      aria-label="Board canvas"
    >
      <EdgeMarkers />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={(_e, node) => props.onMove(node.id, node.position.x, node.position.y)}
        onConnect={onConnect}
        onSelectionChange={onSelectionChange}
        onPaneClick={() => props.onSelect({ cardId: null, edgeKey: null })}
        deleteKeyCode={null}
        fitView
        aria-label="Cards and edges of this Lage"
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export function BoardCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
