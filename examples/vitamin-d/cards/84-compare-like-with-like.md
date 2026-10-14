---
id: '01M4X4H7G0000000000000002K'
format: 2
collection: 'decisions'
type: 'rule'
title: 'Compare like with like'
author: 'human'
class: 'C'
worlds: ['Vitamin D']
synthetic: true
---

Applies: no card compares vitamin D with vaccination. The supporting studies measured positive tests, virus clearance, deaths across studies and intensive care. CORONAVIT tested lower doses than Nehls names. The claim is an inference across studies that each measured something else.

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
      "card": "01M4X4H7G0000000000000000K"
    },
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G00000000000000015"
    },
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G0000000000000001B"
    }
  ],
  "then": "Compare like with like"
}
```
