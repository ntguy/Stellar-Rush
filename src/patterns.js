import * as THREE from 'three';
import {
    BOUNDS_X, BOUNDS_Y, SPAWN_Z, PLANE_RADIUS,
    OBS_TARGET_OPACITY, matObs, matFrame,
} from './config.js';
/* ── Testing control ────────────────────────────────────────
   Set to a pattern name to lock the game to only that pattern.
   null = normal random rotation.
   Valid: 'patternLeftRight' | 'patternTopDown' | 'patternCorners'
          'patternShiftingGates' | 'patternNarrow' | 'patternSlalomGate'
          'patternScatter'                                     */
const FORCE_PATTERN = null; // e.g. 'patternNarrow' | null for random --- IGNORE ---

/* ═══════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════ */

// Coverage fractions: how much of the FULL playfield dimension a wall/bar covers.
// A wall with coverage 0.5 extends exactly to the center. >0.5 extends past it.
const COV_MIN  = 0.2;
const COV_MAX  = 0.65;
const COV_PAIR = 0.85;  // Any two consecutive walls/bars must total at least this

function _firstCoverage() {
    return COV_MIN + Math.random() * (COV_MAX - COV_MIN);
}

function _secondCoverage(first) {
    // Minimum needed so total >= COV_PAIR, clamped to COV_MIN
    const minNeeded = Math.max(COV_MIN, COV_PAIR - first);
    // Random in [minNeeded, COV_MAX]
    return minNeeded + Math.random() * (COV_MAX - minNeeded);
}

/* ── Layout helpers ──────────────────────────────────────── */

/** Rand helper: returns a value in [-v, +v]. */
function _pm(v) { return (Math.random() - 0.5) * 2 * v; }

/** Pick one element at random from an array. */
function _pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/** Evaluate a slot spec into a concrete spawnable slot.
 *
 *  For every variance field (xV, yV, dxV, dyV, countV), a random
 *  value in [-V, +V] is added to the base value at spawn time.
 *  This means each wave rolls fresh positions even when the same
 *  layout row is reused.
 *
 *  Boundary safety rules applied here so no spawned pickup can
 *  drift off-screen regardless of authored values:
 *   • x is clamped to [-BOUNDS_X+5, BOUNDS_X-5]
 *   • y is clamped to [-BOUNDS_Y+5, BOUNDS_Y-5]
 *   • For formations, dx/dy are auto-corrected if the chain would
 *     exit bounds: the sign of each is flipped to point back inward
 *     when the anchor + full chain extent would go out of range.
 *   • count is clamped to [1, 8].
 */
function _evaluateSpec(spec) {
    // --- anchor position with variance ---
    const x = THREE.MathUtils.clamp(
        spec.x + _pm(spec.xV ?? 0),
        -BOUNDS_X + 5, BOUNDS_X - 5,
    );
    const y = THREE.MathUtils.clamp(
        spec.y + _pm(spec.yV ?? 0),
        -BOUNDS_Y + 5, BOUNDS_Y - 5,
    );

    if (spec.type === 'single') {
        return { type: 'single', x, y, z: spec.z };
    }

    // --- formation ---
    let dx = spec.dx + _pm(spec.dxV ?? 0);
    let dy = spec.dy + _pm(spec.dyV ?? 0);
    const count = THREE.MathUtils.clamp(
        Math.round(spec.count + _pm(spec.countV ?? 0)),
        1, 8,
    );

    // Boundary guard: if the chain tip would exit the play area,
    // flip the offending direction so it points back inward.
    const tipX = x + dx * (count - 1);
    const tipY = y + dy * (count - 1);
    if (tipX < -BOUNDS_X + 5 || tipX > BOUNDS_X - 5) dx = -dx;
    if (tipY < -BOUNDS_Y + 5 || tipY > BOUNDS_Y - 5) dy = -dy;

    return { type: 'formation', x, y, z: spec.z, dx, dy, count };
}

export function makeBox(scene, w, h, d, x, y, z, mat, group) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat.clone());
    // Transparent mats start at opacity 0 and fade in; opaque mats stay as-is
    if (mat.transparent) m.material.opacity = 0;
    m.position.set(x, y, z);
    scene.add(m);
    group.push(m);
    return m;
}

