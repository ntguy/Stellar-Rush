/* pickup-layouts.js — superseded.
   All pickup slot definitions are now inlined in patterns.js.
   FORCE_PATTERN has moved to the top of patterns.js.
   This file is no longer imported anywhere and can be deleted. */

/* ═══════════════════════════════════════════════════════════
   SLOT SPEC FORMAT
   ─────────────────────────────────────────────────────────
   Slots are *descriptors* — they record intent and variance
   ranges. Actual world positions are randomised at spawn
   time by _evaluateSpec() in patterns.js.

   ── Single pickup ─────────────────────────────────────────
   S({ x, y, xV?, yV? })
     x, y   — anchor position (centre of spawn area)
     xV     — ±variance on x (shifts the pickup left/right)
     yV     — ±variance on y (shifts the pickup up/down)

   ── Formation (chain of small pickups) ────────────────────
   F({ x, y, dx, dy, count?, xV?, yV?, dxV?, dyV?, countV? })
     x, y      — anchor for the FIRST pickup in the chain
     dx, dy    — world-unit step between consecutive pickups
                 e.g. dx=0,dy=3  → vertical chain stepping up
                      dx=3,dy=0  → horizontal chain stepping right
     count     — base number of pickups (default 4)
     xV        — ±variance on x  (shifts whole chain sideways)
     yV        — ±variance on y  (shifts whole chain up/down)
     dxV       — ±variance on dx (changes horizontal spread/direction)
     dyV       — ±variance on dy (changes vertical spread/direction)
     countV    — ±variance on count (e.g. countV:1 → chain is 3-5 long)

   ── Tuning tips ───────────────────────────────────────────
   • Keep |dx|*(count+countV) inside BOUNDS_X from the anchor,
     and |dy|*(count+countV) inside BOUNDS_Y. _evaluateSpec()
     clamps each pickup individually but it's better to author
     formations that stay in bounds naturally.
   • xV/yV shift the whole chain — good for variety between waves.
   • dxV/dyV change the direction per-spawn — creates organic drift.
   • A formation anchored at y=-10 should have dy ≥ 0 (upward/flat)
     so it doesn't escape below the screen (BOUNDS_Y = 16, so y<-16
     is off-screen). _evaluateSpec() will guard against this.
   ═══════════════════════════════════════════════════════════ */

/** Single-pickup slot spec. */
const S = ({ x, y, xV = 0, yV = 0 }) =>
    ({ type: 'single', x, y, z: SPAWN_Z, xV, yV });

/** Formation slot spec. */
const F = ({ x, y, dx, dy, count = 4, xV = 0, yV = 0, dxV = 0, dyV = 0, countV = 0 }) =>
    ({ type: 'formation', x, y, z: SPAWN_Z, dx, dy, count, xV, yV, dxV, dyV, countV });

export { S, F };   // exposed so patterns.js can construct inline runtime slots

/* ═══════════════════════════════════════════════════════════
   PICKUP LAYOUTS
   ─────────────────────────────────────────────────────────
   One array per pattern. Each element = one step's worth of
   slot specs (index cycles if pattern produces more steps).

   World bounds: BOUNDS_X = 24  (±x),  BOUNDS_Y = 16  (±y)
   ═══════════════════════════════════════════════════════════ */
