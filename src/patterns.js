import * as THREE from 'three';
import {
    BOUNDS_X, BOUNDS_Y, SPAWN_Z, PLANE_RADIUS,
    OBS_TARGET_OPACITY, matObs, matFrame,
    SAFE_ZONE_SINGLES_PER_STEP, SAFE_ZONE_MARGIN,
    SAFE_ZONE_FORMATIONS_PER_STEP, SAFE_ZONE_FORMATION_RADIUS,
} from './config.js';

/* ═══════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════ */

function getSafeSideWallSize(size = 1) {
    // Ensure LeftRight pattern walls never overlap and always allow passage
    // With walls at ±BOUNDS_X*0.58, width BOUNDS_X*1.05*size:
    //   gap = BOUNDS_X*1.16 - BOUNDS_X*1.05*size
    // Constraint: gap >= 2*PLANE_RADIUS + 10 (player width + margin)
    // Therefore: size <= (BOUNDS_X*1.16 - 2*PLANE_RADIUS - 10) / (BOUNDS_X*1.05)
    const minGap = 2 * PLANE_RADIUS + 10;
    const maxSafe = (BOUNDS_X * 1.16 - minGap) / (BOUNDS_X * 1.05);
    return Math.min(size, maxSafe);
}

/* ── Safe-zone helpers ────────────────────────────────────
   Push {x, y, z, type} into the safeZones array.
   type: 'single'    — one-off pickup placement spot
         'formation' — has additional dx, dy for chain direction
   All positions are at SPAWN_Z (same depth as the obstacle).
   ─────────────────────────────────────────────────────────── */
const _M = SAFE_ZONE_MARGIN;

/** Clamp a point to within the playable area (with margin) */
function _clampSafe(x, y) {
    return {
        x: THREE.MathUtils.clamp(x, -BOUNDS_X + _M, BOUNDS_X - _M),
        y: THREE.MathUtils.clamp(y, -BOUNDS_Y + _M, BOUNDS_Y - _M),
    };
}

/** Push up to `n` single safe zones scattered around (cx, cy) with some jitter */
function _pushSingles(zones, cx, cy, z, n = SAFE_ZONE_SINGLES_PER_STEP) {
    for (let i = 0; i < n; i++) {
        const jx = (Math.random() - 0.5) * _M * 2;
        const jy = (Math.random() - 0.5) * _M * 2;
        const p = _clampSafe(cx + jx, cy + jy);
        zones.push({ x: p.x, y: p.y, z, type: 'single' });
    }
}

/** Push a formation corridor: a start point + normalised direction.
 *  dx/dy define the lateral step per pickup in the chain. */
function _pushFormation(zones, cx, cy, z, dx, dy) {
    const p = _clampSafe(cx, cy);
    zones.push({ x: p.x, y: p.y, z, dx, dy, type: 'formation' });
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
    for (let i = 0; i < p.count; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        steps.push((scene, obstacles, safeZones) => 
            spawnSideWall(scene, obstacles, side, p.wallSize, true, safeZones));
    }
    return steps;
}

/* ── 2. Top-Down alternating bars ─────────────────────────── */
export function patternTopDown(params = {}) {
    const p = defaults(params, { count: 4 });
    const steps = [];
    for (let i = 0; i < p.count; i++) {
        const dir = i % 2 === 0 ? 1 : -1;
        const yFactor = 0.50 + Math.random() * 0.28;
        steps.push((scene, obstacles, safeZones) =>
            spawnBar(scene, obstacles, dir, p.wallSize, yFactor, safeZones));
    }
    return steps;
}