/* ═══════════════════════════════════════════════════════════
   PARAMETERISED PATTERN TEMPLATES

   Every template is a function that returns an array of
   "step" functions. Each step spawns one wave of geometry.
   The sequencer calls one step per spawn tick.

   Params (all optional — defaults filled per template):
     count      – number of steps in the pattern (2–6)
     wallSize   – multiplier on wall width/height (0.5 – 1.5)
     gapSize    – size of holes in gate walls (3 – 12)
     gapOffset  – max random offset of hole position (0 – 10)
     spacing    – z-offset between successive walls (≥ 0)
   ═══════════════════════════════════════════════════════════ */

function defaults(p, overrides) {
    return {
        count:     p.count     ?? overrides.count     ?? 3,
        wallSize:  p.wallSize  ?? overrides.wallSize  ?? 1,
        gapSize:   p.gapSize   ?? overrides.gapSize   ?? 7,
        gapOffset: p.gapOffset ?? overrides.gapOffset ?? 4,
        spacing:   p.spacing   ?? overrides.spacing   ?? 0,
    };
}

/* ── 1. Left-Right alternating walls ──────────────────────── */
export function patternLeftRight(params = {}) {
    const p = defaults(params, { count: 4 });
    const steps = [];
    let prevCov = 0;

    for (let i = 0; i < p.count; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const isFirst = i % 2 === 0;

        steps.push((scene, obstacles) => {
            const cov = isFirst ? _firstCoverage() : _secondCoverage(prevCov);
            prevCov = cov;
            spawnSideWall(scene, obstacles, side, cov);

            if (side === -1) {
                // Left wall → open RIGHT — pick one formation, pick one single
                return [Math.random() < 0.5
                    ? _evaluateSpec(_pick([
                        // Drifts up or down from centre
                        { type: 'formation', x:  12, y:  0, z: SPAWN_Z, dx:    0, dy:  2.5, count: 4, xV: 4, yV: 0, dxV: 0,   dyV: 0.5, countV: 1 },
                        // Cascades down from near the top
                        { type: 'formation', x:  12, y: 10, z: SPAWN_Z, dx:    0, dy: -2.5, count: 4, xV: 3, yV: 2, dxV: 0,   dyV: 0.3, countV: 1 },
                        // Drifts left across the open half at a random height
                        { type: 'formation', x:  18, y:  0, z: SPAWN_Z, dx: -2.5, dy:    0, count: 4, xV: 3, yV: 8, dxV: 0.3, dyV: 0,   countV: 1 },
                        // Diagonal — sweeps right and up together
                        { type: 'formation', x:  12, y: -4, z: SPAWN_Z, dx:  1.5, dy:  2.0, count: 4, xV: 3, yV: 3, dxV: 0.3, dyV: 0.3, countV: 1 },
                    ]))
                    : _evaluateSpec(_pick([
                        // Lone pickup in the open half
                        { type: 'single', x:  10, y:  0, z: SPAWN_Z, xV: 4, yV: 6 },
                        // Bonus pickup near the far-right edge
                        { type: 'single', x:  18, y:  0, z: SPAWN_Z, xV: 2, yV: 3 },
                    ]))
                ];
            }

            // Right wall → open LEFT — pick one formation, pick one single
            return [Math.random() < 0.5
                ? _evaluateSpec(_pick([
                    // Drifts up or down from centre
                    { type: 'formation', x: -12, y:  0, z: SPAWN_Z, dx:    0, dy:  2.5, count: 4, xV: 4, yV: 0, dxV: 0,   dyV: 0.5, countV: 1 },
                    // Cascades down from near the top
                    { type: 'formation', x: -12, y: 10, z: SPAWN_Z, dx:    0, dy: -2.5, count: 4, xV: 3, yV: 2, dxV: 0,   dyV: 0.3, countV: 1 },
                    // Drifts right across the open half at a random height
                    { type: 'formation', x: -18, y:  0, z: SPAWN_Z, dx:  2.5, dy:    0, count: 4, xV: 3, yV: 8, dxV: 0.3, dyV: 0,   countV: 1 },
                    // Diagonal — sweeps left and up together
                    { type: 'formation', x: -12, y: -4, z: SPAWN_Z, dx: -1.5, dy:  2.0, count: 4, xV: 3, yV: 3, dxV: 0.3, dyV: 0.3, countV: 1 },
                ]))
                : _evaluateSpec(_pick([
                    // Lone pickup in the open half
                    { type: 'single', x: -10, y:  0, z: SPAWN_Z, xV: 4, yV: 6 },
                    // Bonus pickup near the far-left edge
                    { type: 'single', x: -18, y:  0, z: SPAWN_Z, xV: 2, yV: 3 },
                ]))
            ];
        });
    }
    return steps;
}