export const PICKUP_LAYOUTS = {

    /* ── patternLeftRight ──────────────────────────────────
       Walls alternate left (step 0) then right (step 1).
       Open space is always on the OPPOSITE side of the wall.

       Open space reference:
         step 0 (left wall):  roughly x ≈ +5 … +22
         step 1 (right wall): roughly x ≈ -5 … -22               */
    patternLeftRight: [
        // step 0: left wall  →  open RIGHT
        [
            // Vertical chain in the open right region.
            // xV=4 shifts the whole chain ±4 units so it doesn't always feel centred.
            // dyV=1 gives the per-step size a little organic variation.
            // countV=1 means chain length varies between 3 and 5.
            F({ x:  10, y:  0, dx:  0, dy:  3, count: 4, xV: 4, yV: 40, dxV: 0.5, dyV: 1, countV: 1 }),
            // Bonus single near the far-right edge.
            S({ x: 18, y: 0, xV: 2, yV: 6 }),
        ],
        // step 1: right wall  →  open LEFT
        [
            // Mirror: chain in the open left region (upward, dy positive).
            F({ x: -10, y:  0, dx:  0, dy:  3, count: 4, xV: 4, yV: 3, dxV: 0.5, dyV: 0.5, countV: 1 }),
            S({ x: -18, y: 0, xV: 2, yV: 6 }),
        ],
    ],

    /* ── patternTopDown ────────────────────────────────────
       Bars alternate from top (step 0) and bottom (step 1).
       Open space is on the OPPOSITE side of the bar.

       Open space reference:
         step 0 (top bar):    y ≈ -2 … -14
         step 1 (bottom bar): y ≈ +2 … +14                        */
    patternTopDown: [
        // step 0: top bar  →  open BELOW
        [
            // Horizontal chain sweeping rightward through the lower half.
            // yV=3 keeps it from feeling locked to y=-6.
            F({ x:  0, y: -6, dx:  3, dy:  0, count: 4, xV: 5, yV: 3, dxV: 0.5, dyV: 0.3, countV: 1 }),
            // Short diagonal drifting down-right (dy negative = downward; safe since y starts at -5).
            // Capped to 3 pickups so it doesn't exit the bottom.
            F({ x: -8, y: -5, dx:  2, dy: -1, count: 3, xV: 2, yV: 2, dxV: 0.4, dyV: 0.3, countV: 1 }),
            S({ x:  9, y: -9, xV: 3, yV: 3 }),
            S({ x: -9, y: -9, xV: 3, yV: 3 }),
        ],
        // step 1: bottom bar  →  open ABOVE
        [
            F({ x:  0, y:  6, dx: -3, dy:  0, count: 4, xV: 5, yV: 3, dxV: 0.5, dyV: 0.3, countV: 1 }),
            F({ x:  8, y:  5, dx: -2, dy:  1, count: 3, xV: 2, yV: 2, dxV: 0.4, dyV: 0.3, countV: 1 }),
            S({ x: -9, y:  9, xV: 3, yV: 3 }),
            S({ x:  9, y:  9, xV: 3, yV: 3 }),
        ],
    ],

    /* ── patternCorners ────────────────────────────────────
       Side wall + horizontal bar in a corner config.
       Open quadrant cycles through 4 combos (one per step pair).

       Open quadrant reference:
         combo 0: BOTTOM-RIGHT  (x > 0, y < 0)
         combo 1: TOP-LEFT      (x < 0, y > 0)
         combo 2: TOP-RIGHT     (x > 0, y > 0)
         combo 3: BOTTOM-LEFT   (x < 0, y < 0)                    */
    patternCorners: [
        // combo 0: left wall + top bar  →  open BOTTOM-RIGHT
        [
            // Diagonal drifting toward bottom-right of the open quadrant.
            F({ x:  9, y: -6, dx:  1.5, dy: -1.5, count: 4, xV: 2, yV: 2, dxV: 0.4, dyV: 0.4, countV: 1 }),
            S({ x: 15, y: -9, xV: 3, yV: 2 }),
        ],
        // combo 1: right wall + bottom bar  →  open TOP-LEFT
        [
            F({ x: -9, y:  6, dx: -1.5, dy:  1.5, count: 4, xV: 2, yV: 2, dxV: 0.4, dyV: 0.4, countV: 1 }),
            S({ x: -15, y:  9, xV: 3, yV: 2 }),
        ],
        // combo 2: left wall + bottom bar  →  open TOP-RIGHT
        [
            F({ x:  9, y:  6, dx:  1.5, dy:  1.5, count: 4, xV: 2, yV: 2, dxV: 0.4, dyV: 0.4, countV: 1 }),
            S({ x: 15, y:  9, xV: 3, yV: 2 }),
        ],
        // combo 3: right wall + top bar  →  open BOTTOM-LEFT
        [
            F({ x: -9, y: -6, dx: -1.5, dy: -1.5, count: 4, xV: 2, yV: 2, dxV: 0.4, dyV: 0.4, countV: 1 }),
            S({ x: -15, y: -9, xV: 3, yV: 2 }),
        ],
    ],

    /* ── patternScatter ────────────────────────────────────
       Lone random blocks. The spawner also computes dynamic
       slots from block position at runtime (used as override).
       This table is the fallback.                              */
    patternScatter: [
        [
            // Broad diagonal across from somewhere near centre.
            // Large xV/yV give it a wide variety of positions.
            F({ x:  0, y:  0, dx:  2, dy:  1, count: 4, xV: 7, yV: 6, dxV: 0.5, dyV: 0.5, countV: 2 }),
            S({ x: -6, y:  3, xV: 5, yV: 5 }),
            S({ x:  6, y: -3, xV: 5, yV: 5 }),
        ],
        [
            F({ x:  0, y:  0, dx: -2, dy:  1, count: 4, xV: 7, yV: 6, dxV: 0.5, dyV: 0.5, countV: 2 }),
            S({ x:  6, y:  3, xV: 5, yV: 5 }),
            S({ x: -6, y: -3, xV: 5, yV: 5 }),
        ],
    ],

    /* patternNarrow | patternShiftingGates | patternSlalomGate:
       These patterns return computed slots directly from their
       step closures in patterns.js — no lookup table needed.    */
};
