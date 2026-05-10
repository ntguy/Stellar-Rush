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

/* ── Geometry Cache ────────────────────────────────────────
   Avoids creating duplicate PlaneGeometry/BoxGeometry objects.
   Key format: "w,h" for planes, "w,h,d" for boxes.         */
const _planeGeoCache = new Map();
const _boxGeoCache = new Map();
const _edgesGeoCache = new Map();
const _cylinderGeoCache = new Map();
const _ringGeoCache = new Map();

function _getCachedPlaneGeo(w, h) {
    const key = `${w},${h}`;
    if (!_planeGeoCache.has(key)) {
        _planeGeoCache.set(key, new THREE.PlaneGeometry(w, h));
    }
    return _planeGeoCache.get(key);
}

function _getCachedBoxGeo(w, h, d) {
    const key = `${w},${h},${d}`;
    if (!_boxGeoCache.has(key)) {
        _boxGeoCache.set(key, new THREE.BoxGeometry(w, h, d));
    }
    return _boxGeoCache.get(key);
}

function _getCachedCylinderGeo(rt, rb, h, rs, hs, open) {
    const key = `${rt},${rb},${h},${rs},${hs},${open}`;
    if (!_cylinderGeoCache.has(key)) {
        const geo = new THREE.CylinderGeometry(rt, rb, h, rs, hs, open);
        geo.rotateX(Math.PI / 2); // Pre-rotate for tube alignment
        _cylinderGeoCache.set(key, geo);
    }
    return _cylinderGeoCache.get(key);
}

function _getCachedRingGeo(ir, or, seg) {
    const key = `${ir},${or},${seg}`;
    if (!_ringGeoCache.has(key)) {
        _ringGeoCache.set(key, new THREE.RingGeometry(ir, or, seg));
    }
    return _ringGeoCache.get(key);
}

function _getCachedEdgesGeo(sourceGeo) {
    const key = sourceGeo.uuid;
    if (!_edgesGeoCache.has(key)) {
        _edgesGeoCache.set(key, new THREE.EdgesGeometry(sourceGeo));
    }
    return _edgesGeoCache.get(key);
}

/** 
 * Unified Obstacle Factory: Creates an "Energy Panel".
 * - Simple PlaneGeometry (2D, zero thickness, zero flashbang spikes).
 * - Standard MeshPhongMaterial (Very fast, no complex shaders).
 * - Glowing Rim using LineSegments (Techy, clean look).
 */