/* ── 2. Top-Down alternating bars ─────────────────────────── */
export function patternTopDown(params = {}) {
    const p = defaults(params, { count: 4 });
    const steps = [];
    let prevCov = 0;

    for (let i = 0; i < p.count; i++) {
        const dir = i % 2 === 0 ? 1 : -1;
        const stepIdx = i;
        const isFirst = i % 2 === 0;

        steps.push((scene, obstacles) => {
            const cov = isFirst ? _firstCoverage() : _secondCoverage(prevCov);
            prevCov = cov;
            spawnBar(scene, obstacles, dir, cov);
            if (dir === 1) {
                // Top bar → open BELOW — pick one formation + one single
                return [Math.random() < 0.5
                    ? _evaluateSpec(_pick([
                        // Sweeps right through the lower half
                        { type: 'formation', x:  0, y: -6, z: SPAWN_Z, dx:  3, dy:  0, count: 4, xV: 5, yV: 3, dxV: 0.5, dyV: 0.3, countV: 1 },
                        // Short diagonal that drifts down and to the right
                        { type: 'formation', x: -8, y: -5, z: SPAWN_Z, dx:  2, dy: -1, count: 3, xV: 2, yV: 2, dxV: 0.4, dyV: 0.3, countV: 1 },
                    ]))
                    : _evaluateSpec(_pick([
                        { type: 'single', x:  9, y: -9, z: SPAWN_Z, xV: 3, yV: 3 },
                        { type: 'single', x: -9, y: -9, z: SPAWN_Z, xV: 3, yV: 3 },
                    ]))
                ];
            }
            // Bottom bar → open ABOVE — pick one formation + one single
            return [Math.random() < 0.5
                ? _evaluateSpec(_pick([
                    // Sweeps left through the upper half
                    { type: 'formation', x:  0, y:  6, z: SPAWN_Z, dx: -3, dy:  0, count: 4, xV: 5, yV: 3, dxV: 0.5, dyV: 0.3, countV: 1 },
                    // Short diagonal that drifts up and to the left
                    { type: 'formation', x:  8, y:  5, z: SPAWN_Z, dx: -2, dy:  1, count: 3, xV: 2, yV: 2, dxV: 0.4, dyV: 0.3, countV: 1 },
                ]))
                : _evaluateSpec(_pick([
                    { type: 'single', x: -9, y:  9, z: SPAWN_Z, xV: 3, yV: 3 },
                    { type: 'single', x:  9, y:  9, z: SPAWN_Z, xV: 3, yV: 3 },
                ]))
            ];
        });
    }
    return steps;
}

/* ── 3. Combined side + bar (L+Top, R+Bot, …) ──────────────────── */
export function patternCorners(params = {}) {
    const p = defaults(params, { count: 4 });
    const steps = [];
    // [sideWall direction, bar direction]
    // side: -1 = left wall, 1 = right wall
    // bar:   1 = top bar,  -1 = bottom bar
    const combos = [[-1, 1], [1, -1], [-1, -1], [1, 1]];

    for (let i = 0; i < p.count; i++) {
        const [sd, bd] = combos[i % combos.length];
        const nextCombo = combos[(i + 1) % combos.length];

        // Step A: corner obstacle — exactly one pickup in the open corner
        steps.push((scene, obstacles) => {
            spawnSideWall(scene, obstacles, sd, 0.2 + Math.random() * 0.45);
            spawnBar(scene, obstacles, bd, 0.2 + Math.random() * 0.45);

            // openX is opposite of wall side, openY is opposite of bar direction
            const openX = -sd;
            const openY = -bd;

            return [Math.random() < 0.5
                ? _evaluateSpec({ type: 'formation', x: openX * 14, y: openY * 9, z: SPAWN_Z, dx: openX * 1.5, dy: openY * 1.5, count: 4, xV: 2, yV: 2, dxV: 0.3, dyV: 0.3, countV: 1 })
                : _evaluateSpec({ type: 'single',    x: openX * 16, y: openY * 10, z: SPAWN_Z, xV: 2, yV: 2 })
            ];
        });

        // Step B: center wall — exactly one pickup toward the NEXT combo's open corner
        steps.push((scene, obstacles) => {
            const parts = [];
            makeBox(scene, BOUNDS_X * 0.60, BOUNDS_Y * 0.60, 4, 0, 0, SPAWN_Z, matObs, parts);
            obstacles.push({ parts, fadeAge: 0 });

            const [nsd, nbd] = nextCombo;
            const openX = -nsd;
            const openY = -nbd;

            return [Math.random() < 0.5
                ? _evaluateSpec({ type: 'formation', x: openX * 12, y: openY * 7, z: SPAWN_Z, dx: openX * 1.5, dy: openY * 1.5, count: 4, xV: 3, yV: 3, dxV: 0.3, dyV: 0.3, countV: 1 })
                : _evaluateSpec({ type: 'single',    x: openX * 14, y: openY * 8, z: SPAWN_Z, xV: 3, yV: 3 })
            ];
        });
    }
    return steps;
}

