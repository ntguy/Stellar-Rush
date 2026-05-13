/* ═══════════════════════════════════════════════════════════
   LEVELS.JS  —  Stellar Rush
   ─────────────────────────────────────────────────────────
   Level definitions, difficulty parameters per level, and
   inter-level pickup formation patterns.
   ═══════════════════════════════════════════════════════════ */
import { BOUNDS_X, BOUNDS_Y, SPAWN_Z, PLANE_RADIUS } from './config.js';
import { spawnFuelPickup, spawnLowValuePickup, spawnSuperHighValuePickup } from './pickups.js';
import * as THREE from 'three';

/* ═══════════════════════════════════════════════════════════
   LEVEL DEFINITIONS — Level Scaling
   ═══════════════════════════════════════════════════════════ */
export const DEBUG_SKIP_W1 = false; // Set to true to skip to the end of Level 3 for rapid testing
export const SKIP_TO_LEVEL_5 = false; // Set to true to skip directly to Level 5

export const LEVELS = [
    {
        /* Level 1 — Blue */
        level: 1,
        duration: 40,                 // seconds
        speedMultiplier: 1.0,         // base speed multiplier
        tunnelColor: new THREE.Color(0x4488ff),  // blue
        hudColor: new THREE.Color(0x4488ff),
        obstacleInterval: 1.6,        // seconds between obstacles
        enemyInterval: 9,             // seconds between enemy waves
        enemyMaxCount: 1,             // max enemies per wave
        /* 
           difficultyParams: controls the procedural obstacle generation
           - count: number of obstacle 'steps' per pattern
           - wallSize: base scale for the physical geometry
           - gapSize: how much clearance the player has to fly through
           - gapOffset: how far from the center gaps can be shifted
           
           Patterns used: patternLeftRight, patternTopDown, patternCorners, 
           patternShiftingGates, patternNarrow, patternSlalomGate, patternScatter
        */
        difficultyParams: {           
            level: 1,
            count: 2,
            wallSize: 0.8,
            gapSize: PLANE_RADIUS * 5.5,
            gapOffset: 3,
        },
    },
    {
        /* Level 2 — Magenta */
        level: 2,
        duration: 49,                 // seconds
        speedMultiplier: 1.10,        // +10% speed
        tunnelColor: new THREE.Color(0xff44ff),  // magenta
        hudColor: new THREE.Color(0xff44ff),
        obstacleInterval: 1.5,        // faster obstacle spawn
        enemyInterval: 7,             
        enemyMaxCount: 2,             // up to 2 enemies per wave
        /* Patterns used: patternTopDown, patternCorners, patternNarrow, 
           patternSlalomGate, patternScatter, patternFourCorners, patternChoice */
        difficultyParams: {           
            level: 2,
            count: 3,
            wallSize: 1,
            gapSize: PLANE_RADIUS * 4.6,
            gapOffset: 4,
        },
    },
    {
        /* Level 3 — Red (final level of World 1) */
        level: 3,
        duration: 58,                 // 58 seconds, then world transition
        speedMultiplier: 1.25,        // +25%
        tunnelColor: new THREE.Color(0xff3333),  // red
        hudColor: new THREE.Color(0xff3333),
        obstacleInterval: 1.4,        // tight obstacle spawn
        enemyInterval: 5,             
        enemyMaxCount: 3,             // up to 3 enemies per wave
        /* Patterns used: patternTopDown, patternCorners, patternNarrow, 
           patternSlalomGate, patternFourCorners, patternChoice, patternSuperScatter */
        difficultyParams: {           
            level: 3,
            count: 3,
            wallSize: 1.2,
            gapSize: PLANE_RADIUS * 4,
            gapOffset: 5,
        },
    },
];

// Debug logic: skip to the end of level 3
if (DEBUG_SKIP_W1) {
    // Only keep level 3 and make it very short
    const lvl3 = LEVELS.find(l => l.level === 3);
    if (lvl3) {
        lvl3.duration = 4; // 4 seconds of level 3 then transition
        LEVELS.length = 0;
        LEVELS.push(lvl3);
    }
}



