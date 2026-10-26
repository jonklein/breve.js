---
title: Why our evolved creatures learned to cheat
date: 2026-10-26
summary: We evolved bodies and brains, and within a few generations the best "walkers" were throwing themselves into the air. What we found when we took it apart.
draft: true
---

We built a small version of Karl Sims' evolving creatures: a population of walkers, each with a body made of blocks and a small neural network for a brain, bred for how far they get. Within a few generations the winners were not walking. They were launching themselves.

This is a draft written from our notes; edit it freely.

## The obvious suspect was wrong

The first guess was strength. Hinge motors had no torque limit, so a brain that jumped its joint targets around could push as hard as it liked. We capped torque by the cross-section of each limb and by the load it carried, and eased the targets over time. The launching dropped, but did not stop.

## A body with no motors still got thrown

Stripping a thrown creature down to its bones showed the real cause. A passive body, with no motors and no brain, jittered at tens of metres a second as soon as a thin, light block hung off another light block off a heavy trunk. Solver iterations, substeps, damping and contact settings made no difference.

What did: a floor on how easily each part can spin. Very light, thin boxes have almost no rotational inertia, and the joint solver whips them around. Raising each part to at least the inertia of a body with a 0.3 metre radius of gyration took the failure rate on 150 random creatures from 5 to 0.

## Is it the physics engine?

Not in the sense of a bug. The engine is deterministic and the same creature fails the same way every time. This is a known weakness of impulse-based joints with tiny inertias. We added a second engine, MuJoCo, to compare: on the same random bodies it did not throw any creature even without the floor, and ran about four times faster per tick.

## What we took from it

Evolution finds whatever the simulation allows. Every unrealistic force, instant target change or degenerate mass ratio is a free lunch it will eventually eat. Guard the physics, not just the score.