/* ── 4. Walls with shifting circular holes ─────────────────── */
export function patternShiftingGates(params = {}) {
    const p = defaults(params, { count: 3, gapSize: 7, gapOffset: 6 });
    const steps = [];
    let gx = (Math.random() < 0.5 ? -1 : 1) * (Math.random() * p.gapOffset * 2.5 + p.gapOffset);
    let gy = (Math.random() - 0.5) * p.gapOffset * 1.8;
    for (let i = 0; i < p.count; i++) {
        const cx = gx, cy = gy;
        steps.push((scene, obstacles) => {
            spawnWallCircleHole(scene, obstacles, cx, cy, p.gapSize);
            // Slots computed at runtime from the actual hole center
            const angle = Math.random() * Math.PI * 2;
            return [Math.random() < 0.5
                ? { type: 'single',    x: cx, y: cy, z: SPAWN_Z }
                : { type: 'formation', x: cx, y: cy, z: SPAWN_Z,
                  dx: Math.cos(angle) * 2.0, dy: Math.sin(angle) * 2.0, count: 4 }
            ];
        });
        // Increase variance in hole location: higher multipliers
        gx += (Math.random() - 0.5) * p.gapOffset * 4;
        gy += (Math.random() - 0.5) * p.gapOffset * 4;
        gx = THREE.MathUtils.clamp(gx, -BOUNDS_X * 0.35, BOUNDS_X * 0.35);
        gy = THREE.MathUtils.clamp(gy, -BOUNDS_Y * 0.3, BOUNDS_Y * 0.3);
    }
    return steps;
}

/* ── 5. Breathing room — lone cubes ───────────────────────── */
export function patternScatter(params = {}) {
    const p = defaults(params, { count: 3 });
    const steps = [];
    for (let i = 0; i < p.count; i++) {
        const stepIdx = i;
        steps.push((scene, obstacles) => {
            const slots = spawnSingleBlock(scene, obstacles, p.wallSize);
            if (slots.length) return slots;
            // Fallback: broad diagonal scatter
            const scatterFallbacks = [
                [
                    { type: 'formation', x:  0, y:  0, z: SPAWN_Z, dx:  2, dy:  1, count: 4, xV: 7, yV: 6, dxV: 0.5, dyV: 0.5, countV: 2 },
                    { type: 'single',    x: -6, y:  3, z: SPAWN_Z, xV: 5, yV: 5 },
                ],
                [
                    { type: 'formation', x:  0, y:  0, z: SPAWN_Z, dx: -2, dy:  1, count: 4, xV: 7, yV: 6, dxV: 0.5, dyV: 0.5, countV: 2 },
                    { type: 'single',    x:  6, y:  3, z: SPAWN_Z, xV: 5, yV: 5 },
                ],
            ];
            const fallback = scatterFallbacks[stepIdx % scatterFallbacks.length];
            return [Math.random() < 0.5 
                ? _evaluateSpec(fallback[0]) 
                : _evaluateSpec(fallback[1])
            ];
        });
    }
    return steps;
}

/* ── 6. Narrowing corridor — gap position & size randomized ───────────── */
let narrowUsageCount = 0;

