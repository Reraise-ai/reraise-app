---
id: '01M4X4H7G0000000000000002F'
format: 2
collection: 'decisions'
type: 'rule'
title: 'Only advertising as proof'
author: 'human'
class: 'C'
worlds: ['Vitamin D']
synthetic: true
---

Does not apply: some supporters declare ties to supplement makers or to a lab company, but the supporting side also has lab data and a trial on the PROVEN layer.

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
      "card": "01M4X4H7G0000000000000000X"
    }
  ],
  "then": "Only advertising as proof"
}
```
