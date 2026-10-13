// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright The Worldbuilder contributors
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { Card, Stance } from '@worldbuilder/core';

export type CardNodeData = {
  cardId: string;
  /** Absent when the card is not readable for the screen (withheld by the gate or missing). */
  card?: Card;
  /** The user's own stance: a private overlay on this screen only (ADR-0008). */
  stance?: Stance;
};
export type CardNodeType = Node<CardNodeData, 'card'>;

export const LAYER_LABEL = {
  evidenced: 'Evidenced',
  said: 'Said',
  experience: 'Experience',
} as const;

export function layerOf(card: Card | undefined): keyof typeof LAYER_LABEL | 'unclassified' {
  return card?.layer ?? 'unclassified';
}

export const isAgentAuthor = (author: string | undefined): author is string =>
  typeof author === 'string' && author.startsWith('agent:');

/**
 * A card on the board. The stored content type and the layer are each a text badge (never colour
 * alone); an agent-authored card carries its author; the origin system is the store's
 * `originSystem` when the card has one; the stance is the user's own overlay.
 */
export function CardNode({ data, selected }: NodeProps<CardNodeType>) {
  const { card, cardId, stance } = data;
  const layer = layerOf(card);
  const layerLabel = layer === 'unclassified' ? 'unclassified' : LAYER_LABEL[layer];
  const title = card?.title ?? 'Card not shown on this screen';
  const system = card?.originSystem ? `, ${card.originSystem}` : '';
  return (
    <div
      className="wb-card"
      data-testid={`card-node-${cardId}`}
      data-layer={layer}
      data-withheld={card ? undefined : 'true'}
      data-selected={selected ? 'true' : 'false'}
      role="group"
      aria-label={
        card ? `${title}, ${card.type}, ${layerLabel}${system}` : `${title}, ${layerLabel}`
      }
    >
      <Handle type="target" position={Position.Left} aria-hidden="true" />
      <div className="wb-card-title">{title}</div>
      <div>
        {card && (
          <span className="wb-badge" data-testid={`card-type-${cardId}`}>
            {card.type}
          </span>
        )}
        <span className="wb-badge" data-kind={layer} data-testid={`card-layer-${cardId}`}>
          {layer === 'unclassified' ? 'Unclassified' : LAYER_LABEL[layer]}
        </span>
        {isAgentAuthor(card?.author) && (
          <span className="wb-badge" data-kind="agent" data-testid={`card-author-${cardId}`}>
            {card?.author}
          </span>
        )}
      </div>
      {card?.source && <div className="wb-muted">{card.source}</div>}
      {card?.originSystem && (
        <div className="wb-muted" data-testid={`card-origin-${cardId}`}>
          System: {card.originSystem}
        </div>
      )}
      {stance && (
        <div className="wb-stance" data-testid={`card-stance-${cardId}`}>
          You: {stance.position}, weight {stance.weight}
        </div>
      )}
      <Handle type="source" position={Position.Right} aria-hidden="true" />
    </div>
  );
}
