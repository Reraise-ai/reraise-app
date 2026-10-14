---
id: '01M4X4H7G0000000000000002J'
format: 2
collection: 'decisions'
type: 'rule'
title: 'Copies count once'
author: 'human'
class: 'C'
worlds: ['Vitamin D']
synthetic: true
---

Applies on both sides. McCullough repeats the meta-analysis. The German guideline group’s reply cites only the São Paulo trial. Nehls’ two cards are one voice. The Cochrane review adds no new patients: it weighs three trials that lie on this board themselves. We still count it once, as a judgement of its own. Grant and Wimalawansa both endorse the GrassrootsHealth call, but their two texts here are separate and count separately.

## Rule

```json
{
  "when": [
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G00000000000000019"
    },
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G00000000000000016"
    },
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G0000000000000001E"
    },
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G00000000000000008"
    },
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G00000000000000017"
    },
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G00000000000000018"
    }
  ],
  "then": "Copies count once"
}
```
