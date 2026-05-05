import * as THREE from 'three';
import {
    BOUNDS_X, BOUNDS_Y, SPAWN_Z, PLANE_RADIUS,
    matObs, FORCE_PATTERN
} from './config.js';


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

/** Evaluate a slot spec into a concrete spawnable slot. */
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

    return { type: 'formation', x, y, z: spec.z, dx, dy, count };
}

/* ── Geometric Energy Wall Factory ──────────────────────── */

/** 
 * Unified Obstacle Factory: Creates an "Energy Panel".
 * - Simple PlaneGeometry (2D, zero thickness, zero flashbang spikes).
 * - Standard MeshPhongMaterial (Very fast, no complex shaders).
 * - Glowing Rim using LineSegments (Techy, clean look).
 */
export function makeBox(scene, w, h, d, x, y, z, mat, group) {
    // 1. The Glass Face
    // Use a clean desaturated blue with a bit of emissive glow
    const faceMat = new THREE.MeshPhongMaterial({
        color: 0xddeeff,
        emissive: 0x0a1115,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
    });
    
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), faceMat);
    face.position.set(x, y, z);
    scene.add(face);
    
    // 2. The Tech Rim
    const edgeGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, h));
    const edgeMat = new THREE.LineBasicMaterial({ 
        color: 0xbbddff, 
        transparent: true, 
        opacity: 0,
        blending: THREE.AdditiveBlending 
    });

    const rim = new THREE.LineSegments(edgeGeo, edgeMat);
    rim.position.set(x, y, z);
    scene.add(rim);
    
    group.push(face, rim);
    return face;
}