export function patternNarrow(params = {}) {
    const p = defaults(params, { count: 3 });
    const steps = [];

    // Decrease multiplier by 0.05 per use, starting at 1.6, floor at 1.0
    const multiplier = Math.max(1.0, 1.6 - (narrowUsageCount * 0.05));
    narrowUsageCount++;

    for (let i = 0; i < p.count; i++) {
        steps.push((scene, obstacles) => {
            const parts = [];

            // Width between 3 * PLANE_RADIUS and 8 * PLANE_RADIUS, multiplied by decreasing multiplier
            const baseWidth = THREE.MathUtils.lerp(PLANE_RADIUS * 3, PLANE_RADIUS * 10, Math.random());
            const gapWidth = baseWidth * multiplier;
            
            // Middle 50% of play area for gap center
            const playAreaLimit = BOUNDS_X * 0.5;
            const gapCenterX = THREE.MathUtils.lerp(-playAreaLimit, playAreaLimit, Math.random());
            
            const halfGap = gapWidth / 2;
            
            const leftWallRight = gapCenterX - halfGap;
            if (leftWallRight > -BOUNDS_X) {
                const leftWidth = leftWallRight - (-BOUNDS_X);
                const leftX = (-BOUNDS_X + leftWallRight) / 2;
                makeBox(scene, leftWidth, BOUNDS_Y * 2.4, 4, leftX, 0, SPAWN_Z, matObs, parts);
            }
            
            const rightWallLeft = gapCenterX + halfGap;
            if (rightWallLeft < BOUNDS_X) {
                const rightWidth = BOUNDS_X - rightWallLeft;
                const rightX = (rightWallLeft + BOUNDS_X) / 2;
                makeBox(scene, rightWidth, BOUNDS_Y * 2.4, 4, rightX, 0, SPAWN_Z, matObs, parts);
            }
            
            obstacles.push({ parts, fadeAge: 0 });

            // Slots anchored at the gap centre, computed at runtime
            return [Math.random() < 0.5
                ? { type: 'single',    x: gapCenterX, y: 0, z: SPAWN_Z }
                : _pick([
                    { type: 'formation', x: gapCenterX, y: -BOUNDS_Y * 0.2, z: SPAWN_Z, dx: 0, dy:  2.5, count: 4 },
                    { type: 'formation', x: gapCenterX, y:  BOUNDS_Y * 0.2, z: SPAWN_Z, dx: 0, dy: -2.5, count: 4 },
                ])
            ];
        });
    }
    return steps;
}

/* ── 7. Slalom into circle-hole gate ──────────────────────── */
export function patternSlalomGate(params = {}) {
    const p = defaults(params, { count: 3, gapSize: 7 });
    const steps = [];
    const startSide = Math.random() < 0.5 ? -1 : 1;
    for (let i = 0; i < p.count - 1; i++) {
        const side = i % 2 === 0 ? startSide : -startSide;
        steps.push((scene, obstacles) => {
            spawnSideWall(scene, obstacles, side, Math.random() * 0.35 + 0.4);
            if (side === -1) {
                // Left wall → open RIGHT
                return [Math.random() < 0.5
                    ? _evaluateSpec({ type: 'formation', x:  12, y:  0, z: SPAWN_Z, dx: 0, dy: 2.5, count: 4, xV: 4, yV: 3, dxV: 0, dyV: 0.5, countV: 1 })
                    : _evaluateSpec({ type: 'single',    x:  16, y:  0, z: SPAWN_Z, xV: 3, yV: 6 })
                ];
            }
            // Right wall → open LEFT
            return [Math.random() < 0.5
                ? _evaluateSpec({ type: 'formation', x: -12, y:  0, z: SPAWN_Z, dx: 0, dy: 2.5, count: 4, xV: 4, yV: 3, dxV: 0, dyV: 0.5, countV: 1 })
                : _evaluateSpec({ type: 'single',    x: -16, y:  0, z: SPAWN_Z, xV: 3, yV: 6 })
            ];
        });
    }
    steps.push((scene, obstacles) => {
        const gx = (Math.random() - 0.5) * (p.gapOffset ?? 4) * 5;
        const gy = (Math.random() - 0.5) * 15;
        spawnWallCircleHole(scene, obstacles, gx, gy, p.gapSize);
        const angle = Math.random() * Math.PI * 2;
        return [Math.random() < 0.5
            ? { type: 'formation', x: gx, y: gy, z: SPAWN_Z,
                dx: Math.cos(angle) * 2.0, dy: Math.sin(angle) * 2.0, count: 4 }
            : { type: 'single',    x: gx, y: gy, z: SPAWN_Z }
        ];
    });
    return steps;
}


