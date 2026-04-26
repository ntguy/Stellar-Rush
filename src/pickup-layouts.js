import { BOUNDS_X, BOUNDS_Y, SPAWN_Z } from './config.js';

/* ═══════════════════════════════════════════════════════════
   TESTING CONTROL
   ─────────────────────────────────────────────────────────
   Set FORCE_PATTERN to a pattern name to lock the game to
   only that obstacle pattern. Set to null for normal rotation.

   Valid values:
     'patternLeftRight' | 'patternTopDown'    | 'patternCorners'
     'patternShiftingGates' | 'patternNarrow' | 'patternSlalomGate'
     'patternBars'          | 'patternScatter'
   ═══════════════════════════════════════════════════════════ */
export const FORCE_PATTERN = null; // e.g. 'patternNarrow'

/* ─── Slot format ─────────────────────────────────────────
   { type, x, y, z, dx?, dy?, count? }

   type    'single'    — one fuel / shield / high-value pickup
           'formation' — a chain of low-value pickups
   x, y    World anchor position
   z       World z  (SPAWN_Z = same plane as the obstacle step)
   dx, dy  (formation) World-unit step applied per pickup in chain
   count   (formation) Number of pickups in the chain
   ───────────────────────────────────────────────────────── */

/* Shorthand constructors */
const S = (x, y) => ({ type: 'single',    x, y, z: SPAWN_Z });
const F = (x, y, dx, dy, count = 4) =>
    ({ type: 'formation', x, y, z: SPAWN_Z, dx, dy, count });

/* ═══════════════════════════════════════════════════════════
   PICKUP LAYOUTS
   ─────────────────────────────────────────────────────────
   One array per pattern. Each element = one step's worth of
   pickup slots (index cycles if pattern has more steps than
   entries). These positions are hand-authored and tunable.

   World bounds: BOUNDS_X = 24  (±x),  BOUNDS_Y = 16  (±y)
   ═══════════════════════════════════════════════════════════ */
export const PICKUP_LAYOUTS = {

    /* ── patternLeftRight ──────────────────────────────────
       Walls alternate left (step 0) then right (step 1).
       Open space is always on the OPPOSITE side of the wall. */
    patternLeftRight: [
        // step 0: left wall  →  open RIGHT  (x ≈ +6 … +22)
        [
            F( 10,  0,    0,  2.5 ),   // vertical chain upward
            F( 13, -5,  2.0,  1.5 ),   // diagonal toward top-right
            S( 16,  5 ),
            S(  9, -7 ),
        ],
        // step 1: right wall  →  open LEFT  (x ≈ -6 … -22)
        [
            F(-10,  0,    0, -2.5 ),   // vertical chain downward
            F(-13,  5, -2.0, -1.5 ),   // diagonal toward bottom-left
            S(-16, -5 ),
            S( -9,  7 ),
        ],
    ],

    /* ── patternTopDown ────────────────────────────────────
       Bars alternate from top (step 0) and bottom (step 1).
       Open space is on the OPPOSITE side of the bar.        */
    patternTopDown: [
        // step 0: top bar  →  open BELOW  (y ≈ -2 … -12)
        [
            F(  0, -5,  2.5,   0 ),    // horizontal chain rightward
            F( -7, -4,  1.5, -1.0 ),   // diagonal down-right
            S(  9, -7 ),
            S( -9, -7 ),
        ],
        // step 1: bottom bar  →  open ABOVE  (y ≈ +2 … +12)
        [
            F(  0,  5, -2.5,   0 ),    // horizontal chain leftward
            F(  7,  4, -1.5,  1.0 ),   // diagonal up-left
            S( -9,  7 ),
            S(  9,  7 ),
        ],
    ],

    /* ── patternCorners ────────────────────────────────────
       Side wall + horizontal bar combo.  Open quadrant cycles
       through 4 configurations (one per combo index).        */
    patternCorners: [
        // combo 0: left wall + top bar  →  open BOTTOM-RIGHT
        [
            F(  9, -5,  1.5, -1.5 ),
            F( 14, -3,  0.0, -2.0 ),
            S( 12, -7 ),
        ],
        // combo 1: right wall + bottom bar  →  open TOP-LEFT
        [
            F( -9,  5, -1.5,  1.5 ),
            F(-14,  3,  0.0,  2.0 ),
            S(-12,  7 ),
        ],
        // combo 2: left wall + bottom bar  →  open TOP-RIGHT
        [
            F(  9,  5,  1.5,  1.5 ),
            F( 14,  3,  0.0,  2.0 ),
            S( 12,  7 ),
        ],
        // combo 3: right wall + top bar  →  open BOTTOM-LEFT
        [
            F( -9, -5, -1.5, -1.5 ),
            F(-14, -3,  0.0, -2.0 ),
            S(-12, -7 ),
        ],
    ],

    /* ── patternBars ───────────────────────────────────────
       Horizontal bars — same open-space logic as topDown but
       with denser coverage and slightly different positions.  */
    patternBars: [
        // step 0: top bar  →  open below
        [
            F(  4, -5,  2.0,    0 ),
            F( -9, -3,  1.0, -1.5 ),
            S( 11, -6 ),
            S(-11, -6 ),
        ],
        // step 1: bottom bar  →  open above
        [
            F( -4,  5, -2.0,   0 ),
            F(  9,  3, -1.0,  1.5 ),
            S(-11,  6 ),
            S( 11,  6 ),
        ],
    ],

    /* ── patternScatter ────────────────────────────────────
       Lone random blocks.  The spawner computes dynamic slots
       based on which side the block lands on; this static
       table is a fallback (should rarely be needed).          */
    patternScatter: [
        [
            F(  0,  0,  2.0,  1.0 ),
            S( -5,  4 ),
            S(  5, -4 ),
        ],
    ],

    /* patternNarrow, patternShiftingGates, patternSlalomGate:
       Positions depend on runtime random values (gap centers,
       hole positions).  These patterns return computed slots
       directly from their step closures in patterns.js.       */
};