/* ═══════════════════════════════════════════════════════════
   PARAMETERISED PATTERN TEMPLATES
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
                return [Math.random() < 0.5
                    ? _evaluateSpec(_pick([
                        { type: 'formation', x:  12, y:  0, z: SPAWN_Z, dx:    0, dy:  2.5, count: 4, xV: 4, yV: 0, dxV: 0,   dyV: 0.5, countV: 1 },
                        { type: 'formation', x:  12, y: 10, z: SPAWN_Z, dx:    0, dy: -2.5, count: 4, xV: 3, yV: 2, dxV: 0,   dyV: 0.3, countV: 1 },
                        { type: 'formation', x:  18, y:  0, z: SPAWN_Z, dx: -2.5, dy:    0, count: 4, xV: 3, yV: 8, dxV: 0.3, dyV: 0,   countV: 1 },
                        { type: 'formation', x:  12, y: -4, z: SPAWN_Z, dx:  1.5, dy:  2.0, count: 4, xV: 3, yV: 3, dxV: 0.3, dyV: 0.3, countV: 1 },
                    ]))
                    : _evaluateSpec(_pick([
                        { type: 'single', x:  10, y:  0, z: SPAWN_Z, xV: 4, yV: 6 },
                        { type: 'single', x:  18, y:  0, z: SPAWN_Z, xV: 2, yV: 3 },
                    ]))
                ];
            }
            return [Math.random() < 0.5
                ? _evaluateSpec(_pick([
                    { type: 'formation', x: -12, y:  0, z: SPAWN_Z, dx:    0, dy:  2.5, count: 4, xV: 4, yV: 0, dxV: 0,   dyV: 0.5, countV: 1 },
                    { type: 'formation', x: -12, y: 10, z: SPAWN_Z, dx:    0, dy: -2.5, count: 4, xV: 3, yV: 2, dxV: 0,   dyV: 0.3, countV: 1 },
                    { type: 'formation', x: -18, y:  0, z: SPAWN_Z, dx:  2.5, dy:    0, count: 4, xV: 3, yV: 8, dxV: 0.3, dyV: 0,   countV: 1 },
                    { type: 'formation', x: -12, y: -4, z: SPAWN_Z, dx: -1.5, dy:  2.0, count: 4, xV: 3, yV: 3, dxV: 0.3, dyV: 0.3, countV: 1 },
                ]))
                : _evaluateSpec(_pick([
                    { type: 'single', x: -10, y:  0, z: SPAWN_Z, xV: 4, yV: 6 },
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
        const isFirst = i % 2 === 0;
        steps.push((scene, obstacles) => {
            const cov = isFirst ? _firstCoverage() : _secondCoverage(prevCov);
            prevCov = cov;
            spawnBar(scene, obstacles, dir, cov);
            if (dir === 1) {
                return [Math.random() < 0.5
                    ? _evaluateSpec(_pick([
                        { type: 'formation', x:  0, y: -6, z: SPAWN_Z, dx:  3, dy:  0, count: 4, xV: 5, yV: 3, dxV: 0.5, dyV: 0.3, countV: 1 },
                        { type: 'formation', x: -8, y: -5, z: SPAWN_Z, dx:  2, dy: -1, count: 3, xV: 2, yV: 2, dxV: 0.4, dyV: 0.3, countV: 1 },
                    ]))
                    : _evaluateSpec(_pick([
                        { type: 'single', x:  9, y: -9, z: SPAWN_Z, xV: 3, yV: 3 },
                        { type: 'single', x: -9, y: -9, z: SPAWN_Z, xV: 3, yV: 3 },
                    ]))
                ];
            }
            return [Math.random() < 0.5
                ? _evaluateSpec(_pick([
                    { type: 'formation', x:  0, y:  6, z: SPAWN_Z, dx: -3, dy:  0, count: 4, xV: 5, yV: 3, dxV: 0.5, dyV: 0.3, countV: 1 },
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
    const combos = [[-1, 1], [1, -1], [-1, -1], [1, 1]];
    for (let i = 0; i < p.count; i++) {
        const [sd, bd] = combos[i % combos.length];
        const nextCombo = combos[(i + 1) % combos.length];
        steps.push((scene, obstacles) => {
            spawnSideWall(scene, obstacles, sd, 0.2 + Math.random() * 0.45);
            spawnBar(scene, obstacles, bd, 0.2 + Math.random() * 0.45);
            const openX = -sd; const openY = -bd;
            return [Math.random() < 0.5
                ? _evaluateSpec({ type: 'formation', x: openX * 10, y: openY * 5, z: SPAWN_Z, dx: openX * 1.5, dy: openY * 1.2, count: 4, xV: 3, yV: 2, dxV: 0.5, dyV: 1, countV: 1 })
                : _evaluateSpec({ type: 'single',    x: openX * 16, y: openY * 8, z: SPAWN_Z, xV: 5, yV: 3 })
            ];
        });
        steps.push((scene, obstacles) => {
            const parts = [];
            makeBox(scene, BOUNDS_X * 0.60, BOUNDS_Y * 0.60, 4, 0, 0, SPAWN_Z, matObs, parts);
            obstacles.push({ parts, fadeAge: 0 });
            const [nsd, nbd] = nextCombo;
            const openX = -nsd; const openY = -nbd;
            return [Math.random() < 0.5
                ? _evaluateSpec({ type: 'formation', x: openX * 10, y: openY * 7, z: SPAWN_Z, dx: openX * 1.5, dy: openY * 1.2, count: 4, xV: 3, yV: 2, dxV: 0.5, dyV: 1, countV: 1 })
                : _evaluateSpec({ type: 'single',    x: openX * 14, y: openY * 7, z: SPAWN_Z, xV: 4, yV: 3 })
            ];
        });
    }
    return steps;
}

/* ── 3b. Four Corners (lvl 2 and 3) ────────────────────────── */
export function patternFourCorners(params = {}) {
    const p = defaults(params, { count: _pick([3, 4]) });
    const steps = [];
    
    // Corners in clockwise order: TL, TR, BR, BL
    const corners = [
        { x: -1, y: 1 },  // 0: TL
        { x: 1, y: 1 },   // 1: TR
        { x: 1, y: -1 },  // 2: BR
        { x: -1, y: -1 }  // 3: BL
    ];
    
    let startIdx;
    do {
        startIdx = Math.floor(Math.random() * 4);
    } while (startIdx === lastCornerIdx);
    
    const dir = Math.random() < 0.5 ? 1 : -1;
    const dist = params.cornerDist ?? 7.5; 
    const gapSize = params.gapSize * 1.5 ?? PLANE_RADIUS * 7;
    
    let cornerSeq = 0;
    for (let i = 0; i < p.count; i++) {
        const cIdx = (startIdx + (cornerSeq++) * dir + 40) % 4;
        const corner = corners[cIdx];
        const cx = corner.x * dist;
        const cy = corner.y * dist;
        
        // Track the last corner we actually spawn so the next pattern invocation can avoid it
        lastCornerIdx = cIdx;

        steps.push((scene, obstacles) => {
            spawnWallSquareHole(scene, obstacles, cx, cy, gapSize, gapSize);
            return [{ type: 'single', x: cx, y: cy, z: SPAWN_Z }];
        });
    }
    return steps;
}

