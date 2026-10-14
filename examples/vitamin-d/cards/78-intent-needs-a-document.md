---
id: '01M4X4H7G0000000000000002D'
format: 2
collection: 'decisions'
type: 'rule'
title: 'Intent needs a document'
author: 'human'
class: 'C'
worlds: ['Vitamin D']
synthetic: true
---

Unclear: Nehls infers intent from the design of the trial. We found no document that shows it. The calendar speaks against a counter-strike. The São Paulo paper does not cite Córdoba; that alone says nothing about intent.

## Rule

```json
{
  "when": [
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G00000000000000005"
    },
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G0000000000000000C"
    },
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G0000000000000000E"
    }
  ],
  "then": "Intent needs a document"
}
```
