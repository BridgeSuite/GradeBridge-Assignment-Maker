# ENG17: Homework 9

**Input:** handwritten

**Preamble:** Show your working and give every numerical answer with its unit.

<!--
  A 200-POINT ASSIGNMENT — the shape of the real ENG17 homeworks.

  The `.md` carries already-scaled values, so its own sum is the intended total.
  `parseMdToAssignment` adopts it as `targetPoints`; before 2026-09-01 it did
  not, `normalizePoints` fell back to its 100 default, and importing this file
  and pressing Export halved every part with nothing on screen to say why.

  The point values below are deliberately NOT all equal: an apportionment to 100
  would have to round, so a silent rescale is visible part by part and not only
  in the total.
-->

## Problem 1: Node analysis

### (a) Node equations [40 pts] [handwritten]
Write the node-voltage equations for the network.

> template: lines=12

> grading_prompt: Required elements: (1) one equation per unknown node; (2) consistent sign convention.

### (b) Solve [35 pts] [handwritten]
Solve for the node voltages.

> template: lines=10

> grading_prompt: Required elements: (1) the numeric values; (2) units.

## Problem 2: Thevenin equivalent

### (a) Open-circuit voltage [45 pts] [handwritten]
Find the open-circuit voltage at the terminals.

> template: lines=8

> grading_prompt: Required elements: (1) the value; (2) the reference polarity.

### (b) Equivalent resistance [35 pts] [handwritten:human]
Find the Thevenin resistance seen at the terminals.

> template: lines=6

> grader_note: Sources suppressed correctly; the value follows in one step.

### (c) Sketch the equivalent [45 pts] [handwritten:human]
Draw the Thevenin equivalent circuit with both element values labelled.

> template: lines=10, sketch

> grader_note: One source, one resistor, both labelled, correct polarity.