export function patternChoice(params = {}) {
    const steps = [];
    steps.push((scene, obstacles) => {
        // Base triangle radius (hole size). 6.0 is the user's preferred size.
        const r = params.triangleRadius ?? 6.0; 
        const k = Math.sqrt(3);

        // Spacing factor: 1.17 makes center triangle touch edges
        const S = 1.17; 

        const top =   { x: 0,           y: r * S };
        const left =  { x: -r * k / 2 * S, y: -r / 2 * S };
        const right = { x: r * k / 2 * S,  y: -r / 2 * S };
        
        spawnWallTriforceHoles(scene, obstacles, top, left, right, r);
        
        // Return 3 slots with specific pickup types
        return [
            { type: 'single', x: top.x,   y: top.y,   z: SPAWN_Z, pickupType: 'fuel' },
            { type: 'single', x: left.x,  y: left.y,  z: SPAWN_Z, pickupType: 'credits' },
            { type: 'single', x: right.x, y: right.y, z: SPAWN_Z, pickupType: 'shield' }
        ];
    });
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
            const angle = Math.random() * Math.PI * 2;
            return [Math.random() < 0.5
                ? { type: 'single',    x: cx, y: cy, z: SPAWN_Z }
                : { type: 'formation', x: cx, y: cy, z: SPAWN_Z, dx: Math.cos(angle) * 2.0, dy: Math.sin(angle) * 2.0, count: 4 }
            ];
        });
        gx += (Math.random() - 0.5) * p.gapOffset * 4;
        gy += (Math.random() - 0.5) * p.gapOffset * 4;
        gx = THREE.MathUtils.clamp(gx, -BOUNDS_X * 0.35, BOUNDS_X * 0.35);
        gy = THREE.MathUtils.clamp(gy, -BOUNDS_Y * 0.3, BOUNDS_Y * 0.3);
    }
    return steps;
}

/* ── 5. Breathing room — lone blocks ───────────────────────── */
export function patternScatter(params = {}) {
    const p = defaults(params, { count: 3 });
    const steps = [];
    const interval = 1.3;
    const speed = 50;
    const zOffset = (interval * speed) * 0.5;

    for (let i = 0; i < p.count; i++) {
        const stepIdx = i;
        steps.push((scene, obstacles) => {
            // Layer 1
            const slots1 = spawnSingleBlock(scene, obstacles, p.wallSize * 1.8, SPAWN_Z);
            // Layer 2 (staggered)
            const slots2 = spawnSingleBlock(scene, obstacles, p.wallSize * 3.5, SPAWN_Z - zOffset);

            // Merge slots
            const s1 = slots1 ?? [];
            const s2 = (slots2 ?? []).map(s => ({ ...s, z: SPAWN_Z - zOffset }));
            
            if (s1.length || s2.length) return [...s1, ...s2];

            const scatterFallbacks = [
                [{ type: 'formation', x:  0, y:  0, z: SPAWN_Z, dx:  2, dy:  1, count: 4, xV: 7, yV: 6, dxV: 0.5, dyV: 0.5, countV: 2 }, { type: 'single', x: -6, y: 3, z: SPAWN_Z, xV: 5, yV: 5 }],
                [{ type: 'formation', x:  0, y:  0, z: SPAWN_Z, dx: -2, dy:  1, count: 4, xV: 7, yV: 6, dxV: 0.5, dyV: 0.5, countV: 2 }, { type: 'single', x:  6, y: 3, z: SPAWN_Z, xV: 5, yV: 5 }],
            ];
            const fallback = scatterFallbacks[stepIdx % scatterFallbacks.length];
            return [Math.random() < 0.5 ? _evaluateSpec(fallback[0]) : _evaluateSpec(fallback[1])];
        });
    }
    return steps;
}

