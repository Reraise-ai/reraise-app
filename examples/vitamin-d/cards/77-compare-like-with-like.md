---
id: '01M4X4H7G0000000000000002C'
format: 2
collection: 'decisions'
type: 'rule'
title: 'Compare like with like'
author: 'human'
class: 'C'
worlds: ['Vitamin D']
synthetic: true
---

Applies: Córdoba gave calcifediol on the day of admission and again later. São Paulo gave vitamin D3 once. The two trials did not test the same thing.

## Rule

```json
{
  "when": [
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G00000000000000002"
    },
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G00000000000000008"
    },
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G00000000000000006"
    }
  ],
  "then": "Compare like with like"
}
```
