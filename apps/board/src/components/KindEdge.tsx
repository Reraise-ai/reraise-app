// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';

export type KindEdgeData = { kind: string; by: string };
export type KindEdgeType = Edge<KindEdgeData, 'kind'>;

/** Arrowhead markers in tokens; SVG presentation attributes cannot hold var(), CSS can. */
export function EdgeMarkers() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        {(['supports', 'refutes'] as const).map((kind) => (
          <marker
            key={kind}
            id={`wb-arrow-${kind}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" className={`wb-arrow--${kind}`} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

/** One custom edge type for the kinds the board draws; the kind is a text label and a stroke. */
export function KindEdge(props: EdgeProps<KindEdgeType>) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const kind = data?.kind ?? 'unspecified';
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        className={`wb-edge--${kind}`}
        markerEnd={`url(#wb-arrow-${kind})`}
        interactionWidth={20}
      />
      <EdgeLabelRenderer>
        <div
          className="wb-badge"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          {kind}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
