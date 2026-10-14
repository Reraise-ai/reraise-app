---
id: '01M4X4H7G000000000000004WY'
format: 2
collection: 'decisions'
type: 'rule'
title: 'Never trade against central banks'
author: 'human'
class: 'C'
worlds: ['Gold market']
synthetic: true
---

Never trade against central banks

## Rule

```json
{
  "when": [
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G000000000000004W9"
    },
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G000000000000004WJ"
    }
  ],
  "then": "Never trade against central banks"
}
```
