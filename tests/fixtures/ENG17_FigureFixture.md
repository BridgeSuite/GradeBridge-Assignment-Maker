# ENG17: Homework 1

**Preamble:** Each circuit is drawn once and referred to by its problem number.

## Problem 1: Two-resistor divider

The circuit below is driven by $V_{in} = 10$ V.

```svg
<svg viewBox="0 0 240 120" xmlns="http://www.w3.org/2000/svg">
  <title>divider circuit for Problem 1</title>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5">
      <path d="M 0 0 L 10 5 L 0 10 z"/>
    </marker>
    <style>#arrow { fill: #000000 }</style>
  </defs>
  <path d="M 20 20 H 220 V 100 H 20 Z" fill="none" stroke="#000"
        marker-end="url(#arrow)"/>
  <text x="120" y="60">R1 = 1k, R2 = 2k, cost $5 each, $9 total</text>
</svg>
```

### (a) Divider ratio [30 pts] [text]
Find $V_{out}/V_{in}$ for the circuit shown.

> grader_note: Expect 2/3.

### (b) Power in R2 [20 pts] [text]
Find the power dissipated in R2.

> grader_note: Expect about 33 mW.

## Problem 2: The same divider, loaded

The textbook prints one drawing for both problems, so the figure below is the same one.

```svg
<svg viewBox="0 0 240 120" xmlns="http://www.w3.org/2000/svg">
  <title>divider circuit for Problem 1</title>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5">
      <path d="M 0 0 L 10 5 L 0 10 z"/>
    </marker>
    <style>#arrow { fill: #000000 }</style>
  </defs>
  <path d="M 20 20 H 220 V 100 H 20 Z" fill="none" stroke="#000"
        marker-end="url(#arrow)"/>
  <text x="120" y="60">R1 = 1k, R2 = 2k, cost $5 each, $9 total</text>
</svg>
```

### (a) Loaded output [20 pts] [text]
Repeat with a 1k load across R2.

> grader_note: Expect 0.5.

## Problem 3: Measured response

![measured magnitude response](data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==)

### (a) Corner frequency [20 pts] [text]
Read the corner frequency off the plot above.

> grader_note: Expect 1.6 kHz.

## Problem 4: No figure at all

### (a) State the assumption [10 pts] [text]
State the small-signal assumption in one sentence.

> grader_note: Any statement that the signal is small compared with the bias.
