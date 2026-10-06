---
id: 01M1EYKMM0PW82HRM7RY5175E7
format: 2
collection: decisions
type: rule
title: Delay sailings if I believe the extension claim
author: human
class: C
worlds: [Hormuz]
synthetic: true
---

A rule that depends on my own stance. It is withheld from every target
except the screen.

## Rule

```json
{
  "when": [{ "kind": "stance", "card": "01M1E6JK80GR8G0JHMPVT7TDX4", "position": "believed" }],
  "then": "Delay sailings by two weeks"
}
```
