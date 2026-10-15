---
id: '01M4X4H7G000000000000004X0'
format: 2
collection: 'decisions'
type: 'lage'
title: 'Gold market'
author: 'human'
class: 'C'
worlds: ['Gold market']
synthetic: true
question: 'Gold market'
version: 1
updatedAt: '2026-10-13T12:00:00Z'
---

## Position

```json
{
  "question": "Gold market",
  "options": [],
  "cards": [
    {
      "id": "01M4X4H7G000000000000004W9",
      "x": 20,
      "y": 302
    },
    {
      "id": "01M4X4H7G000000000000004WA",
      "x": 20,
      "y": 367
    },
    {
      "id": "01M4X4H7G000000000000004WB",
      "x": 20,
      "y": 432
    },
    {
      "id": "01M4X4H7G000000000000004WC",
      "x": 331,
      "y": 302
    },
    {
      "id": "01M4X4H7G000000000000004WD",
      "x": 331,
      "y": 367
    },
    {
      "id": "01M4X4H7G000000000000004WE",
      "x": 331,
      "y": 432
    },
    {
      "id": "01M4X4H7G000000000000004WF",
      "x": 331,
      "y": 497
    },
    {
      "id": "01M4X4H7G000000000000004WG",
      "x": 642,
      "y": 302
    },
    {
      "id": "01M4X4H7G000000000000004WH",
      "x": 642,
      "y": 367
    },
    {
      "id": "01M4X4H7G000000000000004WJ",
      "x": 642,
      "y": 432
    },
    {
      "id": "01M4X4H7G000000000000004WK",
      "x": 56,
      "y": 204
    },
    {
      "id": "01M4X4H7G000000000000004WM",
      "x": 176,
      "y": 204
    },
    {
      "id": "01M4X4H7G000000000000004WN",
      "x": 454,
      "y": 204
    },
    {
      "id": "01M4X4H7G000000000000004WP",
      "x": 20,
      "y": 640
    },
    {
      "id": "01M4X4H7G000000000000004WQ",
      "x": 220,
      "y": 640
    },
    {
      "id": "01M4X4H7G000000000000004WR",
      "x": 420,
      "y": 640
    },
    {
      "id": "01M4X4H7G000000000000004WS",
      "x": 620,
      "y": 640
    },
    {
      "id": "01M4X4H7G000000000000004WT",
      "x": 820,
      "y": 640
    },
    {
      "id": "01M4X4H7G000000000000004WV",
      "x": 1020,
      "y": 640
    },
    {
      "id": "01M4X4H7G000000000000004WW",
      "x": 1220,
      "y": 640
    }
  ],
  "seats": [
    {
      "name": "Player",
      "kind": "human"
    },
    {
      "name": "research",
      "kind": "agent"
    },
    {
      "name": "rebuttal",
      "kind": "agent"
    },
    {
      "name": "market-data",
      "kind": "agent"
    }
  ],
  "edges": [
    {
      "from": "01M4X4H7G000000000000004WM",
      "to": "01M4X4H7G000000000000004W9",
      "kind": "supports",
      "by": "agent:research"
    },
    {
      "from": "01M4X4H7G000000000000004WJ",
      "to": "01M4X4H7G000000000000004WF",
      "kind": "refutes",
      "by": "agent:rebuttal"
    },
    {
      "from": "01M4X4H7G000000000000004WC",
      "to": "01M4X4H7G000000000000004WD",
      "kind": "relation",
      "by": "agent:research"
    },
    {
      "from": "01M4X4H7G000000000000004WE",
      "to": "01M4X4H7G000000000000004WM",
      "kind": "relation",
      "by": "human"
    }
  ]
}
```
