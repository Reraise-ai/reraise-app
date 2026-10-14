---
id: '01M4X4H7G0000000000000002G'
format: 2
collection: 'decisions'
type: 'rule'
title: 'Compare like with like'
author: 'human'
class: 'C'
worlds: ['Vitamin D']
synthetic: true
---

Applies: the two sides answer different questions. The NIH calls 20 ng/ml adequate “for bone and overall health in healthy individuals”. Lamkin says 30 prevents bone disease but is not the level for optimal immune function. The Endocrine Society looked at preventing disease and found no clear evidence for a target.

## Rule

```json
{
  "when": [
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G0000000000000000Y"
    },
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G0000000000000000M"
    },
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G0000000000000000W"
    }
  ],
  "then": "Compare like with like"
}
```
