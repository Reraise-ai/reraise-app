---
id: '01M4X4H7G000000000000004WX'
format: 2
collection: 'decisions'
type: 'rule'
title: 'Geopolitics beats markets'
author: 'human'
class: 'C'
worlds: ['Gold market']
synthetic: true
---

Geopolitics beats markets

## Rule

```json
{
  "when": [
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G000000000000004WE"
    },
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G000000000000004WM"
    }
  ],
  "then": "Geopolitics beats markets"
}
```
