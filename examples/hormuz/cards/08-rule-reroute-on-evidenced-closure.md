---
id: 01M1EV5S00YXKKGEG772AZM7P9
format: 2
collection: decisions
type: rule
title: Reroute when restrictions are evidenced
author: human
class: C
worlds: [Hormuz]
synthetic: true
---

My rule: if the restriction is evidenced and nothing on the board refutes
it, I reroute.

## Rule

```json
{
  "when": [
    { "kind": "card_on_lage", "card": "01M1E34QM03WVTE8T1RYS3AM18" },
    {
      "kind": "card_field",
      "card": "01M1E34QM03WVTE8T1RYS3AM18",
      "field": "layer",
      "equals": "evidenced"
    }
  ],
  "then": "Reroute laden tankers via the Cape of Good Hope",
  "unless": [{ "kind": "edge", "edgeKind": "refutes", "to": "01M1E34QM03WVTE8T1RYS3AM18" }]
}
```