/* ═══════════════════════════════════════════════════════════
   PRIMITIVE SPAWNERS  (used by templates above)
   ═══════════════════════════════════════════════════════════ */

// coverage: fraction of the full playfield dimension the wall/bar covers.
// A coverage of 0.5 reaches exactly to centre; >0.5 extends past it.
function spawnSideWall(scene, obstacles, side, coverage = 0.5) {
    const parts = [];
    const wallW = coverage * BOUNDS_X * 2;          // e.g. 0.5 * 48 = 24 units
    const centerX = side * (BOUNDS_X - wallW / 2);  // anchored to the edge
    makeBox(scene, wallW, BOUNDS_Y * 2.4, 4.5, centerX, 0, SPAWN_Z, matObs, parts);
    obstacles.push({ parts, fadeAge: 0 });
}

function spawnBar(scene, obstacles, dir, coverage = 0.5) {
    const parts = [];
    const barH = coverage * BOUNDS_Y * 2;            // e.g. 0.5 * 32 = 16 units
    const centerY = dir * (BOUNDS_Y - barH / 2);    // anchored to the edge
    makeBox(scene, BOUNDS_X * 2.5, barH, 4, 0, centerY, SPAWN_Z, matObs, parts);
    obstacles.push({ parts, fadeAge: 0 });
}

/** Returns computed pickup slots based on which side the block lands on. */
function spawnSingleBlock(scene, obstacles, size = 1) {
    const parts = [];
    const side = Math.random() < 0.5 ? -1 : 1;
    const s = 3 * size;
    const bx = side * (4 + Math.random() * BOUNDS_X * 0.5);
    const by = (Math.random() - 0.5) * BOUNDS_Y * 0.7;
    makeBox(scene, s + Math.random() * 3, s + Math.random() * 3, s + Math.random() * 2,
        bx, by, SPAWN_Z, matObs, parts);
    obstacles.push({ parts, fadeAge: 0 });
    // Dynamic slots: open side opposite the block
    const openX = -side * BOUNDS_X * 0.3;
    const dx = -side * (2 + Math.random());
    const dy = (Math.random() - 0.5) * 2;
    return [Math.random() < 0.5
        ? { type: 'single',    x: openX, y: by, z: SPAWN_Z }
        : { type: 'formation', x: openX, y: by, z: SPAWN_Z, dx, dy, count: 4 }
    ];
}

export function spawnWallWithRectGap(scene, obstacles, gapX, gapY, gapW, gapH) {
    // Redirects to the circle-hole wall for visual consistency
    spawnWallCircleHole(scene, obstacles, gapX, gapY, (gapW + gapH) * 0.28);
}

/* ── Solid wall with a smooth circular cutout ─────────────
   Visual: one PlaneGeometry with a ShaderMaterial that discards
   pixels inside the circle.  No grid seams, no overdraw.
   Collision: custom circle-hole check in main.js (obs.circleHole).
   ─────────────────────────────────────────────────────────── */