/* ═══════════════════════════════════════════════════════════
   WORLD 2 LEVELS  —  "The Cloud Kingdom"
   Levels 4-6 use unique difficulty parameters to scale 
   the World 2 specific obstacle patterns.
   ═══════════════════════════════════════════════════════════ */
export const WORLD_2_LEVELS = [
    {
        /* Level 4 (= World 2, Stage 1) — Sky Blue */
        level: 4,
        duration: 40,
        speedMultiplier: 1.0,
        hudColor: new THREE.Color(0x4488ff),
        timeOfDay: {
            skyColor: new THREE.Color(0x5588bb),
            fogColor: new THREE.Color(0x7799bb),
            oceanDeep: new THREE.Color(0.01, 0.04, 0.12),
            oceanSurface: new THREE.Color(0.06, 0.25, 0.35),
            oceanFog: new THREE.Color(0.55, 0.72, 0.88),
            cloudColor: new THREE.Color(0.90, 0.93, 0.98),
            ambientLight: new THREE.Color(0x88aacc),
            sunLight: new THREE.Color(0xffeedd),
            fillLight: new THREE.Color(0x6688bb),
        },
        obstacleInterval: 1.6,
        enemyInterval: 9,
        enemyMaxCount: 1,
        /* Patterns used: patternTopDown, patternShiftingGates, patternChoice, 
           patternTrench, patternTube */
        difficultyParams: {
            level: 4,
            count: 2,
            wallSize: 1.1,
            gapSize: PLANE_RADIUS * 4.5,
            gapOffset: 6,

            // World 2 Specific: Trench
            trenchWallWidthMult: 1.0,
            trenchGapWidthMult: 1.0,
            trenchAngleMult: 1.0,

            // World 2 Specific: Tube
            tubeCircleCount: 3,
            tubeCutoutAngle: 90,
            tubeRotationSpeed: 0.65,
        },
    },
    {
        /* Level 5 (= World 2, Stage 2) — Sunset Orange */
        level: 5,
        duration: 50,
        speedMultiplier: 1.10,
        hudColor: new THREE.Color(0xff8844),
        timeOfDay: {
            skyColor: new THREE.Color(0x6677aa),
            fogColor: new THREE.Color(0x8888aa),
            oceanDeep: new THREE.Color(0.01, 0.04, 0.12),
            oceanSurface: new THREE.Color(0.08, 0.20, 0.32),
            oceanFog: new THREE.Color(0.65, 0.68, 0.82),
            cloudColor: new THREE.Color(0.92, 0.88, 0.90),
            ambientLight: new THREE.Color(0x8899bb),
            sunLight: new THREE.Color(0xffddcc),
            fillLight: new THREE.Color(0x6677aa),
        },
        obstacleInterval: 1.5,
        enemyInterval: 7,
        enemyMaxCount: 2,
        /* Patterns used: patternLeftRight, patternShiftingGates, patternTrench, 
           patternTube, patternSimon */
        difficultyParams: {
            level: 5,
            count: 3,
            wallSize: 1.2,
            gapSize: PLANE_RADIUS * 4.2,
            gapOffset: 7,

            // World 2 Specific: Trench
            trenchWallWidthMult: 1.0,
            trenchGapWidthMult: 0.85,
            trenchAngleMult: 1.0,

            // World 2 Specific: Tube
            tubeCircleCount: 4,
            tubeCutoutAngle: 80,
            tubeRotationSpeed: 0.9,

            // World 2 Specific: Simon
            simonShapeSize: 5.5,
            simonShapeSpacing: 16,
        },
    },
    {
        /* Level 6 (= World 2, Stage 3) — Storm Purple */
        level: 6,
        duration: 60,
        speedMultiplier: 1.25,
        hudColor: new THREE.Color(0xaa44ff),
        timeOfDay: {
            skyColor: new THREE.Color(0x886699),
            fogColor: new THREE.Color(0x997788),
            oceanDeep: new THREE.Color(0.02, 0.03, 0.10),
            oceanSurface: new THREE.Color(0.12, 0.15, 0.28),
            oceanFog: new THREE.Color(0.72, 0.62, 0.75),
            cloudColor: new THREE.Color(0.95, 0.82, 0.75),
            ambientLight: new THREE.Color(0x9988aa),
            sunLight: new THREE.Color(0xffaa88),
            fillLight: new THREE.Color(0x7766aa),
        },
        obstacleInterval: 1.4,
        enemyInterval: 6,
        enemyMaxCount: 3,
        /* Patterns used: patternLeftRight, patternFourCorners, patternTrench, 
           patternTube, patternSimon */
        difficultyParams: {
            level: 6,
            count: 3,
            wallSize: 1.3,
            gapSize: PLANE_RADIUS * 3.8,
            gapOffset: 8,

            // World 2 Specific: Trench
            trenchWallWidthMult: 1.15,
            trenchGapWidthMult: 1.0,
            trenchAngleMult: 0.8,

            // World 2 Specific: Tube
            tubeCircleCount: 4,
            tubeCutoutAngle: 70,
            tubeRotationSpeed: 1.2,

            // World 2 Specific: Simon
            simonShapeSize: 5.5,
            simonShapeSpacing: 16,
        },
    },
];

