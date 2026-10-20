// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useNodesInitialized,
  useReactFlow,
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
  /** A past board is shown. Cards stay put and new edges are not drawn. */
  readOnly?: boolean;
}

/** Space between the top of the canvas and the highest card after a fit, in screen pixels. */
export const FIT_TOP_GAP = 16;

/**
 * Fits all cards into view and aligns them to the top: the board starts right under the status
 * line instead of floating in the middle of a tall canvas. Across, the cards stay centred.
 */
function useTopFit() {
  const { fitView, getNodes, getNodesBounds, getViewport, setViewport } = useReactFlow();
  return useCallback(async () => {
    await fitView({ padding: 0.1 });
    const nodes = getNodes();
    if (nodes.length === 0) return;
    const bounds = getNodesBounds(nodes);
    const { x, zoom } = getViewport();
    await setViewport({ x, y: FIT_TOP_GAP - bounds.y * zoom, zoom });
  }, [fitView, getNodes, getNodesBounds, getViewport, setViewport]);
}

/**
 * Fits the cards into view once they are measured, and again when the canvas changes size,
 * until the user pans or zooms. A host that lays out or resizes its window afterwards (an
 * embedding app, a restored window) otherwise leaves the cards off with an empty band above
 * or beside them.
 */
function useRefitOnResize() {
  const fitTop = useTopFit();
  const initialized = useNodesInitialized();
  const wrapRef = useRef<HTMLDivElement>(null);
  const userMoved = useRef(false);
  const fitted = useRef(false);
  useEffect(() => {
    if (!initialized || fitted.current) return;
    fitted.current = true;
    void fitTop();
  }, [initialized, fitTop]);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let last = '';
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box || box.width === 0 || box.height === 0) return;
      const size = `${Math.round(box.width)}x${Math.round(box.height)}`;
      if (size === last) return;
      const first = last === '';
      last = size;
      if (!first && !userMoved.current && fitted.current) void fitTop();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fitTop]);
  const markMoved = () => {
    userMoved.current = true;
  };
  // A pan or wheel zoom by the user carries an event; a programmatic fit and the zoom buttons
  // do not, so the buttons mark the move themselves.
  const onMoveStart = (event: MouseEvent | TouchEvent | null) => {
    if (event) markMoved();
  };
  return { wrapRef, onMoveStart, markMoved };
}

function Canvas(props: Props) {
  const { wrapRef, onMoveStart, markMoved } = useRefitOnResize();
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
    if (props.readOnly) return;
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
      ref={wrapRef}
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
        nodesDraggable={!props.readOnly}
        nodesConnectable={!props.readOnly}
        onNodesChange={onNodesChange}
        onNodeDragStop={(_e, node) => {
          if (!props.readOnly) props.onMove(node.id, node.position.x, node.position.y);
        }}
        onConnect={onConnect}
        onSelectionChange={onSelectionChange}
        onPaneClick={() => props.onSelect({ cardId: null, edgeKey: null })}
        onMoveStart={onMoveStart}
        deleteKeyCode={null}
        aria-label="Cards and edges of this Lage"
      >
        <Background />
        <Controls showInteractive={false} onZoomIn={markMoved} onZoomOut={markMoved} />
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