/* ── 5b. Super scatter (lvl 3) ─────────────────────────────── */
export function patternSuperScatter(params = {}) {
    const p = defaults(params, { count: 3 });
    const steps = [];
    const interval = 1.3;
    const speed = 50;
    const zOffset = (interval * speed) * 0.5;

    for (let i = 0; i < p.count; i++) {
        steps.push((scene, obstacles) => {
            // Layer 1 - Three smaller blocks
            const slots1a = spawnSingleBlock(scene, obstacles, p.wallSize * 1.8, SPAWN_Z, true);
            const slots1b = spawnSingleBlock(scene, obstacles, p.wallSize * 1.5, SPAWN_Z, true);
            const slots1c = spawnSingleBlock(scene, obstacles, p.wallSize * 1.2, SPAWN_Z, true);
            
            // Layer 2 - Two medium blocks (staggered)
            const slots2a = spawnSingleBlock(scene, obstacles, p.wallSize * 2.2, SPAWN_Z - zOffset, true);
            const slots2b = spawnSingleBlock(scene, obstacles, p.wallSize * 2.8, SPAWN_Z - zOffset, true);

            const all = [...slots1a, ...slots1b, ...slots1c, ...slots2a.map(s=>({...s, z: SPAWN_Z - zOffset})), ...slots2b.map(s=>({...s, z: SPAWN_Z - zOffset}))];
            return all.filter(s => s.type === 'single'); // No formations
        });
    }
    return steps;
}

/* ── 6. Narrowing corridor ────────────────────────────────── */
// Level Scaling — narrowing difficulty is set per-level, no per-usage ramp
export function patternNarrow(params = {}) {
    const p = defaults(params, { count: 3 });
    const steps = [];
    for (let i = 0; i < p.count; i++) {
        steps.push((scene, obstacles) => {
            const parts = [];
            const gapWidth = THREE.MathUtils.lerp(PLANE_RADIUS * 5, PLANE_RADIUS * 10, Math.random());
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
            return [Math.random() < 0.5 ? { type: 'single', x: gapCenterX, y: 0, z: SPAWN_Z } : _pick([{ type: 'formation', x: gapCenterX, y: -BOUNDS_Y * 0.2, z: SPAWN_Z, dx: 0, dy: 2.5, count: 4 }, { type: 'formation', x: gapCenterX, y: BOUNDS_Y * 0.2, z: SPAWN_Z, dx: 0, dy: -2.5, count: 4 }])];
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
                return [Math.random() < 0.5 ? _evaluateSpec({ type: 'formation', x: 12, y: 0, z: SPAWN_Z, dx: 0, dy: 2.5, count: 4, xV: 4, yV: 3, dxV: 0, dyV: 0.5, countV: 1 }) : _evaluateSpec({ type: 'single', x: 16, y: 0, z: SPAWN_Z, xV: 3, yV: 6 })];
            }
            return [Math.random() < 0.5 ? _evaluateSpec({ type: 'formation', x: -12, y: 0, z: SPAWN_Z, dx: 0, dy: 2.5, count: 4, xV: 4, yV: 3, dxV: 0, dyV: 0.5, countV: 1 }) : _evaluateSpec({ type: 'single', x: -16, y: 0, z: SPAWN_Z, xV: 3, yV: 6 })];
        });
    }
    steps.push((scene, obstacles) => {
        const gx = (Math.random() - 0.5) * (p.gapOffset ?? 4) * 5;
        const gy = (Math.random() - 0.5) * 15;
        spawnWallCircleHole(scene, obstacles, gx, gy, p.gapSize);
        const angle = Math.random() * Math.PI * 2;
        return [Math.random() < 0.5 ? { type: 'formation', x: gx, y: gy, z: SPAWN_Z, dx: Math.cos(angle) * 2.0, dy: Math.sin(angle) * 2.0, count: 4 } : { type: 'single', x: gx, y: gy, z: SPAWN_Z }];
    });
    return steps;
}

/* ═══════════════════════════════════════════════════════════
   PRIMITIVE SPAWNERS
   ═══════════════════════════════════════════════════════════ */

function spawnSideWall(scene, obstacles, side, coverage = 0.5) {
    const parts = [];
    const wallW = coverage * BOUNDS_X * 2;
    const centerX = side * (BOUNDS_X - wallW / 2);
    makeBox(scene, wallW, BOUNDS_Y * 2.4, 1, centerX, 0, SPAWN_Z, matObs, parts);
    obstacles.push({ parts, fadeAge: 0 });
}

function spawnBar(scene, obstacles, dir, coverage = 0.5) {
    const parts = [];
    const barH = coverage * BOUNDS_Y * 2;
    const centerY = dir * (BOUNDS_Y - barH / 2);
    makeBox(scene, BOUNDS_X * 2.5, barH, 1, 0, centerY, SPAWN_Z, matObs, parts);
    obstacles.push({ parts, fadeAge: 0 });
}

