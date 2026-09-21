# Cube Theory

Cube Theory is an interactive Rubik's Cube explorer and solver for cubes from 2×2 through 9×9. It combines a conventional 3D cube with a responsive sticker-ring graph, synchronized move playback, worker-based solving for 2×2 through 4×4, and a bounded visualization of the 2×2 search space.

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

### Reduction-based 4×4 solver

- Solves center blocks, pairs wing edges, corrects flip and permutation parity, and projects the reduced state into the existing 3×3 solver.
- Lifts the virtual 3×3 solution back into legal 4×4 moves.
- Reports each reduction stage in the interface and verifies the complete facelet replay before playback.
- Uses bounded searches, qualified terminal algorithms, watchdog timeouts, and explicit recovery messages when a position exceeds supported resource limits.
- Cancels stale work safely when the cube, size, scramble, reset state, or timeline changes.

### Search visualization

- Displays a sparse, representative view of the 2×2 exact-table exploration while retaining the full bounded telemetry sample.
- Supports radial and force-directed layouts.
- Replaces the build sample with the verified distance-descending path during a warm solve.
- Caps telemetry at roughly 3,000 nodes to keep rendering and worker communication responsive.
- Uses topology-aware ordering, concentric distance guides, and cube-colored nodes to keep moves readable.
- Highlights the final solution path independently of sampled exploration edges.

## Current status

| Slice | Scope | Status |
|---|---|---|
| 1 | Cube model, manual moves, 3D and ring views, shared playback | Complete |
| 2 | Exact 2×2 solver | Complete |
| 3 | Two-phase 3×3 solver | Complete |
| 4 | Bounded 2×2 search visualization | Complete |
| 5 | Reduction-based 4×4 solving with parity handling | Complete |
| 6 | Reduction-based solving for 5×5–9×9 | Planned |

Cubes from 5×5 through 9×9 currently support responsive visualization, manual moves, and scrambling. Automated solving for those sizes is not implemented yet.

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

The default suite contains 116 tests covering:

- cube geometry, permutations, notation, and state transitions;
- timeline playback and synchronization;
- sticker-ring layout;
- exact 2×2 coordinates and seeded solves;
- 3×3 coordinates, pruning tables, and reproducible solves;
- bounded search telemetry and solution-path retention;
- 4×4 center solving, edge pairing, parity correction, projection, and end-to-end reduction;
- worker cancellation, timeouts, recovery, and stale-response handling.

An additional opt-in release corpus contains 220 longer-running 4×4 cases:

```bash
npm run test:release
```

## Deploy to Vercel

The project is a standard Vite static deployment with no required environment variables.

1. Import the repository into Vercel.
2. Keep the detected **Vite** framework preset.
3. Use `npm run build` as the build command and `dist` as the output directory if Vercel does not fill them automatically.

The module worker, fonts, and paper texture are bundled by Vite during the production build.

## Project structure

```text
src/
  core/       Cube geometry, state, notation, moves, and scrambling
  rings/      Sticker-ring layout and rendering
  search/     Search-graph layout and visualization
  solvers/    2×2 exact, 3×3 two-phase, and 4×4 reduction solvers; telemetry and worker lifecycle
  timeline/   Shared move playback state
  view3d/     Three.js cube rendering
  main.ts     Application wiring and worker integration
tests/        Unit and solver verification tests
```

## Implementation notes

- Cube states are represented as facelet-color arrays.
- Moves are generated as reusable sticker permutations for any supported size.
- Expensive solver initialization and search run in a module Web Worker.
- The worker client enforces initialization and solve watchdogs and recreates a failed or cancelled worker.
- Request IDs and state checks reject stale solver results after cube changes.
- Long solutions are prepared asynchronously, then applied only if the initiating cube state is still current.
- Final solutions are applied to a copy of the initiating state and must produce uniform faces before playback is allowed.

## Technology

- TypeScript
- Vite
- Three.js
- Vitest