export function makeBox(scene, w, h, d, x, y, z, mat, group) {
    // 1. The Glass Face — MeshBasicMaterial avoids per-vertex lighting for translucent panels
    const faceMat = new THREE.MeshBasicMaterial({
        color: 0xddeeff,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
    });
    
    const faceGeo = _getCachedPlaneGeo(w, h);
    const face = new THREE.Mesh(faceGeo, faceMat);
    face.position.set(x, y, z);
    scene.add(face);
    
    // 2. The Tech Rim
    const edgeGeo = _getCachedEdgesGeo(faceGeo);
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
   GEOMETRY HELPERS FOR WORLD 2 (3D VOLUMES)
   ═══════════════════════════════════════════════════════════ */
export function make3DBox(scene, w, h, d, x, y, z, mat, group) {
    const faceMat = new THREE.MeshBasicMaterial({
        color: 0xddeeff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
    });
    
    const boxGeo = _getCachedBoxGeo(w, h, d);
    const face = new THREE.Mesh(boxGeo, faceMat);
    face.position.set(x, y, z);
    scene.add(face);
    
    const edgeGeo = _getCachedEdgesGeo(boxGeo);
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

export function spawnWallSectorHole(scene, obstacles, gapR, startAngle, endAngle, z) {
    const ow = BOUNDS_X * 2.5, oh = BOUNDS_Y * 2.4;
    const mat = new THREE.ShaderMaterial({
        uniforms: {
            uColor:   { value: new THREE.Color(0xddeeff) },
            uOpacity: { value: 0 },
            uGapR:    { value: gapR },
            uStartA:  { value: startAngle },
            uEndA:    { value: endAngle },
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
            uniform float uGapR;
            uniform float uStartA;
            uniform float uEndA;
            uniform float uWallW;
            uniform float uWallH;
            #define PI 3.14159265359
            varying vec2 vUv;
            void main() {
                float wx = (vUv.x - 0.5) * uWallW;
                float wy = (vUv.y - 0.5) * uWallH;
                float r = sqrt(wx * wx + wy * wy);
                if (r > uGapR) discard; 
                
                float a = atan(wy, wx);
                if (a < 0.0) a += 2.0 * PI;
                
                bool inSector = false;
                if (uStartA < uEndA) {
                    inSector = (a >= uStartA && a <= uEndA);
                } else {
                    inSector = (a >= uStartA || a <= uEndA);
                }
                
                if (inSector) discard;

                gl_FragColor = vec4(uColor + vec3(0.05), uOpacity);
            }`,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
    });

    const plane = new THREE.Mesh(new THREE.PlaneGeometry(ow, oh), mat);
    plane.position.set(0, 0, z);
    scene.add(plane);
    
    obstacles.push({ parts: [plane], fadeAge: 0, isSectorHole: { r: gapR, startAngle, endAngle } });
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

/* ── World 2 Patterns (Levels 4-6) ─────────────────────────── */

export function patternTrench(params = {}) {
    const steps = [];
    const lvl = params.level || 4;

    const speed = params.speed || 50;
    const zSpacing = speed * (1 - (lvl - 4) * 0.1);

    const subPatterns = [];

    const wallWidthMultiplier = params.trenchWallWidthMult || (lvl === 4 ? 1.0 : (lvl === 5 ? 1.0 : (lvl === 6 ? 1.15 : 1.0)));
    const gapWidthMultiplier = params.trenchGapWidthMult || (lvl === 4 ? 1.0 : (lvl === 5 ? 0.85 : 1.0));
    const angleMultiplier = params.trenchAngleMult || (lvl === 4 ? 1.0 : (lvl === 5 ? 1.0 : (lvl === 6 ? 0.8 : 1.0)));

    const baseWallW = BOUNDS_X * 0.4 * wallWidthMultiplier;

    // 1. Wide center -> Left+Right -> Wide center
    subPatterns.push([
        { walls: [{ pos: 'C', w: baseWallW * 2.4 }], isWideTrench: true, zMult: 1 },
        { walls: [{ pos: 'L', w: baseWallW * 2 }, { pos: 'R', w: baseWallW * 2 }], safe: 'C', zMult: 1 },
        { walls: [{ pos: 'C', w: baseWallW * 3 }], isWideTrench: true, zMult: 1 }
    ]);

    // 2. Narrow gap pattern (like patternNarrow from World 1)
    const narrowCount = 2 + Math.floor(Math.random() * 2);
    const narrowSequence = [];
    const gapPositions = [
        -BOUNDS_X * 0.5,
        -BOUNDS_X * 0.25,
        0,
        BOUNDS_X * 0.25,
        BOUNDS_X * 0.5
    ];
    for (let i = 0; i < narrowCount; i++) {
        const gapWidth = (PLANE_RADIUS * 6 * gapWidthMultiplier) + Math.random() * (PLANE_RADIUS * 4);
        const gapCenterX = gapPositions[Math.floor(Math.random() * gapPositions.length)];
        narrowSequence.push({
            walls: [{ customGap: { centerX: gapCenterX, width: gapWidth } }],
            safeX: gapCenterX,
            zMult: 1
        });
    }
    subPatterns.push(narrowSequence);

    // 3. Diagonal walls - diagonal in top view (rotate around Y axis, extending into Z depth)
    const diagonalCount = Math.random() < 0.5 ? 1 : 2;
    const diagonalSequence = [];
    let diagonalDir = Math.random() < 0.5 ? -1 : 1;
    const wallDepth = BOUNDS_X * 3;
    for (let i = 0; i < diagonalCount; i++) {
        diagonalSequence.push({
            walls: [{ diagonalTop: true, depth: wallDepth, dir: diagonalDir, startEdge: true }],
            zMult: 1,
            isDiagonal: true,
            diagDir: diagonalDir,
            wallDepth: wallDepth
        });
        diagonalDir *= -1;
    }
    subPatterns.push(diagonalSequence);

    // 4. Super scatter - 2 walls per layer, double the layers, half z spacing
    const scatterCount = 6;
    const scatterSequence = [];
    const floorY = -BOUNDS_Y + 0.5;
    const ceilingY = -0.1 * BOUNDS_Y;
    const wallBuffer = 8;
    for (let i = 0; i < scatterCount; i++) {
        const walls = [];
        const usedPositions = [];
        for (let j = 0; j < 1; j++) {
            let bx;
            let attempts = 0;
            do {
                bx = (Math.random() - 0.5) * 2 * (BOUNDS_X * 0.7);
                attempts++;
            } while (usedPositions.some(p => Math.abs(p - bx) < wallBuffer) && attempts < 10);
            usedPositions.push(bx);
            walls.push({ fullHeightWall: true, x: bx });
        }
        scatterSequence.push({
            walls: walls,
            noPickup: true,
            zMult: 0.5
        });
    }
    subPatterns.push(scatterSequence);

    // Shuffle
    for (let i = subPatterns.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [subPatterns[i], subPatterns[j]] = [subPatterns[j], subPatterns[i]];
    }

    const sequence = [];
    const selectedPatterns = subPatterns.slice(0, 3);
    selectedPatterns.forEach((block, idx) => {
        sequence.push(...block);
        if (idx < selectedPatterns.length - 1) {
            // Extra z-spacing in-between subpatterns (Reduced to 0.03)
            sequence.push({ walls: [], noPickup: true, zMult: 0.03 }); 
        }
    });

    const wallCount = sequence.length;
    let cumZForBlock = 0;
    for (let i = 0; i < wallCount - 1; i++) {
        const zMult = sequence[i].zMult || 1;
        cumZForBlock += zSpacing * zMult;
    }
    const blockD = cumZForBlock; // Floor exactly matches the final obstacle
    const duration = blockD / speed;

    const interval = params.obstacleInterval || 1.6;
    const totalSteps = Math.ceil(duration / interval) + 1;

    steps.push((scene, obstacles) => {
        const blockW = BOUNDS_X * 2.5;

        const ceilingH = 0.5;
        const ceilingY = -0.1 * BOUNDS_Y;
        const trenchCenterZ = SPAWN_Z - blockD / 2;
        const ceilingParts = [];
        make3DBox(scene, blockW, ceilingH, blockD, 0, ceilingY, trenchCenterZ, null, ceilingParts);

        const laserMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0 });
        const divZ = 64;
        const divX = 16;
        for (let i = 0; i <= divZ; i++) {
            const lz = trenchCenterZ - blockD/2 + (i / divZ) * blockD;
            const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-blockW/2, 0, 0), new THREE.Vector3(blockW/2, 0, 0)]);
            const line = new THREE.Line(lineGeo, laserMat);
            line.userData.opacityMult = 0.6;
            line.position.set(0, ceilingY, lz);
            scene.add(line);
            ceilingParts.push(line);
        }
        for (let i = 0; i <= divX; i++) {
            const lx = -blockW/2 + (i / divX) * blockW;
            const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -blockD/2), new THREE.Vector3(0, 0, blockD/2)]);
            const line = new THREE.Line(lineGeo, laserMat);
            line.userData.opacityMult = 0.6;
            line.position.set(lx, ceilingY, trenchCenterZ);
            scene.add(line);
            ceilingParts.push(line);
        }

        obstacles.push({ parts: ceilingParts, fadeAge: 0, targetOpacity: 0.2, isLong: { depth: blockD } });

        const topWallH = (2 * BOUNDS_Y) * (2/3);
        const topWallY = BOUNDS_Y - (topWallH / 2);
        const topWallParts = [];
        makeBox(scene, blockW, topWallH, 1, 0, topWallY, SPAWN_Z, matObs, topWallParts);
        obstacles.push({ parts: topWallParts, fadeAge: 0 });

        const slots = [];
        const wallH = BOUNDS_Y * 0.85;

        const w = baseWallW;
        const getX = (pos) => {
            if (pos === 'far-left' || pos === 'L') return -BOUNDS_X + w/2;
            if (pos === 'center-left' || pos === 'CL') return -w/2;
            if (pos === 'center' || pos === 'C') return 0;
            if (pos === 'center-right' || pos === 'CR') return w/2;
            if (pos === 'far-right' || pos === 'R') return BOUNDS_X - w/2;
            return 0;
        };

        let cumZ = 0;
        for (let i = 0; i < wallCount; i++) {
            const rowDef = sequence[i];
            if (!rowDef) continue;
            const zMult = rowDef.zMult || 1;
            const wallZ = SPAWN_Z - cumZ;
            cumZ += zSpacing * zMult;

            for (const wDef of rowDef.walls) {
                const wParts = [];
                let centerX, wallH, wallW;

                if (wDef.customGap) {
                    wallW = baseWallW;
                    wallH = BOUNDS_Y * 0.85;
                    const gapCenterY = -BOUNDS_Y + wallH / 2;
                    const halfGap = wDef.customGap.width / 2;
                    const leftWallRight = wDef.customGap.centerX - halfGap;
                    if (leftWallRight > -BOUNDS_X) {
                        const leftWidth = leftWallRight - (-BOUNDS_X);
                        const leftX = (-BOUNDS_X + leftWallRight) / 2;
                        makeBox(scene, leftWidth, wallH, 1, leftX, gapCenterY, wallZ, matObs, wParts);
                    }
                    const rightWallLeft = wDef.customGap.centerX + halfGap;
                    if (rightWallLeft < BOUNDS_X) {
                        const rightWidth = BOUNDS_X - rightWallLeft;
                        const rightX = (rightWallLeft + BOUNDS_X) / 2;
                        makeBox(scene, rightWidth, wallH, 1, rightX, gapCenterY, wallZ, matObs, wParts);
                    }
                    obstacles.push({ parts: wParts, fadeAge: 0 });
                } else if (wDef.diagonalTop) {
                    const wallH = BOUNDS_Y * 0.85;
                    const wallCenterY = -BOUNDS_Y + wallH / 2;
                    const wallD = wDef.depth;
                    let wallX = 0;
                    if (wDef.startEdge) {
                        wallX = wDef.dir === 1 ? -BOUNDS_X * 0.8 : BOUNDS_X * 0.8;
                    }
                    const diagMat = new THREE.MeshPhongMaterial({
                        color: 0xddeeff,
                        emissive: 0x0a1115,
                        transparent: true,
                        opacity: 0,
                        side: THREE.DoubleSide,
                        depthWrite: false,
                    });
                    const diagGeo = new THREE.PlaneGeometry(wallD, wallH);
                    const diagWall = new THREE.Mesh(diagGeo, diagMat);
                    diagWall.position.set(wallX, wallCenterY, wallZ);
                    diagWall.rotation.y = wDef.dir * (Math.PI / 4);
                    scene.add(diagWall);
                    const edgeGeo = new THREE.EdgesGeometry(diagGeo);
                    const edgeMat = new THREE.LineBasicMaterial({ color: 0xbbddff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending });
                    const rim = new THREE.LineSegments(edgeGeo, edgeMat);
                    rim.position.copy(diagWall.position);
                    rim.rotation.copy(diagWall.rotation);
                    scene.add(rim);
                    wParts.push(diagWall, rim);
                    obstacles.push({ parts: wParts, fadeAge: 0, isDiagonalTop: {
                        x: wallX,
                        y: wallCenterY,
                        width: wallD,
                        height: wallH,
                        angle: wDef.dir * (Math.PI / 4)
                    } });
                } else if (wDef.fullHeightWall) {
                    const wallW = 8 + Math.random() * 6;
                    const wallH = ceilingY - floorY;
                    const wallCenterY = floorY + wallH / 2;
                    makeBox(scene, wallW, wallH, 1, wDef.x, wallCenterY, wallZ, matObs, wParts);
                    obstacles.push({ parts: wParts, fadeAge: 0 });
                } else if (wDef.small) {
                    const s = 3 + Math.random() * 2;
                    centerX = wDef.customX;
                    const centerY = wDef.customY;
                    makeBox(scene, s, s, 1, centerX, centerY, wallZ, matObs, wParts);
                    obstacles.push({ parts: wParts, fadeAge: 0 });
                } else {
                    wallW = wDef.w || w;
                    wallH = BOUNDS_Y * 0.85;
                    centerX = wDef.customX !== undefined ? wDef.customX : getX(wDef.pos);
                    const wallCenterY = -BOUNDS_Y + wallH / 2;
                    makeBox(scene, wallW, wallH, 1, centerX, wallCenterY, wallZ, matObs, wParts);
                    obstacles.push({ parts: wParts, fadeAge: 0 });
                }
            }

            if (rowDef.isDiagonal) {
                const dir = rowDef.diagDir;
                const depth = rowDef.wallDepth;
                
                // Wall center points
                const wallX = dir === 1 ? -BOUNDS_X * 0.8 : BOUNDS_X * 0.8; 
                const wallZ = SPAWN_Z - cumZ; 

                // Formation logic: Long sequence starting near center and extending past the wall
                const count = 6;
                const zStep = 12; 
                const dx = dir * 6; 

                const xOffset = -dir * 8; // Offset to start closer to center
                const startZ = wallZ + 100; 
                const startX = xOffset; 

                slots.push({ 
                    type: 'formation', 
                    x: startX, 
                    y: -BOUNDS_Y + wallH / 2, 
                    z: startZ, 
                    dx, 
                    zStep, 
                    count, 
                    patternName: 'trenchDiagonal' 
                });

                // Safe point at the far end of the wall
                const endX = wallX + (dir * depth * 0.35) + xOffset;
                const endZ = wallZ - (depth * 0.35) - 15;
                slots.push({ type: 'single', x: THREE.MathUtils.clamp(endX, -22, 22), y: -BOUNDS_Y + wallH / 2, z: endZ });

            } else if (rowDef.isWideTrench) {
                const side = Math.random() < 0.5 ? -1 : 1;
                const safeX = side * (BOUNDS_X);
                const slotY = -BOUNDS_Y + wallH / 2;
                
                if (Math.random() < 0.4) {
                    slots.push({ type: 'single', x: safeX, y: slotY, z: wallZ + 2 });
                } else {
                    // Formation angling towards the center
                    slots.push({ 
                        type: 'formation', 
                        x: safeX, 
                        y: slotY, 
                        z: wallZ - 10, 
                        dx: -side * 3.5, 
                        dy: 0, 
                        count: 4,
                        patternName: 'trenchWide'
                    });
                }
            } else if (!rowDef.noPickup && Math.random() < 0.7) {
                const safeX = rowDef.safeX !== undefined ? rowDef.safeX : getX(rowDef.safe);
                const slotY = -BOUNDS_Y + wallH / 2;
                slots.push({ type: 'single', x: safeX, y: slotY, z: wallZ });
            }
        }
        return slots;
    });

    for (let i = 1; i < totalSteps; i++) {
        steps.push(() => []);
    }

    return steps;
}

export function patternTube(params = {}) {
    const steps = [];
    const lvl = params.level || 4;

    const circleCount = params.tubeCircleCount || ((lvl >= 5) ? 4 : 3);
    const speed = params.speed || 50;

    const cutoutAngles = { 4: 90, 5: 80, 6: 70 };
    const degrees = params.tubeCutoutAngle || cutoutAngles[lvl] || 80;
    const gapWidthRad = (degrees * Math.PI) / 180;
    const rotationSpeed = params.tubeRotationSpeed || (lvl === 4 ? 0.65 : (lvl === 5 ? 0.9 : 1.2));

    // Calculate depths
    const totalSpacing = speed * 1.5;
    const circleSectionD = (circleCount - 1) * totalSpacing;
    const blockD = circleSectionD + 2; // Extremely tight: only 1 unit on each end
    
    const duration = blockD / speed;
    const interval = params.obstacleInterval || 1.6;
    const totalSteps = Math.ceil(duration / interval);

    const initialAngles = [];
    for (let i = 0; i < circleCount; i++) {
        initialAngles.push(Math.random() * Math.PI * 2);
    }

    steps.push((scene, obstacles) => {
        const tubeParts = [];
        const centerZ = SPAWN_Z - blockD / 2;
        const radius = Math.min(BOUNDS_X, BOUNDS_Y) * 0.85;
        const frontZ = centerZ + blockD / 2;
        const backZ = centerZ - blockD / 2;

        const ow = BOUNDS_X * 2.5, oh = BOUNDS_Y * 2.4;
        const circleHoleMat = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: new THREE.Color(0xddeeff) },
                uOpacity: { value: 0 },
                uGapR: { value: radius },
                uWallW: { value: ow },
                uWallH: { value: oh },
            },
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `
                uniform vec3 uColor; uniform float uOpacity; uniform float uGapR; uniform float uWallW; uniform float uWallH;
                varying vec2 vUv;
                void main() {
                    float wx = (vUv.x - 0.5) * uWallW; float wy = (vUv.y - 0.5) * uWallH;
                    if (wx*wx + wy*wy < uGapR * uGapR) discard;
                    gl_FragColor = vec4(uColor + vec3(0.05), uOpacity);
                }`,
            transparent: true, side: THREE.DoubleSide, depthWrite: false,
        });

        const frontGeo = _getCachedPlaneGeo(ow, oh);
        const front = new THREE.Mesh(frontGeo, circleHoleMat.clone());
        front.position.set(0, 0, frontZ);
        scene.add(front);
        obstacles.push({ parts: [front], fadeAge: 0, circleHole: { x: 0, y: 0, r: radius } });

        const back = new THREE.Mesh(frontGeo, circleHoleMat.clone());
        back.position.set(0, 0, backZ);
        scene.add(back);
        obstacles.push({ parts: [back], fadeAge: 0, circleHole: { x: 0, y: 0, r: radius } });

        const tubeMat = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: new THREE.Color(0xddeeff) },
                uOpacity: { value: 0 },
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uColor;
                uniform float uOpacity;
                varying vec2 vUv;
                void main() {
                    float tubeCircumference = 2.0 * 3.14159 * ${radius.toFixed(2)};
                    float tubeLength = ${blockD.toFixed(2)};
                    float gridX = abs(fract(vUv.x * 24.0) - 0.5) * (tubeCircumference / 24.0);
                    float gridY = abs(fract(vUv.y * 12.0) - 0.5) * (tubeLength / 12.0);
                    float line = min(gridX, gridY);
                    
                    vec3 color = uColor;
                    if (line < 0.03) color = vec3(0.0); // Consistent world-space thickness (Threshold: 0.03)
                    gl_FragColor = vec4(color + vec3(0.05), uOpacity * 0.35);
                }
            `,
            transparent: true, side: THREE.BackSide, depthWrite: false
        });

        const tubeGeo = _getCachedCylinderGeo(radius, radius, blockD, 48, 1, true);
        const tube = new THREE.Mesh(tubeGeo, tubeMat);
        tube.position.set(0, 0, centerZ);
        scene.add(tube);
        tubeParts.push(tube);
        obstacles.push({ parts: tubeParts, fadeAge: 0, isTube: { radius: radius, depth: blockD }, isLong: { depth: blockD } });

        const slots = [];

        const rotVertexShader = `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`;

        const rotFragmentShader = `
            uniform vec3 uColor;
            uniform float uOpacity;
            uniform float uGapR;
            uniform float uStartA;
            uniform float uEndA;
            uniform float uWallW;
            uniform float uWallH;
            uniform float uRotationSpeed;
            uniform float uTime;
            #define PI 3.14159265359
            varying vec2 vUv;
            void main() {
                float wx = (vUv.x - 0.5) * uWallW;
                float wy = (vUv.y - 0.5) * uWallH;
                float r = sqrt(wx * wx + wy * wy);
                if (r > uGapR) discard;
                
                float a = atan(wy, wx);
                if (a < 0.0) a += 2.0 * PI;
                
                float rotatedA = mod(a + uTime * uRotationSpeed, 2.0 * PI);
                
                bool inSector = false;
                if (uStartA < uEndA) {
                    inSector = (rotatedA >= uStartA && rotatedA <= uEndA);
                } else {
                    inSector = (rotatedA >= uStartA || rotatedA <= uEndA);
                }
                
                if (inSector) discard;

                if (inSector) discard;
                gl_FragColor = vec4(uColor + vec3(0.05), uOpacity);
            }`;

        const circlePlaneGeo = _getCachedPlaneGeo(ow, oh);
        const ringGeoRaw = _getCachedRingGeo(radius - 0.3, radius, 64);
        const ringGeo = _getCachedEdgesGeo(ringGeoRaw);
        const ringMat = new THREE.LineBasicMaterial({ color: 0xbb4444, transparent: true, opacity: 0, blending: THREE.AdditiveBlending });

        for (let i = 0; i < circleCount; i++) {
            const wallZ = SPAWN_Z - 1 - i * totalSpacing;
            const startA = initialAngles[i];
            let endA = startA + gapWidthRad;
            if (endA > Math.PI * 2) endA -= Math.PI * 2;

            const rotMat = new THREE.ShaderMaterial({
                uniforms: {
                    uColor: { value: new THREE.Color(0x993333) },
                    uOpacity: { value: 0 },
                    uGapR: { value: radius },
                    uStartA: { value: startA },
                    uEndA: { value: endA },
                    uWallW: { value: ow },
                    uWallH: { value: oh },
                    uRotationSpeed: { value: rotationSpeed },
                    uTime: { value: 0 },
                },
                vertexShader: rotVertexShader,
                fragmentShader: rotFragmentShader,
                transparent: true,
                side: THREE.DoubleSide,
                depthWrite: false,
            });

            const circlePlane = new THREE.Mesh(circlePlaneGeo, rotMat);
            circlePlane.position.set(0, 0, wallZ);
            scene.add(circlePlane);

            const ring = new THREE.LineSegments(ringGeo, ringMat);
            ring.position.set(0, 0, wallZ + 0.1);
            scene.add(ring);

            obstacles.push({ parts: [circlePlane, ring], fadeAge: 0, isRotatingSectorHole: { radius: radius, startAngle: initialAngles[i], endAngle: endA, speed: rotationSpeed } });
        }

        // Safe points between circles
        for (let i = 0; i < circleCount - 1; i++) {
            const wallZ = SPAWN_Z - 1 - i * totalSpacing;
            const midZ = wallZ - totalSpacing * 0.5;
            
            if (Math.random() < 0.6) {
                // Single gem
                const angle = Math.random() * Math.PI * 2;
                const r = radius * (0.2 + Math.random() * 0.3);
                slots.push({ type: 'single', x: Math.cos(angle) * r, y: Math.sin(angle) * r, z: midZ });
            } else {
                // High-value formation
                const angle = Math.random() * Math.PI * 2;
                const r = radius * 0.4;
                slots.push({ 
                    type: 'formation', 
                    x: Math.cos(angle) * r - 2, 
                    y: Math.sin(angle) * r, 
                    z: midZ + 5, 
                    dx: 1.5, 
                    zStep: 4, 
                    count: 4,
                    patternName: 'tubeFormation'
                });
            }
        }

        return slots;
    });

    for (let i = 1; i < totalSteps; i++) {
        steps.push(() => []);
    }

    // Add a delay step at the end before the next pattern spawns
    steps.push(() => []);

    return steps;
}

/** Create a textured mesh for the Simon shapes pattern. */
function createSimonShape(type, size, number, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Clear background to ensure transparency
    ctx.clearRect(0, 0, 512, 512);

    // Fill background
    ctx.fillStyle = color;
    ctx.beginPath();
    if (type === 'circle') {
        ctx.arc(256, 256, 240, 0, Math.PI * 2);
    } else if (type === 'square') {
        ctx.rect(16, 16, 480, 480);
    } else if (type === 'triangle') {
        ctx.moveTo(256, 30);
        ctx.lineTo(480, 470);
        ctx.lineTo(32, 470);
        ctx.closePath();
    }
    ctx.fill();

    // Draw number (Slightly smaller font)
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 240px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(number.toString(), 256, 275);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    const geo = new THREE.PlaneGeometry(size * 2, size * 2);
    return new THREE.Mesh(geo, mat);
}

export function patternSimon(params = {}) {
    const steps = [];
    const lvl = params.level || 5;

    const speed = params.speed || 50;

    const shapeSize = params.simonShapeSize || (lvl === 5 ? 5.5 : 5.0);
    const shapeSpacing = params.simonShapeSpacing || (lvl === 5 ? 16 : 14);
    const zSpacing = speed * 1.2; 
    const infoZSpacing = zSpacing * 0.7; // Info shapes 30% closer together

    const shapes = ['circle', 'square', 'triangle'];
    const shuffledShapes = [...shapes].sort(() => Math.random() - 0.5);
    
    // Total duration
    const blockD = zSpacing * 8; 
    const duration = blockD / speed;

    const interval = params.obstacleInterval || 1.6;
    const totalSteps = Math.ceil(duration / interval);

    steps.push((scene, obstacles) => {
        const slots = [];
        const infoY = BOUNDS_Y * 1.5; 
        const wallY = 0;              
        const startX = -shapeSpacing; 
        
        // Positions for the 3 info slots (Fixed Z-order and X-order)
        const slotZ = [SPAWN_Z, SPAWN_Z - infoZSpacing, SPAWN_Z - infoZSpacing * 2];

        for (let i = 0; i < 3; i++) {
            // i is the sequence step (1st, 2nd, 3rd)
            const shapeType = shuffledShapes[i];
            const number = i + 1;
            
            // Fixed horizontal position: Step 1 (Left), Step 2 (Middle), Step 3 (Right)
            const xPos = startX + i * shapeSpacing;
            const zPos = slotZ[i];

            const shapeColor = (shapeType === 'triangle') ? '#ff4444' 
                             : (shapeType === 'square')   ? '#44ff44' 
                             : '#4444ff';

            const infoShapeSize = shapeSize * 1.5;
            const shapeMesh = createSimonShape(shapeType, infoShapeSize, number, shapeColor);
            shapeMesh.position.set(xPos, infoY, zPos);
            scene.add(shapeMesh);
            obstacles.push({ parts: [shapeMesh], fadeAge: 0, isSimonShape: { type: shapeType, number: number } });
            
            slots.push({ type: 'formation', x: xPos, y: 0, z: zPos, dx: 1, dy: 0, count: 3 });
        }

        // Wall starts closer to the last info shape
        const wallZStart = SPAWN_Z - infoZSpacing * 2 - zSpacing * 0.8;

        for (let i = 0; i < 3; i++) {
            // Wall i corresponds to sequence step i
            const wallZ = wallZStart - i * zSpacing * 1.3; // Walls closer together
            const correctShapeType = shuffledShapes[i];

            // Randomized hole order for each wall
            const wallShapeOrder = ['triangle', 'square', 'circle'].sort(() => Math.random() - 0.5);
            const holeIndexOnWall = wallShapeOrder.indexOf(correctShapeType);

            const wallParts = [];
            const wallW = BOUNDS_X * 2.5;
            const wallH = BOUNDS_Y * 2.4;

            const wallMat = new THREE.MeshPhongMaterial({
                color: 0xddeeff,
                emissive: 0x0a1115,
                transparent: true,
                opacity: 0,
                side: THREE.DoubleSide,
                depthWrite: true, // Opaque wall
            });
            const wallMesh = new THREE.Mesh(new THREE.PlaneGeometry(wallW, wallH), wallMat);
            wallMesh.position.set(0, wallY, wallZ);
            scene.add(wallMesh);

            const edgeGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(wallW, wallH));
            const edgeMat = new THREE.LineBasicMaterial({ color: 0xbbddff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending });
            const rim = new THREE.LineSegments(edgeGeo, edgeMat);
            rim.position.set(0, wallY, wallZ);
            scene.add(rim);
            wallParts.push(wallMesh, rim);

            let holeX = 0;
            const holeSize = shapeSize * 1.2;

            for (let j = 0; j < 3; j++) {
                const sx = startX + j * shapeSpacing;
                const sy = wallY;
                const isHole = (j === holeIndexOnWall);
                const currentShapeType = wallShapeOrder[j];

                if (isHole) holeX = sx;

                const holeMat = new THREE.ShaderMaterial({
                    uniforms: {
                        uColor: { value: new THREE.Color(0xddeeff) },
                        uOpacity: { value: 0 },
                        uHoleX: { value: sx },
                        uHoleY: { value: sy },
                        uHoleR: { value: holeSize },
                        uWallW: { value: wallW },
                        uWallH: { value: wallH },
                        uIsHole: { value: isHole ? 1.0 : 0.0 },
                        uShapeType: { value: ['circle', 'square', 'triangle'].indexOf(currentShapeType) },
                        uShapeColor: { 
                            value: (currentShapeType === 'triangle') ? new THREE.Color(0xcc3333) 
                                 : (currentShapeType === 'square')   ? new THREE.Color(0x33cc33) 
                                 : new THREE.Color(0x3333cc) 
                        }
                    },
                    vertexShader: `
                        varying vec2 vUv;
                        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
                    fragmentShader: `
                        uniform vec3 uColor;
                        uniform float uOpacity;
                        uniform float uHoleX;
                        uniform float uHoleY;
                        uniform float uHoleR;
                        uniform float uWallW;
                        uniform float uWallH;
                        uniform float uIsHole;
                        uniform int uShapeType;
                        uniform vec3 uShapeColor;
                        varying vec2 vUv;
                        void main() {
                            float wx = (vUv.x - 0.5) * uWallW;
                            float wy = (vUv.y - 0.5) * uWallH;
                            float dx = wx - uHoleX;
                            float dy = wy - uHoleY;
                            
                            bool inside = false;
                            if (uShapeType == 0) { // Circle
                                inside = (dx*dx + dy*dy < uHoleR * uHoleR);
                            } else if (uShapeType == 1) { // Square
                                inside = (abs(dx) < uHoleR * 0.9 && abs(dy) < uHoleR * 0.9);
                            } else if (uShapeType == 2) { // Triangle
                                float r = uHoleR * 1.1;
                                float k = sqrt(3.0);
                                float x = dx;
                                float y = dy + r/k * 1.35; 
                                x = abs(x) - r;
                                if (x + k*y > 0.0) {
                                    float tx = x - k*y;
                                    float ty = -k*x - y;
                                    x = tx / 2.0;
                                    y = ty / 2.0;
                                }
                                x -= clamp(x, -2.0*r, 0.0);
                                inside = (-sqrt(x*x + y*y) * sign(y) < 0.0);
                            }

                            if (!inside) discard; 
                            gl_FragColor = vec4(uShapeColor, clamp(uOpacity * 1.4, 0.0, 1.0));
                        }`,
                    transparent: true,
                    side: THREE.DoubleSide,
                    depthWrite: false,
                });

                const shapeOutline = new THREE.Mesh(new THREE.PlaneGeometry(wallW, wallH), holeMat);
                shapeOutline.position.set(0, 0, wallZ + 0.1);
                scene.add(shapeOutline);
                wallParts.push(shapeOutline);
            }

            obstacles.push({ 
                parts: wallParts, 
                fadeAge: 0, 
                targetOpacity: 1.0, // Fully opaque wall
                isSimonWall: { 
                    holeX: holeX, 
                    holeY: wallY, 
                    holeR: holeSize, 
                    shapeType: correctShapeType 
                } 
            });

            // Safe pickup spawn point 0.5s after passing the hole (Twice as far back)
            slots.push({ type: 'single', x: holeX, y: wallY, z: wallZ - speed * 0.4 });

            if (i === 2 && Math.random() < 0.5) {
                slots.push({ type: 'single', x: 0, y: 0, z: wallZ });
            }
        }

        return slots;
    });

    for (let i = 1; i < totalSteps; i++) {
        steps.push(() => []);
    }

    return steps;
}

export function patternTicTacToe(params = {}) {
    const steps = [];
    const lvl = params.level || 6;

    const speed = params.speed || 50;
    const zSpacing = speed * 0.8;
    const wallCount = 5;
    const blockD = (wallCount - 1) * zSpacing;
    const duration = wallCount * (zSpacing / speed);

    const interval = params.obstacleInterval || 1.6;
    const totalSteps = Math.ceil(duration / interval);

    const gridPositions = [
        { x: -6, y: 4 }, { x: 0, y: 4 }, { x: 6, y: 4 },
        { x: -6, y: 0 }, { x: 0, y: 0 }, { x: 6, y: 0 },
        { x: -6, y: -4 }, { x: 0, y: -4 }, { x: 6, y: -4 }
    ];

    const filledPositions = new Set();
    let playerWins = false;
    let aiWins = false;

    const checkWin = (positions, player) => {
        const wins = [
            [0, 1, 2], [3, 4, 5], [6, 7, 8],
            [0, 3, 6], [1, 4, 7], [2, 5, 8],
            [0, 4, 8], [2, 4, 6]
        ];
        for (const win of wins) {
            if (win.every(idx => positions.has(idx))) {
                return true;
            }
        }
        return false;
    };

    const playerPositions = new Set();
    const aiPositions = new Set();

    steps.push((scene, obstacles) => {
        let stopped = false;

        for (let i = 0; i < wallCount && !stopped; i++) {
            const wallZ = SPAWN_Z - i * zSpacing;
            const parts = [];

            const wallMat = new THREE.MeshPhongMaterial({
                color: 0xddeeff,
                emissive: 0x0a1115,
                transparent: true,
                opacity: 0,
                side: THREE.DoubleSide,
                depthWrite: false,
            });

            const createGridWall = (offset, isVertical) => {
                const w = isVertical ? 0.3 : BOUNDS_X * 2.5;
                const h = isVertical ? BOUNDS_Y * 2.4 : 0.3;
                const geo = new THREE.PlaneGeometry(w, h);
                const mesh = new THREE.Mesh(geo, wallMat.clone());
                if (isVertical) mesh.position.set(offset, 0, wallZ);
                else mesh.position.set(0, offset, wallZ);
                scene.add(mesh);
                parts.push(mesh);

                const edgeGeo = new THREE.EdgesGeometry(geo);
                const edgeMat = new THREE.LineBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending });
                const rim = new THREE.LineSegments(edgeGeo, edgeMat);
                rim.position.copy(mesh.position);
                scene.add(rim);
                parts.push(rim);
            };

            createGridWall(-6, true);
            createGridWall(6, true);
            createGridWall(0, true);
            createGridWall(4, false);
            createGridWall(-4, false);
            createGridWall(0, false);

            for (const filledPos of filledPositions) {
                const gp = gridPositions[filledPos];
                if (gp) {
                    const markerMat = new THREE.MeshBasicMaterial({ color: 0x3333ff, transparent: true, opacity: 0 });
                    if (playerPositions.has(filledPos)) {
                        const line1 = new THREE.Line(
                            new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1.5, -1.5, 0), new THREE.Vector3(1.5, 1.5, 0)]),
                            new THREE.LineBasicMaterial({ color: 0x3333ff, transparent: true, opacity: 0 })
                        );
                        const line2 = new THREE.Line(
                            new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(1.5, -1.5, 0), new THREE.Vector3(-1.5, 1.5, 0)]),
                            new THREE.LineBasicMaterial({ color: 0x3333ff, transparent: true, opacity: 0 })
                        );
                        line1.position.set(gp.x, gp.y, wallZ + 0.2);
                        line2.position.set(gp.x, gp.y, wallZ + 0.2);
                        scene.add(line1, line2);
                        parts.push(line1, line2);
                    } else if (aiPositions.has(filledPos)) {
                        const oShape = new THREE.Mesh(
                            new THREE.RingGeometry(1.2, 1.5, 32),
                            new THREE.MeshBasicMaterial({ color: 0xff3333, transparent: true, opacity: 0, side: THREE.DoubleSide })
                        );
                        oShape.position.set(gp.x, gp.y, wallZ + 0.2);
                        scene.add(oShape);
                        parts.push(oShape);
                    }
                }
            }

            obstacles.push({ parts, fadeAge: 0 });

            if (i < wallCount - 1) {
                const availablePositions = [];
                for (let idx = 0; idx < 9; idx++) {
                    if (!filledPositions.has(idx)) {
                        availablePositions.push(idx);
                    }
                }

                if (availablePositions.length > 0) {
                    const playerChoiceIdx = Math.floor(Math.random() * availablePositions.length);
                    const playerPos = availablePositions[playerChoiceIdx];
                    playerPositions.add(playerPos);
                    filledPositions.add(playerPos);

                    if (checkWin(playerPositions, 'player')) {
                        playerWins = true;
                        stopped = true;
                    }

                    if (!stopped && availablePositions.length > 1) {
                        const remainingForAI = availablePositions.filter(idx => idx !== playerPos);
                        if (remainingForAI.length > 0) {
                            const aiChoiceIdx = Math.floor(Math.random() * remainingForAI.length);
                            const aiPos = remainingForAI[aiChoiceIdx];
                            aiPositions.add(aiPos);
                            filledPositions.add(aiPos);

                            if (checkWin(aiPositions, 'ai')) {
                                aiWins = true;
                                stopped = true;
                            }
                        }
                    }
                }
            }
        }

        const slots = [];
        if (playerWins) {
            slots.push({ type: 'single', x: 0, y: 0, z: SPAWN_Z - blockD - zSpacing, pickupType: 'fuel' });
            slots.push({ type: 'single', x: 0, y: 0, z: SPAWN_Z - blockD - zSpacing * 1.3, pickupType: 'credits' });
            slots.push({ type: 'single', x: 0, y: 0, z: SPAWN_Z - blockD - zSpacing * 1.6, pickupType: 'shield' });
        }
        return slots;
    });

    for (let i = 1; i < totalSteps; i++) {
        steps.push(() => []);
    }

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
    patternFourCorners, patternChoice, patternSuperScatter,
    patternTrench, patternTube, patternSimon, patternTicTacToe
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
            const level = params.level || 1;
            
            const LEVEL_PATTERNS = {
                1: ['patternLeftRight', 'patternTopDown', 'patternCorners', 'patternShiftingGates', 'patternNarrow', 'patternSlalomGate', 'patternScatter'],
                2: ['patternTopDown', 'patternCorners', 'patternNarrow', 'patternSlalomGate', 'patternScatter', 'patternFourCorners', 'patternChoice'],
                3: ['patternTopDown', 'patternCorners', 'patternNarrow', 'patternSlalomGate', 'patternFourCorners', 'patternChoice', 'patternSuperScatter'],
                4: ['patternTopDown', 'patternShiftingGates', 'patternChoice', 'patternTrench', 'patternTube'],
                // 4: ['patternTicTacToe'],
                5: ['patternLeftRight', 'patternShiftingGates', 'patternTrench', 'patternTube', 'patternSimon'],
                6: ['patternLeftRight', 'patternFourCorners', 'patternTrench', 'patternTube', 'patternSimon']
            };
            
            let available = LEVEL_PATTERNS[level] || LEVEL_PATTERNS[1];

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

export function isPatternFinished() {
    return (currentSteps.length > 0 && stepIdx >= currentSteps.length) || (currentSteps.length === 0);
}

export function resetSequencer() { currentSteps = []; stepIdx = 0; lastTemplateIdx = -1; currentPatternName = ''; }
