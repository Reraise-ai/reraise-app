---
id: '01M4X4H7G0000000000000002H'
format: 2
collection: 'decisions'
type: 'rule'
title: 'A range needs a trial'
author: 'human'
class: 'C'
worlds: ['Vitamin D']
synthetic: true
---

Unclear: no card shows a trial that compares people kept at 60 ng/ml with people kept at 30. The one trial here has 40 people. The lab data stop falling at 55. We have not yet searched for such a trial.

## Rule

```json
{
  "when": [
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G0000000000000000K"
    },
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G0000000000000000J"
    },
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G0000000000000000R"
    }
  ],
  "then": "A range needs a trial"
}
```
