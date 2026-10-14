---
id: '01M4X4H7G0000000000000002M'
format: 2
collection: 'decisions'
type: 'rule'
title: 'A link is not a cause'
author: 'human'
class: 'C'
worlds: ['Vitamin D']
synthetic: true
---

Applies: the lab data and the Borsche calculation show that high levels and good outcomes go together. Neither shows that raising the level causes the outcome. Nehls writes “proven”.

## Rule

```json
{
  "when": [
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G0000000000000000J"
    },
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G00000000000000015"
    },
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G00000000000000018"
    }
  ],
  "then": "A link is not a cause"
}
```
