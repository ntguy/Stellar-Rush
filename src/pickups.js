import * as THREE from 'three';
import {
    SPAWN_Z, DESPAWN_Z, BOUNDS_X, BOUNDS_Y, PLANE_RADIUS,
    FUEL_MAX, SHIELD_DURATION, matShield
} from './config.js';

/* ═══════════════════════════════════════════════════════════
   SHARED STATE
   ═══════════════════════════════════════════════════════════ */
export const pickups = [];

// Collection radius — wider than PLANE_RADIUS so pickups feel generous to grab
// TODO fine tune this and check that it works for all pickups
// TODO put on github asap
const COLLECT_RADIUS = PLANE_RADIUS * 3;

/* ═══════════════════════════════════════════════════════════
   COLLECTION BURST PARTICLES
   Small pool of fast-decaying colour sparks spawned when any
   pickup is collected.
   ═══════════════════════════════════════════════════════════ */
const burstParticles = [];
const burstGeo = new THREE.OctahedronGeometry(0.15, 0);

export function spawnCollectBurst(scene, pos, colour) {
    for (let i = 0; i < 10; i++) {
        const mat = new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 1 });
        const m = new THREE.Mesh(burstGeo, mat);
        m.position.copy(pos);
        const spd = 4 + Math.random() * 10;
        m.userData.vel = new THREE.Vector3(
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 2
        ).normalize().multiplyScalar(spd);
        m.userData.life = 1.0;
        scene.add(m);
        burstParticles.push(m);
    }
}

export function updateBurstParticles(scene, dt) {
    for (let i = burstParticles.length - 1; i >= 0; i--) {
        const p = burstParticles[i];
        p.userData.life -= dt * 4.5;   // fast fade
        if (p.userData.life <= 0) {
            scene.remove(p);
            burstParticles.splice(i, 1);
            continue;
        }
        p.position.addScaledVector(p.userData.vel, dt);
        p.userData.vel.multiplyScalar(0.92);  // dampen
        p.material.opacity = p.userData.life;
        p.scale.setScalar(p.userData.life * 0.8 + 0.2);
    }
}

export function clearBurstParticles(scene) {
    for (const p of burstParticles) scene.remove(p);
    burstParticles.length = 0;
}

/* ═══════════════════════════════════════════════════════════
   PICKUP TYPES
   ═══════════════════════════════════════════════════════════ */

/** Yellow octahedron — refills fuel tank.
 *  If pos {x,y,z} is provided, spawns there; otherwise random. */
export function spawnFuelPickup(scene, pos) {
    const matPU = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(1.0, 0), matPU);

    const hazeMat = new THREE.MeshBasicMaterial({
        color: 0xffdd44, transparent: true, opacity: 0.18,
        side: THREE.BackSide, depthWrite: false,
    });
    m.add(new THREE.Mesh(new THREE.SphereGeometry(2.8, 8, 6), hazeMat));
    m.add(new THREE.PointLight(0xffcc00, 4, 22));
    if (pos) {
        m.position.set(pos.x, pos.y, pos.z);
    } else {
        m.position.set(
            (Math.random() - 0.5) * BOUNDS_X * 0.7,
            (Math.random() - 0.5) * BOUNDS_Y * 0.5,
            SPAWN_Z
        );
    }
    scene.add(m);
    pickups.push({ mesh: m, type: 'fuel' });
}

/* ── High-value points pickup ─────────────────────────────
   Large glowing green octahedron.  Worth 200 pts.
   Spawned by the pickup scheduler (not in formation). */
export function spawnHighValuePickup(scene, pos) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x22ff66 });
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(1.1, 0), mat);

    const hazeMat = new THREE.MeshBasicMaterial({
        color: 0x44ff88, transparent: true, opacity: 0.20,
        side: THREE.BackSide, depthWrite: false,
    });
    m.add(new THREE.Mesh(new THREE.SphereGeometry(3.0, 8, 6), hazeMat));
    m.add(new THREE.PointLight(0x44ff88, 3, 18));

    if (pos) {
        m.position.set(pos.x, pos.y, pos.z);
    } else {
        m.position.set(
            (Math.random() - 0.5) * BOUNDS_X * 0.8,
            (Math.random() - 0.5) * BOUNDS_Y * 0.6,
            SPAWN_Z
        );
    }
    scene.add(m);
    pickups.push({ mesh: m, type: 'points_high' });
}

/* ── Low-value points pickup ──────────────────────────────
   Small dim gem.  Worth 40 pts.  Spawned in formations.
   worldX/Y/Z are absolute world positions — caller places them. */
function _spawnLowPickupAt(scene, wx, wy, wz) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x55ee99 });
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), mat);
    m.add(new THREE.PointLight(0x44ff88, 1, 8));
    m.position.set(wx, wy, wz);
    scene.add(m);
    pickups.push({ mesh: m, type: 'points_low' });
}

/* Formation patterns for low-value pickups.
   Z is staggered so pickups arrive closer together.
   (at base speed ~45 u/s, spacing = 14 units ≈ 0.31 s).
   
   If a corridor {x, y, z} is provided, it's used as the starting point.
   Direction is always randomly generated locally (ignoring corridor.dx/dy). */
const LOW_Z_STEP = 14;  // world-units between successive pickups in a formation

