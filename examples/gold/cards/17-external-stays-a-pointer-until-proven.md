---
id: '01M4X4H7G000000000000004WZ'
format: 2
collection: 'decisions'
type: 'rule'
title: 'External stays a pointer until proven'
author: 'human'
class: 'C'
worlds: ['Gold market']
synthetic: true
---

External stays a pointer until proven

## Rule

```json
{
  "when": [
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G000000000000004WB"
    },
    {
      "kind": "card_on_lage",
      "card": "01M4X4H7G000000000000004WF"
    }
  ],
  "then": "External stays a pointer until proven"
}
```