// Skip to Level 5 logic
if (SKIP_TO_LEVEL_5) {
    const lvl5 = WORLD_2_LEVELS.find(l => l.level === 5);
    const lvl6 = WORLD_2_LEVELS.find(l => l.level === 6);
    if (lvl5) {
        WORLD_2_LEVELS.length = 0;
        WORLD_2_LEVELS.push(lvl5);
        if (lvl6) WORLD_2_LEVELS.push(lvl6);
        
        // Ensure World 1 is very fast
        if (LEVELS.length > 0) {
            LEVELS[LEVELS.length - 1].duration = 1;
        }
    }
}

/* ═══════════════════════════════════════════════════════════
   WORLDS  —  Top-level structure referencing level arrays.
   ═══════════════════════════════════════════════════════════ */
export const WORLDS = [
    { name: 'WORLD 1',  subtitle: 'Deep Space',      levels: LEVELS,        unlocked: true },
    { name: 'WORLD 2',  subtitle: 'Cloud Kingdom',   levels: WORLD_2_LEVELS, unlocked: false },
    { name: 'WORLD 3',  subtitle: 'Not Developed',             levels: null,          unlocked: false },
];

/* ═══════════════════════════════════════════════════════════
   TUNNEL COLOR TRANSITION — Level Scaling
   10-second lerp between two colours.
   ═══════════════════════════════════════════════════════════ */
export const TUNNEL_TRANSITION_DURATION = 10.0; // seconds

/**
 * Returns the interpolated tunnel colour.
 * @param {THREE.Color} fromColor
 * @param {THREE.Color} toColor
 * @param {number} t  progress 0→1
 * @returns {THREE.Color}
 */
export function lerpTunnelColor(fromColor, toColor, t) {
    const c = new THREE.Color();
    c.r = THREE.MathUtils.lerp(fromColor.r, toColor.r, t);
    c.g = THREE.MathUtils.lerp(fromColor.g, toColor.g, t);
    c.b = THREE.MathUtils.lerp(fromColor.b, toColor.b, t);
    return c;
}

/**
 * Returns an interpolated timeOfDay config object.
 */
export function lerpTimeOfDay(fromTOD, toTOD, t) {
    if (!fromTOD || !toTOD) return fromTOD;
    return {
        skyColor: fromTOD.skyColor.clone().lerp(toTOD.skyColor, t),
        fogColor: fromTOD.fogColor.clone().lerp(toTOD.fogColor, t),
        oceanDeep: fromTOD.oceanDeep.clone().lerp(toTOD.oceanDeep, t),
        oceanSurface: fromTOD.oceanSurface.clone().lerp(toTOD.oceanSurface, t),
        oceanFog: fromTOD.oceanFog.clone().lerp(toTOD.oceanFog, t),
        cloudColor: fromTOD.cloudColor.clone().lerp(toTOD.cloudColor, t),
        ambientLight: fromTOD.ambientLight.clone().lerp(toTOD.ambientLight, t),
        sunLight: fromTOD.sunLight.clone().lerp(toTOD.sunLight, t),
        fillLight: fromTOD.fillLight.clone().lerp(toTOD.fillLight, t),
    };
}