function _lowFormationDiagonal(scene, corridor) {
    const count = 3 + Math.floor(Math.random() * 3);  // 3–5
    const ox = corridor ? corridor.x : (Math.random() - 0.5) * BOUNDS_X * 0.5;
    const oy = corridor ? corridor.y : (Math.random() - 0.5) * BOUNDS_Y * 0.4;
    const baseZ = corridor ? corridor.z : SPAWN_Z;
    // Generate random direction locally
    const dx = (Math.random() < 0.5 ? 1 : -1) * (2.5 + Math.random());
    const dy = (Math.random() < 0.5 ? 1 : -1) * (2.0 + Math.random());
    for (let i = 0; i < count; i++) {
        _spawnLowPickupAt(scene, ox + dx * i, oy + dy * i, baseZ - i * LOW_Z_STEP);
    }
}

function _lowFormationSemicircle(scene, corridor) {
    const count = 3 + Math.floor(Math.random() * 3);  // 3–5
    const r = 3 + Math.random() * 2.5;
    const cx = corridor ? corridor.x : (Math.random() - 0.5) * BOUNDS_X * 0.4;
    const cy = corridor ? corridor.y : (Math.random() - 0.5) * BOUNDS_Y * 0.3;
    const baseZ = corridor ? corridor.z : SPAWN_Z;
    const startAngle = Math.random() * Math.PI * 2;
    const angle = Math.PI;
    for (let i = 0; i < count; i++) {
        const a = startAngle + (i / Math.max(1, count - 1)) * angle;
        _spawnLowPickupAt(scene, cx + Math.cos(a) * r, cy + Math.sin(a) * r, baseZ - i * LOW_Z_STEP);
    }
}

function _lowFormationLine(scene, corridor, obstacles) {
    const count = 3 + Math.floor(Math.random() * 3);  // 3–5
    const vert = Math.random() < 0.5;

    // Determine safe starting position
    let ox, oy, baseZ;
    do {
        ox = corridor ? corridor.x : (Math.random() - 0.5) * BOUNDS_X * 0.5;
        oy = corridor ? corridor.y : (Math.random() - 0.5) * BOUNDS_Y * 0.4;
        baseZ = corridor ? corridor.z : SPAWN_Z + 10; // Ensure Z is significantly forward
    } while (!isSafePosition(ox, oy, obstacles));

    const spacing = 2.0 + Math.random() * 1.5;
    for (let i = 0; i < count; i++) {
        const x = ox + (vert ? 0 : (i - count / 2) * spacing);
        const y = oy + (vert ? (i - count / 2) * spacing : 0);
        const pickup = _spawnLowPickupAt(scene, x, y, baseZ - i * LOW_Z_STEP);

        // Add fade-in effect
        if (pickup) {
            pickup.material.opacity = 0;
            new TWEEN.Tween(pickup.material)
                .to({ opacity: 1 }, 1000) // Fade in over 1 second
                .start();
        }
    }
}

function isSafePosition(x, y, obstacles) {
    // Check against obstacles for safe distance
    for (const obstacle of obstacles) {
        const dx = x - obstacle.x;
        const dy = y - obstacle.y;
        if (Math.sqrt(dx * dx + dy * dy) < 10) return false; // Example safe distance
    }
    return true;
}

const LOW_FORMATIONS = [_lowFormationDiagonal, _lowFormationSemicircle, _lowFormationLine];

/** Spawn a random low-value formation.
 *  If corridor {x, y, z, dx, dy} is given, the formation is anchored there. */
export function spawnLowValueFormation(scene, corridor, obstacles) {
    const fn = LOW_FORMATIONS[Math.floor(Math.random() * LOW_FORMATIONS.length)];
    fn(scene, corridor, obstacles);
}

/** Blue torus — temporary shield.
 *  If pos {x,y,z} is provided, spawns there; otherwise random. */
export function spawnShieldPickup(scene, pos) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.2, 6, 8), matShield.clone());
    m.material.opacity = 0.7;
    if (pos) {
        m.position.set(pos.x, pos.y, pos.z);
    } else {
        m.position.set(
            (Math.random() - 0.5) * BOUNDS_X * 0.6,
            (Math.random() - 0.5) * BOUNDS_Y * 0.5,
            SPAWN_Z
        );
    }
    m.add(new THREE.PointLight(0x33aaff, 1.5, 10));
    scene.add(m);
    pickups.push({ mesh: m, type: 'shield' });
}

/* ═══════════════════════════════════════════════════════════
   UPDATE  — returns pickup effect if collected this frame
   ═══════════════════════════════════════════════════════════ */

/**
 * Returns { fuel, points, pointsPos, shield } with amounts gained this frame.
 * pointsPos is the world position of the collected pickup (for burst FX).
 */
export function updatePickups(scene, dt, speed, aircraftPos) {
    const result = { fuel: 0, points: 0, pointsPos: null, shield: 0 };
    for (let i = pickups.length - 1; i >= 0; i--) {
        const p = pickups[i];
        p.mesh.position.z += speed * dt;
        p.mesh.rotation.y += dt * 3;
        p.mesh.rotation.x += dt * 1.7;

        // Collection — use expanded COLLECT_RADIUS for generous feel
        if (aircraftPos.distanceTo(p.mesh.position) < COLLECT_RADIUS) {
            switch (p.type) {
                case 'fuel':         result.fuel   = FUEL_MAX;  break;
                case 'points_high':  result.points += 200; result.pointsPos = p.mesh.position.clone(); break;
                case 'points_low':   result.points += 40;  result.pointsPos = p.mesh.position.clone(); break;
                case 'shield':       result.shield = SHIELD_DURATION; break;
            }
            scene.remove(p.mesh);
            pickups.splice(i, 1);
            continue;
        }

        if (p.mesh.position.z > DESPAWN_Z) {
            scene.remove(p.mesh);
            pickups.splice(i, 1);
        }
    }
    return result;
}

export function clearPickups(scene) {
    for (const p of pickups) scene.remove(p.mesh);
    pickups.length = 0;
    clearBurstParticles(scene);
}
