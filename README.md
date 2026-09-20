# Cube Theory

Cube Theory is an interactive Rubik's Cube explorer and solver for cubes from 2×2 through 9×9. It combines a conventional 3D cube with a sticker-ring graph view, synchronized move playback, worker-based solving, and a bounded visualization of the 2×2 search space.

## What is implemented

### Interactive cubes from 2×2 to 9×9

- Render and manipulate cube sizes from N = 2 through N = 9.
- Apply outer-face and inner-layer turns using move notation.
- Generate reproducible 25-move scrambles.
- Keep the 3D cube and sticker-ring view synchronized through one timeline controller.
- Step forward or backward through moves, pause playback, and adjust playback speed.

### Optimal 2×2 solver

- Builds an exact distance table in a Web Worker.
- Returns optimal solutions of at most 11 half-turn-metric moves.
- Reuses the completed table for fast subsequent solves.
- Verifies every returned move sequence against the original sticker state before playback.

### Two-phase 3×3 solver

- Uses a worker-owned Kociemba-style two-phase search.
- Builds coordinate and pruning tables outside the UI thread.
- Reports table-building and search progress in the interface.
- Normalizes the center frame so legal middle-slice states can be solved correctly.
- Verifies solutions before adding them to the shared playback timeline.

### Search visualization

- Displays a bounded sample of the 2×2 exact-table exploration.
- Supports radial and force-directed layouts.
- Replaces the build sample with the verified distance-descending path during a warm solve.
- Caps telemetry at roughly 3,000 nodes to keep rendering and worker communication responsive.
- Highlights the final solution path independently of sampled exploration edges.

## Current status

| Slice | Scope | Status |
|---|---|---|
| 1 | Cube model, manual moves, 3D and ring views, shared playback | Complete |
| 2 | Exact 2×2 solver | Complete |
| 3 | Two-phase 3×3 solver | Complete |
| 4 | Bounded 2×2 search visualization | Complete |
| 5 | Reduction-based solving for 4×4–9×9 | Planned |

Cubes from 4×4 through 9×9 currently support visualization, manual moves, and scrambling. Automated solving for these sizes is not implemented yet. The planned reduction pipeline will solve centers, pair edges, correct parity, and pass the reduced state to the existing 3×3 solver.

## Run locally

Requirements: a current Node.js release and npm.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite, normally <http://localhost:5173>.

## Quality checks

```bash
npm test
npm run build
```

The current suite contains 36 tests covering:

- cube geometry, permutations, notation, and state transitions;
- timeline playback and synchronization;
- sticker-ring layout;
- exact 2×2 coordinates and seeded solves;
- 3×3 coordinates, pruning tables, and reproducible solves;
- bounded search telemetry and solution-path retention.

## Project structure

```text
src/
  core/       Cube geometry, state, notation, moves, and scrambling
  rings/      Sticker-ring layout and rendering
  search/     Search-graph layout and visualization
  solvers/    2×2 solver, 3×3 two-phase solver, telemetry, and worker entry
  timeline/   Shared move playback state
  view3d/     Three.js cube rendering
  main.ts     Application wiring and worker integration
tests/        Unit and solver verification tests
```

## Implementation notes

- Cube states are represented as facelet-color arrays.
- Moves are generated as reusable sticker permutations for any supported size.
- Expensive solver initialization and search run in a module Web Worker.
- Request IDs and state checks reject stale solver results after cube changes.
- Final solutions are applied to a copy of the initiating state and must produce uniform faces before playback is allowed.

## Technology

- TypeScript
- Vite
- Three.js
- Vitest

