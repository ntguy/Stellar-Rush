/* ═══════════════════════════════════════════════════════════
   LEVELS.JS  —  Stellar Rush
   ─────────────────────────────────────────────────────────
   Level definitions, difficulty parameters per level, and
   inter-level pickup formation patterns.
   ═══════════════════════════════════════════════════════════ */
import { BOUNDS_X, BOUNDS_Y, SPAWN_Z, PLANE_RADIUS } from './config.js';
import { spawnFuelPickup, spawnLowValuePickup } from './pickups.js';
import * as THREE from 'three';

/* ═══════════════════════════════════════════════════════════
   LEVEL DEFINITIONS — Level Scaling
   ═══════════════════════════════════════════════════════════ */
export const LEVELS = [
    {
        /* Level 1 — Blue */
        level: 1,
        duration: 45,                 // seconds
        speedMultiplier: 1.0,         // base speed multiplier
        tunnelColor: new THREE.Color(0x4488ff),  // blue
        obstacleInterval: 1.6,        // seconds between obstacles
        enemyInterval: 9,             // seconds between enemy waves
        enemyMaxCount: 1,             // max enemies per wave
        /* 
           difficultyParams: controls the procedural obstacle generation
           - count: number of obstacle 'steps' per pattern
           - wallSize: base scale for the physical geometry
           - gapSize: how much clearance the player has to fly through
           - gapOffset: how far from the center gaps can be shifted
        */
        difficultyParams: {           
            count: 2,
            wallSize: 0.8,
            gapSize: PLANE_RADIUS * 5.5,
            gapOffset: 3,
        },
    },
    {
        /* Level 2 — Magenta */
        level: 2,
        duration: 60,                 // seconds
        speedMultiplier: 1.10,        // +10% speed
        tunnelColor: new THREE.Color(0xff44ff),  // magenta
        obstacleInterval: 1.5,        // faster obstacle spawn
        enemyInterval: 7,             
        enemyMaxCount: 2,             // up to 2 enemies per wave
        difficultyParams: {           
            count: 3,
            wallSize: 1,
            gapSize: PLANE_RADIUS * 4.6,
            gapOffset: 4,
        },
    },
    {
        /* Level 3 — Red (final, infinite) */
        level: 3,
        duration: Infinity,           // lasts forever
        speedMultiplier: 1.25,        // +25%
        tunnelColor: new THREE.Color(0xff3333),  // red
        obstacleInterval: 1.4,        // tight obstacle spawn
        enemyInterval: 5,             
        enemyMaxCount: 3,             // up to 3 enemies per wave
        difficultyParams: {           
            count: 3,
            wallSize: 1.2,
            gapSize: PLANE_RADIUS * 4,
            gapOffset: 5,
        },
        // minor speed ramp only on the final level
        speedRampPerSecond: 0.15,
    },
];

/* ═══════════════════════════════════════════════════════════
   TUNNEL COLOR TRANSITION — Level Scaling
   5-second lerp between two colours.
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
export function spawnInterLevelFormation(scene) {
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
    return { totalDepth: Math.abs(minZ) + Z_STEP };
}
