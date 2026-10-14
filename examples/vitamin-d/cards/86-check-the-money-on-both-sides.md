---
id: '01M4X4H7G0000000000000002N'
format: 2
collection: 'decisions'
type: 'rule'
title: 'Check the money on both sides'
author: 'human'
class: 'C'
worlds: ['Vitamin D']
synthetic: true
---

Applies: the lab data come from a lab company whose staff wrote the paper. Grant declares funding from Bio-Tech Pharmacal. The authors of CORONAVIT, which found no reduction, declare funding from makers of vitamin D supplements. Kluge declares research support and fees from drug and medical-device companies. Nehls’ page points to his own book. We did not look further into either side.

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
      "card": "01M4X4H7G0000000000000000T"
    },
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G0000000000000001B"
    },
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G0000000000000001E"
    }
  ],
  "then": "Check the money on both sides"
}
```