/* ── 3. Combined side + bar (L+Top, R+Bot, …) ────────────── */
export function patternCorners(params = {}) {
    const p = defaults(params, { count: 4 });
    const steps = [];
    const combos = [[-1, 1], [1, -1], [-1, -1], [1, 1]];
    for (let i = 0; i < p.count; i++) {
        const [sd, bd] = combos[i % combos.length];
        steps.push((scene, obstacles, safeZones) => {
            spawnSideWall(scene, obstacles, sd, p.wallSize * 0.65, false, safeZones);
            spawnBar(scene, obstacles, bd, p.wallSize * 0.65, undefined, safeZones);
            // Corner pattern: safe zone is in the open diagonal quadrant
            const safeCx = -sd * BOUNDS_X * 0.3;
            const safeCy = -bd * BOUNDS_Y * 0.3;
            // Override the singles from the sub-spawners with the true open area
            // (sub-spawners already pushed some; these are more accurate)
            _pushSingles(safeZones, safeCx, safeCy, SPAWN_Z, 1);
            _pushFormation(safeZones, safeCx, safeCy, SPAWN_Z,
                -sd * (2 + Math.random()), -bd * (1.5 + Math.random()));
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
        steps.push((scene, obstacles, safeZones) =>
            spawnWallCircleHole(scene, obstacles, cx, cy, p.gapSize, safeZones));
        gx += (Math.random() - 0.5) * p.gapOffset * 2.0;
        gy += (Math.random() - 0.5) * p.gapOffset * 1.2;
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
        steps.push((scene, obstacles, safeZones) => spawnSingleBlock(scene, obstacles, p.wallSize, safeZones));
    }
    return steps;
}

/* ── 6. Narrowing corridor — gap position & size randomized ───────────── */
export function patternNarrow(params = {}) {
    const p = defaults(params, { count: 3 });
    const steps = [];
    const minGapWidth = PLANE_RADIUS * 2 + 2.2;  // ~5.0 units (plane width + small margin)
    const maxGapWidth = p.gapSizeMax ?? BOUNDS_X;  // from difficulty curve
    
    for (let i = 0; i < p.count; i++) {
        steps.push((scene, obstacles, safeZones) => {
            const parts = [];
            const gapCenterX = (Math.random() - 0.5) * BOUNDS_X * 1.6;
            const gapWidth = THREE.MathUtils.lerp(
                minGapWidth,
                maxGapWidth,
                Math.random()
            );
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

            // Safe zones: inside the gap
            if (safeZones) {
                _pushSingles(safeZones, gapCenterX, 0, SPAWN_Z);
                // Formation runs vertically through the gap (horizontal is blocked)
                _pushFormation(safeZones, gapCenterX, -BOUNDS_Y * 0.2, SPAWN_Z, 0, 2.5);
                _pushFormation(safeZones, gapCenterX, BOUNDS_Y * 0.2, SPAWN_Z, 0, -2.5);
            }
        });
    }
    return steps;
}

/* ── 7. Slalom into circle-hole gate ──────────────────────── */
export function patternSlalomGate(params = {}) {
    const p = defaults(params, { count: 3, gapSize: 7 });
    const steps = [];
    for (let i = 0; i < p.count - 1; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        steps.push((scene, obstacles, safeZones) => spawnSideWall(scene, obstacles, side, p.wallSize, false, safeZones));
    }
    steps.push((scene, obstacles, safeZones) => {
        spawnWallCircleHole(scene, obstacles,
            (Math.random() - 0.5) * p.gapOffset * 2,
            (Math.random() - 0.5) * 3,
            p.gapSize, safeZones);
    });
    return steps;
}

/* ── 8. Horizontal bars sandwich ──────────────────────────── */
export function patternBars(params = {}) {
    const p = defaults(params, { count: 4 });
    const steps = [];
    for (let i = 0; i < p.count; i++) {
        const dir = i % 2 === 0 ? 1 : -1;
        const yFactor = 0.48 + Math.random() * 0.32;
        steps.push((scene, obstacles, safeZones) =>
            spawnBar(scene, obstacles, dir, p.wallSize, yFactor, safeZones));
    }
    return steps;
}

/* ═══════════════════════════════════════════════════════════
   PRIMITIVE SPAWNERS  (used by templates above)
   ═══════════════════════════════════════════════════════════ */

function spawnSideWall(scene, obstacles, side, size = 1, forceNarrow = false, safeZones = null) {
    const narrows = forceNarrow ? 0.45 : 1.0;
    const parts = [];
    const clampedSize = Math.min(size * narrows, 1.0);
    makeBox(scene, BOUNDS_X * 1.05 * clampedSize, BOUNDS_Y * 2.4, 4.5,
        side * (BOUNDS_X * 0.58), 0, SPAWN_Z, matObs, parts);
    obstacles.push({ parts, fadeAge: 0 });

    // Safe zone: opposite side of the wall
    if (safeZones) {
        const safeCx = -side * BOUNDS_X * 0.3;
        _pushSingles(safeZones, safeCx, 0, SPAWN_Z);
        // Formation runs vertically on the open side
        _pushFormation(safeZones, safeCx, -BOUNDS_Y * 0.15, SPAWN_Z, 0, 2.0 + Math.random());
        _pushFormation(safeZones, safeCx, BOUNDS_Y * 0.15, SPAWN_Z,
            -side * (1.5 + Math.random()), -(1.5 + Math.random()));
    }
}

function spawnBar(scene, obstacles, dir, size = 1, yFactor = 0.75, safeZones = null) {
    const parts = [];
    const clampedSize = Math.min(size, 1.20);
    makeBox(scene, BOUNDS_X * 2.5, BOUNDS_Y * 0.95 * clampedSize, 4, 0,
        dir * BOUNDS_Y * yFactor, SPAWN_Z, matObs, parts);
    obstacles.push({ parts, fadeAge: 0 });

    // Safe zone: opposite vertical side of the bar
    if (safeZones) {
        const safeCy = -dir * BOUNDS_Y * (1 - yFactor) * 0.4;
        _pushSingles(safeZones, 0, safeCy, SPAWN_Z);
        // Formation runs horizontally in the open space
        _pushFormation(safeZones, -BOUNDS_X * 0.2, safeCy, SPAWN_Z, 2.5 + Math.random(), 0);
        _pushFormation(safeZones, BOUNDS_X * 0.2, safeCy, SPAWN_Z, -(2.5 + Math.random()), 0);
    }
}

function spawnSingleBlock(scene, obstacles, size = 1, safeZones = null) {
    const parts = [];
    const side = Math.random() < 0.5 ? -1 : 1;
    const s = 3 * size;
    const bx = side * (4 + Math.random() * BOUNDS_X * 0.5);
    const by = (Math.random() - 0.5) * BOUNDS_Y * 0.7;
    makeBox(scene, s + Math.random() * 3, s + Math.random() * 3, s + Math.random() * 2,
        bx, by, SPAWN_Z, matObs, parts);
    obstacles.push({ parts, fadeAge: 0 });

    // Safe zone: opposite side of the block
    if (safeZones) {
        const safeCx = -side * BOUNDS_X * 0.3;
        _pushSingles(safeZones, safeCx, by, SPAWN_Z);
        _pushFormation(safeZones, safeCx, by, SPAWN_Z,
            -side * (2 + Math.random()), (Math.random() - 0.5) * 2);
    }
}

export function spawnWallWithRectGap(scene, obstacles, gapX, gapY, gapW, gapH, safeZones) {
    // Redirects to the circle-hole wall for visual consistency
    spawnWallCircleHole(scene, obstacles, gapX, gapY, (gapW + gapH) * 0.28, safeZones);
}

/* ── Solid wall with a smooth circular cutout ─────────────
   Visual: one PlaneGeometry with a ShaderMaterial that discards
   pixels inside the circle.  No grid seams, no overdraw.
   Collision: custom circle-hole check in main.js (obs.circleHole).
   ─────────────────────────────────────────────────────────── */
export function spawnWallCircleHole(scene, obstacles, gapX, gapY, gapR, safeZones = null) {
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

    // Safe zone: inside the circular hole
    if (safeZones) {
        _pushSingles(safeZones, gapX, gapY, SPAWN_Z);
        // Small formations that stay within the hole radius
        const fmtR = Math.min(safeR * 0.4, SAFE_ZONE_FORMATION_RADIUS);
        const angle = Math.random() * Math.PI * 2;
        _pushFormation(safeZones, gapX, gapY, SPAWN_Z,
            Math.cos(angle) * 1.5, Math.sin(angle) * 1.5);
    }
}

export function spawnWallWithCircleGap(scene, obstacles, gapX, gapY, gapR, safeZones) {
    spawnWallCircleHole(scene, obstacles, gapX, gapY, gapR, safeZones);
}

/* ═══════════════════════════════════════════════════════════
   SEQUENCER
   Picks pattern templates, scales params by difficulty, and
   feeds one step per spawn tick to the game loop.
   ═══════════════════════════════════════════════════════════ */

// TEST MODE: Set TESTING_ONLY_LEFTRIGHT to false to re-enable all patterns (line below)
const TESTING_ONLY_LEFTRIGHT = false;

// patternScatter removed — lone random boxes are replaced by enemy spawns.
const ALL_TEMPLATES = TESTING_ONLY_LEFTRIGHT 
    ? [patternNarrow]  // TESTING: Only LeftRight pattern
    : [
        patternLeftRight,
        patternTopDown,
        patternCorners,
        patternShiftingGates,
        patternNarrow,
        patternSlalomGate,
        patternBars,
    ];

let currentSteps = [];
let stepIdx = 0;
let lastTemplateIdx = -1;

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
    if (stepIdx >= currentSteps.length) {
        let idx;
        do { idx = Math.floor(Math.random() * ALL_TEMPLATES.length); }
        while (idx === lastTemplateIdx && ALL_TEMPLATES.length > 1);
        lastTemplateIdx = idx;
        currentSteps = ALL_TEMPLATES[idx](difficultyParams(elapsed));
        stepIdx = 0;
    }
    const stepSafeZones = [];
    currentSteps[stepIdx](scene, obstacles, stepSafeZones);
    stepIdx++;
    return stepSafeZones;
}

export function resetSequencer() {
    currentSteps = [];
    stepIdx = 0;
    lastTemplateIdx = -1;
}