export function spawnWallCircleHole(scene, obstacles, gapX, gapY, gapR) {
    const ow = BOUNDS_X * 2.5, oh = BOUNDS_Y * 2.4, d = 5;
    // Guarantee the hole is large enough to pass through
    const safeR = Math.max(gapR, PLANE_RADIUS * 2.5);

    const mat = new THREE.ShaderMaterial({
        uniforms: {
            uColor:   { value: new THREE.Color(0xddeeff) },
            uOpacity: { value: 0 },
            uGapX:    { value: gapX },
            uGapY:    { value: gapY },
            uGapR:    { value: safeR },
            uWallW:   { value: ow },
            uWallH:   { value: oh },
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uOpacity;
            uniform float uGapX;
            uniform float uGapY;
            uniform float uGapR;
            uniform float uWallW;
            uniform float uWallH;
            varying vec2 vUv;
            void main() {
                float wx = (vUv.x - 0.5) * uWallW;
                float wy = (vUv.y - 0.5) * uWallH;
                float dx = wx - uGapX;
                float dy = wy - uGapY;
                if (dx * dx + dy * dy < uGapR * uGapR) discard;
                gl_FragColor = vec4(uColor, uOpacity);
            }`,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
    });

    const plane = new THREE.Mesh(new THREE.PlaneGeometry(ow, oh), mat);
    plane.position.set(0, 0, SPAWN_Z);
    scene.add(plane);

    obstacles.push({
        parts: [plane],
        fadeAge: 0,
        // Collision handled separately — see main.js collision loop
        circleHole: { x: gapX, y: gapY, r: safeR },
    });
}

export function spawnWallWithCircleGap(scene, obstacles, gapX, gapY, gapR) {
    spawnWallCircleHole(scene, obstacles, gapX, gapY, gapR);
}

/* ═══════════════════════════════════════════════════════════
   seQUENCER
   Picks pattern templates, scales params by difficulty, and
   feeds one step per spawn tick to the game loop.
   ═══════════════════════════════════════════════════════════ */
// Pass elapsed time to patterns that need dynamic difficulty scaling
function enrichParams(params, elapsed) {
    return { ...params, elapsed };
}
const ALL_PATTERN_MAP = {
    patternLeftRight,
    patternTopDown,
    patternCorners,
    patternShiftingGates,
    patternNarrow,
    patternSlalomGate,
    patternScatter,
};

const ALL_TEMPLATES = Object.values(ALL_PATTERN_MAP);

let currentSteps = [];
let stepIdx = 0;
let lastTemplateIdx = -1;
let currentPatternName = '';  // Track which pattern is active for debugging

/** Difficulty scales with elapsed time. Primary driver is wallSize (traversal distance).
 *  For patternNarrow: gapSizeMax trends from 12 → 6 over 2 minutes (larger gaps → narrower).
 *  wallSize is capped in the primitive spawners so it can never produce an impassable layout. */
function difficultyParams(elapsed) {
    const t = Math.min(elapsed / 120, 1); // full ramp over 2 minutes
    return {
        count:     Math.floor(THREE.MathUtils.lerp(2, 4, t)),
        wallSize:  THREE.MathUtils.lerp(0.78, 1.50, t),          // capped in spawners
        // Circle-hole radius: starts at PLANE_RADIUS*5.5 (~7.7), shrinks 30% to PLANE_RADIUS*3.8 (~5.4)
        gapSize:   THREE.MathUtils.lerp(PLANE_RADIUS * 5.5, PLANE_RADIUS * 3.8, t),
        gapOffset: THREE.MathUtils.lerp(3, 6, t),
        // For patternNarrow: max gap size starts at 50% of play area, shrinks to 25% by 2 min
        gapSizeMax: THREE.MathUtils.lerp(BOUNDS_X, BOUNDS_X * 0.5, t),
    };
}

export function nextObstacle(scene, obstacles, elapsed) {
    // If we've finished the current pattern, generate a new one
    if (stepIdx >= currentSteps.length || currentSteps.length === 0) {
        const params = enrichParams(difficultyParams(elapsed), elapsed);
        if (FORCE_PATTERN) {
            // Lock to a single pattern for testing
            const fn = ALL_PATTERN_MAP[FORCE_PATTERN];
            if (!fn) throw new Error(`FORCE_PATTERN: unknown pattern "${FORCE_PATTERN}"`);
            currentSteps = fn(params);
            currentPatternName = FORCE_PATTERN;
            // ...existing code...
        } else {
            let idx;
            do { idx = Math.floor(Math.random() * ALL_TEMPLATES.length); }
            while (idx === lastTemplateIdx && ALL_TEMPLATES.length > 1);
            lastTemplateIdx = idx;
            const patternFn = ALL_TEMPLATES[idx];
            const patternKeys = Object.keys(ALL_PATTERN_MAP);
            currentPatternName = patternKeys[idx];
            currentSteps = patternFn(params);
            // ...existing code...
        }
        stepIdx = 0;
        if (currentSteps.length === 0) {
            console.error('Generated pattern with 0 steps!');
            return [];
        }
    }
    // Step functions return an array of pickup slot objects
    const stepFn = currentSteps[stepIdx];
    if (!stepFn) {
        console.error(`Step function at index ${stepIdx} is undefined in pattern ${currentPatternName}`);
        stepIdx++;
        return [];
    }
    const slots = stepFn(scene, obstacles) ?? [];
    stepIdx++;
    return slots;
}

export function resetSequencer() {
    currentSteps = [];
    stepIdx = 0;
    lastTemplateIdx = -1;
}