function spawnSingleBlock(scene, obstacles, size = 1, z = SPAWN_Z, noFormations = false) {
    const parts = [];
    const s = 3 * size;
    // Allow bx to be anywhere across the width, including the center
    const bx = _pm(BOUNDS_X * 0.7);
    const by = _pm(BOUNDS_Y * 0.6);
    
    makeBox(scene, s + Math.random() * 3, s + Math.random() * 3, 1, bx, by, z, matObs, parts);
    obstacles.push({ parts, fadeAge: 0 });

    // Place the "safe" slot on the opposite side of the block to ensure it's reachable
    const openX = -Math.sign(bx || 1) * BOUNDS_X * 0.4;
    const dx = -Math.sign(bx || 1) * (2 + Math.random()); 
    const dy = _pm(1.0);
    
    if (noFormations) return [{ type: 'single', x: openX, y: by, z: z }];
    return [Math.random() < 0.5 ? { type: 'single', x: openX, y: by, z: z } : { type: 'formation', x: openX, y: by, z: z, dx, dy, count: 4 }];
}

export function spawnWallSquareHole(scene, obstacles, gapX, gapY, gapW, gapH) {
    const ow = BOUNDS_X * 2.5, oh = BOUNDS_Y * 2.4;
    const mat = new THREE.ShaderMaterial({
        uniforms: {
            uColor:   { value: new THREE.Color(0xddeeff) },
            uOpacity: { value: 0 },
            uGapX:    { value: gapX },
            uGapY:    { value: gapY },
            uGapW:    { value: gapW },
            uGapH:    { value: gapH },
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
            uniform float uGapW;
            uniform float uGapH;
            uniform float uWallW;
            uniform float uWallH;
            varying vec2 vUv;
            void main() {
                float wx = (vUv.x - 0.5) * uWallW;
                float wy = (vUv.y - 0.5) * uWallH;
                float dx = abs(wx - uGapX);
                float dy = abs(wy - uGapY);
                if (dx < uGapW * 0.5 && dy < uGapH * 0.5) discard;
                gl_FragColor = vec4(uColor + vec3(0.05), uOpacity);
            }`,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(ow, oh), mat);
    plane.position.set(0, 0, SPAWN_Z);
    scene.add(plane);
    
    // Tech border for the square hole
    const edges = new THREE.EdgesGeometry(new THREE.PlaneGeometry(gapW, gapH));
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending });
    const border = new THREE.LineSegments(edges, edgeMat);
    border.position.set(gapX, gapY, SPAWN_Z + 0.01);
    scene.add(border);

    obstacles.push({ parts: [plane, border], fadeAge: 0, squareHole: { x: gapX, y: gapY, w: gapW, h: gapH } });
}

export function spawnWallTriforceHoles(scene, obstacles, p1, p2, p3, r) {
    const ow = BOUNDS_X * 2.5, oh = BOUNDS_Y * 2.4;
    const mat = new THREE.ShaderMaterial({
        uniforms: {
            uColor:   { value: new THREE.Color(0xddeeff) },
            uOpacity: { value: 0 },
            uP1:      { value: new THREE.Vector2(p1.x, p1.y) },
            uP2:      { value: new THREE.Vector2(p2.x, p2.y) },
            uP3:      { value: new THREE.Vector2(p3.x, p3.y) },
            uRadius:  { value: r },
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
            uniform vec2 uP1;
            uniform vec2 uP2;
            uniform vec2 uP3;
            uniform float uRadius;
            uniform float uWallW;
            uniform float uWallH;
            varying vec2 vUv;

            float sdEquilateralTriangle( in vec2 p, in float r )
            {
                const float k = sqrt(3.0);
                p.x = abs(p.x) - r;
                p.y = p.y + r/k;
                if( p.x+k*p.y>0.0 ) p = vec2(p.x-k*p.y,-k*p.x-p.y)/2.0;
                p.x -= clamp( p.x, -2.0*r, 0.0 );
                return -length(p)*sign(p.y);
            }

            void main() {
                float wx = (vUv.x - 0.5) * uWallW;
                float wy = (vUv.y - 0.5) * uWallH;
                vec2 p = vec2(wx, wy);
                
                float d1 = sdEquilateralTriangle(p - uP1, uRadius);
                float d2 = sdEquilateralTriangle(p - uP2, uRadius);
                float d3 = sdEquilateralTriangle(p - uP3, uRadius);
                
                if (d1 < 0.0 || d2 < 0.0 || d3 < 0.0) discard;
                
                gl_FragColor = vec4(uColor + vec3(0.05), uOpacity);
            }`,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(ow, oh), mat);
    plane.position.set(0, 0, SPAWN_Z);
    scene.add(plane);
    
    obstacles.push({ parts: [plane], fadeAge: 0, triforceHoles: { p1, p2, p3, r: r } });
}


export function spawnWallCircleHole(scene, obstacles, gapX, gapY, gapR) {
    const ow = BOUNDS_X * 2.5, oh = BOUNDS_Y * 2.4;
    const safeR = Math.max(gapR, PLANE_RADIUS * 2.5);

    // Simple shader that just does the hole discard
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
                gl_FragColor = vec4(uColor + vec3(0.05), uOpacity);
            }`,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
    });

    const plane = new THREE.Mesh(new THREE.PlaneGeometry(ow, oh), mat);
    plane.position.set(0, 0, SPAWN_Z);
    scene.add(plane);
    
    // Add a simple tech ring around the hole
    const ringGeo = new THREE.RingGeometry(safeR, safeR + 0.3, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(gapX, gapY, SPAWN_Z + 0.01);
    scene.add(ring);


    obstacles.push({ parts: [plane, ring], fadeAge: 0, circleHole: { x: gapX, y: gapY, r: safeR } });
}

export function spawnWallWithCircleGap(scene, obstacles, gapX, gapY, gapR) {
    spawnWallCircleHole(scene, obstacles, gapX, gapY, gapR);
}

/* ═══════════════════════════════════════════════════════════
   seQUENCER
   ═══════════════════════════════════════════════════════════ */
const ALL_PATTERN_MAP = { 
    patternLeftRight, patternTopDown, patternCorners, patternShiftingGates, 
    patternNarrow, patternSlalomGate, patternScatter,
    patternFourCorners, patternChoice, patternSuperScatter
};

export let currentPatternName = '';
let currentSteps = []; let stepIdx = 0; let lastTemplateIdx = -1;
let lastCornerIdx = -1;

// Level Scaling — difficulty params are now supplied by the level system, not computed from elapsed time
export function nextObstacle(scene, obstacles, levelParams) {
    if (stepIdx >= currentSteps.length || currentSteps.length === 0) {
        // levelParams comes directly from the current level definition
        const params = { ...(levelParams || { level: 1, count: 3, wallSize: 1.0, gapSize: PLANE_RADIUS * 4.5, gapOffset: 4 }) };
        
        if (FORCE_PATTERN) {
            const fn = ALL_PATTERN_MAP[FORCE_PATTERN];
            currentSteps = fn(params); 
            currentPatternName = FORCE_PATTERN;
        } else {
            // Level-based filtering
            let available = Object.keys(ALL_PATTERN_MAP);
            const level = params.level || 1;
            
            if (level >= 2) {
                // For level 2 and 3, patternLeftRight and patternShiftingGates should be removed
                available = available.filter(k => k !== 'patternLeftRight' && k !== 'patternShiftingGates');
            } else {
                // New patterns (FourCorners, Choice) don't spawn in level 1 normally
                available = available.filter(k => k !== 'patternFourCorners' && k !== 'patternChoice');
            }
            
            if (level >= 3) {
                // For level 3 only, patternScatter should also be removed
                available = available.filter(k => k !== 'patternScatter');
            } else {
                // Super scatter only for lvl 3
                available = available.filter(k => k !== 'patternSuperScatter');
            }

            let name;
            do { 
                name = available[Math.floor(Math.random() * available.length)];
            } while (name === currentPatternName && available.length > 1);
            
            currentPatternName = name;
            const patternFn = ALL_PATTERN_MAP[name];
            currentSteps = patternFn(params);
        }
        stepIdx = 0;
    }
    const stepFn = currentSteps[stepIdx]; if (!stepFn) { stepIdx++; return []; }
    const slots = stepFn(scene, obstacles) ?? []; stepIdx++; return slots;
}

export function resetSequencer() { currentSteps = []; stepIdx = 0; lastTemplateIdx = -1; currentPatternName = ''; }
