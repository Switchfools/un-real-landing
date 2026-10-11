---
title: "From belief to action"
description: "A publishing fixture for the essay layout."
date: "2026-09-23"
author: "Test author"
summary: "Start with the conclusion, the main reasons, and what follows. Keep this at 180 words or fewer."
draft: false
action: "Write down one assumption and test it this week."
---

This is test content, not a published essay. A belief can become a
**testable commitment** when we give it a concrete next step.

## Begin with a question

What would change your mind? Put the question in writing and examine it.

> Reflection should inform what we do next.

1. Name the assumption.
2. Choose a small experiment.
3. Share what you learn.

```diagram
{"title":"A repeatable cycle","nodes":[{"id":"idea","label":"Question an assumption"},{"id":"test","label":"Run a small experiment"}],"edges":[{"from":"idea","to":"test"}]}
```

```html
<details><summary>A useful next step</summary><p>Write down what would change your mind.</p></details>
```

```visualization
{"title":"Explore a small change","description":"Move the slider to explore an illustrative growth curve. This is a model, not a prediction.","height":260,"controls":[{"id":"growth","label":"Growth","type":"range","min":0.5,"max":2,"step":0.1,"value":1}],"code":"function render({width,height,values}) { const points=[]; for(let i=0;i<=50;i++){const x=i/50;points.push([20+x*(width-40),height-20-Math.pow(x,values.growth)*(height-40)]);} return {commands:[{type:'polyline',points,stroke:'#e5ad72',lineWidth:3}],caption:'Growth: '+values.growth}; }","fallback":{"commands":[{"type":"line","x1":20,"y1":240,"x2":620,"y2":20,"stroke":"#e5ad72","lineWidth":3}]}}
```
