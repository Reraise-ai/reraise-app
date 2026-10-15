---
id: '01M4X4H7G0000000000000002A'
format: 2
collection: 'decisions'
type: 'rule'
title: 'Copies count once'
author: 'human'
class: 'C'
worlds: ['Vitamin D']
synthetic: true
---

Applies: the three posts on the maker’s website, the MIT recalculation and Nehls’ case for vitamin D all rest on the same 76 patients in Córdoba. Together with the trial they are one origin.

## Rule

```json
{
  "when": [
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G00000000000000004"
    },
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G00000000000000003"
    },
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G00000000000000005"
    }
  ],
  "then": "Copies count once"
}
```