/* ═══════════════════════════════════════════════════════════
   INTER-LEVEL PICKUP FORMATIONS
   ─────────────────────────────────────────────────────────
   These are purely pickup patterns (no obstacles/enemies).
   Each returns an array of { x, y, zOffset } positions
   for fuel pickups, spaced along the Z axis.
   
   Unlike the slot-based obstacle pattern system, these
   generate a complete set of world positions up front.
   ═══════════════════════════════════════════════════════════ */

const Z_STEP = 11;  // Z spacing between pickups in a formation

/**
 * Huge spiral — pickups trace a spiral through the tunnel.
 */
function formationSpiral() {
    const points = [];
    const turns = 2;
    const count = 28;
    const maxRadius = Math.min(BOUNDS_X, BOUNDS_Y) * 0.5;
    for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        const angle = t * turns * Math.PI * 2;
        const r = maxRadius * (0.2 + t * 0.8);
        points.push({
            x: Math.cos(angle) * r,
            y: (Math.sin(angle) * r) + 3,
            zOffset: -i * Z_STEP,
        });
    }
    return points;
}

/**
 * Square — right, down, left, up back to start.
 */
function formationSquare() {
    const points = [];
    const halfW = BOUNDS_X * 0.4;
    const halfH = BOUNDS_Y * 0.4;
    const perSide = 6;
    let idx = 0;

    // Right
    for (let i = 0; i < perSide; i++) {
        const t = i / (perSide - 1);
        points.push({ x: THREE.MathUtils.lerp(-halfW, halfW, t), y: halfH, zOffset: -idx * Z_STEP });
        idx++;
    }
    // Down
    for (let i = 1; i < perSide; i++) {
        const t = i / (perSide - 1);
        points.push({ x: halfW, y: THREE.MathUtils.lerp(halfH, -halfH, t), zOffset: -idx * Z_STEP });
        idx++;
    }
    // Left
    for (let i = 1; i < perSide; i++) {
        const t = i / (perSide - 1);
        points.push({ x: THREE.MathUtils.lerp(halfW, -halfW, t), y: -halfH, zOffset: -idx * Z_STEP });
        idx++;
    }
    // Up
    for (let i = 1; i < perSide - 1; i++) {
        const t = i / (perSide - 1);
        points.push({ x: -halfW, y: THREE.MathUtils.lerp(-halfH, halfH, t), zOffset: -idx * Z_STEP });
        idx++;
    }
    return points;
}

/**
 * Diamond — same as square but rotated 45°.
 */
function formationDiamond() {
    const points = [];
    const size = Math.min(BOUNDS_X, BOUNDS_Y) * 0.55;
    const perSide = 6;
    let idx = 0;

    // Top-right edge
    for (let i = 0; i < perSide; i++) {
        const t = i / (perSide - 1);
        points.push({ x: THREE.MathUtils.lerp(0, size, t), y: THREE.MathUtils.lerp(size, 0, t), zOffset: -idx * Z_STEP });
        idx++;
    }
    // Bottom-right edge
    for (let i = 1; i < perSide; i++) {
        const t = i / (perSide - 1);
        points.push({ x: THREE.MathUtils.lerp(size, 0, t), y: THREE.MathUtils.lerp(0, -size, t), zOffset: -idx * Z_STEP });
        idx++;
    }
    // Bottom-left edge
    for (let i = 1; i < perSide; i++) {
        const t = i / (perSide - 1);
        points.push({ x: THREE.MathUtils.lerp(0, -size, t), y: THREE.MathUtils.lerp(-size, 0, t), zOffset: -idx * Z_STEP });
        idx++;
    }
    // Top-left edge
    for (let i = 1; i < perSide - 1; i++) {
        const t = i / (perSide - 1);
        points.push({ x: THREE.MathUtils.lerp(-size, 0, t), y: THREE.MathUtils.lerp(0, size, t), zOffset: -idx * Z_STEP });
        idx++;
    }
    return points;
}

