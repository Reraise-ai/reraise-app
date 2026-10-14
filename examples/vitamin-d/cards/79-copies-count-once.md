---
id: '01M4X4H7G0000000000000002E'
format: 2
collection: 'decisions'
type: 'rule'
title: 'Copies count once'
author: 'human'
class: 'C'
worlds: ['Vitamin D']
synthetic: true
---

Applies: the GrassrootsHealth call, Grant’s paper, Holick and the Wimalawansa interview are connected. Grant, Holick and Wimalawansa are on the call’s list of endorsing scientists, four of Grant’s co-authors are from GrassrootsHealth, and the Wimalawansa text comes from there. Together they are one origin. Holick is also a co-author of the lab-data paper. We still count that paper as its own origin, because its data are its own.

## Rule

```json
{
  "when": [
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G0000000000000000S"
    },
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G0000000000000000T"
    },
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G0000000000000000V"
    },
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G0000000000000000N"
    }
  ],
  "then": "Copies count once"
}
```