/**
 * Z shape — horizontal top, diagonal middle, horizontal bottom.
 */
function formationZ() {
    const points = [];
    const halfW = BOUNDS_X * 0.4;
    const halfH = BOUNDS_Y * 0.5;
    const perSegment = 7;
    let idx = 0;

    // Top horizontal (left to right)
    for (let i = 0; i < perSegment; i++) {
        const t = i / (perSegment - 1);
        points.push({ x: THREE.MathUtils.lerp(-halfW, halfW, t), y: halfH, zOffset: -idx * (Z_STEP * 1.5) });
        idx++;
    }
    // Diagonal (top-right to bottom-left)
    for (let i = 1; i < perSegment; i++) {
        const t = i / (perSegment - 1);
        points.push({ x: THREE.MathUtils.lerp(halfW, -halfW, t), y: THREE.MathUtils.lerp(halfH, -halfH, t), zOffset: -idx * (Z_STEP * 1.5) });
        idx++;
    }
    // Bottom horizontal (left to right)
    for (let i = 1; i < perSegment; i++) {
        const t = i / (perSegment - 1);
        points.push({ x: THREE.MathUtils.lerp(-halfW, halfW, t), y: -halfH, zOffset: -idx * (Z_STEP * 1.5) });
        idx++;
    }
    return points;
}

/**
 * Figure-8 — two circles stacked vertically.
 */
function formationEight() {
    const points = [];
    const r = Math.min(BOUNDS_X, BOUNDS_Y) * 0.6;
    const count = 25;
    let idx = 0;

    for (let i = 0; i < count; i++) {
        const t = i / count;
        const angle = t * Math.PI * 2;
        // Lemniscate-like figure 8
        const x = Math.sin(angle) * r;
        const y = Math.sin(angle * 2) * r * 0.5;
        points.push({ x, y, zOffset: -idx * Z_STEP });
        idx++;
    }
    return points;
}


/* ── All formations, picked randomly ──────────────────────── */
const ALL_FORMATIONS = [
    formationSpiral,
    formationSquare,
    formationDiamond,
    formationZ,
    formationEight,
];

/**
 * Spawns a random inter-level pickup formation.
 * Returns the total Z depth of the formation so we know
 * how long to wait before starting the next level.
 *
 * @param {THREE.Scene} scene
 * @returns {{ totalDepth: number }}  absolute Z span of the formation
 */
export function spawnInterLevelFormation(scene, speed = 0, spawnSuper = false) {
    const formationFn = ALL_FORMATIONS[Math.floor(Math.random() * ALL_FORMATIONS.length)];
    const positions = formationFn();

    let minZ = 0;
    let lastPos = null;

    for (const pos of positions) {
        spawnLowValuePickup(scene, 
            pos.x,
            pos.y,
            SPAWN_Z + (pos.zOffset || 0)
        );
        if (pos.zOffset < minZ) {
            minZ = pos.zOffset;
            lastPos = pos;
        }
    }

    // Spawn a fuel pickup at the very end of the formation trail
    if (lastPos) {
        spawnFuelPickup(scene, {
            x: lastPos.x,
            y: lastPos.y,
            z: SPAWN_Z + lastPos.zOffset - Z_STEP // Further away = absolute last item
        });
    }

    // Total depth = how far back the formation extends (including the fuel pickup)
    let totalDepth = Math.abs(minZ) + Z_STEP;

    // Optional: Spawn a super high value pickup (500 credits) 3 seconds after the fuel
    if (spawnSuper && lastPos && speed) {
        const superOffset = speed * 2.0;
        spawnSuperHighValuePickup(scene, {
            x: 0,
            y: 0,
            z: SPAWN_Z + lastPos.zOffset - Z_STEP - superOffset
        });
        totalDepth += superOffset;
    }

    return { totalDepth };
}
