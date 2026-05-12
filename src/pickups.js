import * as THREE from 'three';
import {
    SPAWN_Z, DESPAWN_Z, BOUNDS_X, BOUNDS_Y, PLANE_RADIUS,
    FUEL_MAX, FUEL_PICKUP_VALUE, SHIELD_DURATION, matShield,
    OBS_FADE_TIME, OBS_TARGET_OPACITY,
    PICKUP_EDGE_LOG_THRESHOLD, ENABLE_PICKUP_EDGE_LOG
} from './config.js';

import { playCollect1, playCollect2 } from './audio.js';
import { settings } from './settings.js';

/* ── Reusable vectors (avoid per-frame GC pressure) ───────── */
const _magnetDir = new THREE.Vector3();

/* ═══════════════════════════════════════════════════════════
   SHARED GEOMETRIES & MATERIALS
   ═══════════════════════════════════════════════════════════ */
const fuelGeo = new THREE.CapsuleGeometry( 0.7, 1, 6, 12, 1 );
const fuelMat = new THREE.MeshStandardMaterial({ 
    color: 0xffcc00, 
    metalness: 0.8, 
    roughness: 0.1, 
    emissive: 0xff8800, 
    emissiveIntensity: 0.7
});
const fuelHazeGeo = new THREE.SphereGeometry(2.8, 16, 8);
const fuelHazeMat = new THREE.MeshBasicMaterial({ color: 0xffdd44, transparent: true, opacity: 0.18, side: THREE.BackSide, depthWrite: false });

const highValueGeo = new THREE.IcosahedronGeometry(1.3, 0);
const highValueMat = new THREE.MeshBasicMaterial({ color: 0x22ff66 });
const highValueHazeGeo = new THREE.SphereGeometry(2.8, 16, 8);
const highValueHazeMat = new THREE.MeshBasicMaterial({ color: 0x44ff88, transparent: true, opacity: 0.18, side: THREE.BackSide, depthWrite: false });

const shieldGeo = new THREE.TorusGeometry(0.7, 0.25, 6, 8);
const shieldMatClone = matShield.clone();
shieldMatClone.opacity = 0.7;

const shieldHazeGeo = new THREE.SphereGeometry(2.8, 16, 8);
const shieldHazeMat = new THREE.MeshBasicMaterial({ color: 0x44aaff, transparent: true, opacity: 0.18, side: THREE.BackSide, depthWrite: false });

/* ═══════════════════════════════════════════════════════════
   SHARED STATE
   ═══════════════════════════════════════════════════════════ */
export const pickups = [];

// Collection radius — wider than PLANE_RADIUS so pickups feel generous to grab
function getCollectRadius(aircraftPos) {
    const dx = Math.abs(aircraftPos.x) / (BOUNDS_X * 0.5);
    const dy = Math.abs(aircraftPos.y) / (BOUNDS_Y * 0.5);
    const edgeProximity = Math.max(dx, dy);
    const base = PLANE_RADIUS * 2;
    const maxScale = 1.4; 
    const scale = 1 + (maxScale - 1) * Math.min(edgeProximity, 1);
    return base * scale;
}

function logIfCloseToEdge(pos, type, patternName = 'Unknown') {
    if (!ENABLE_PICKUP_EDGE_LOG) return;
    
    const distLeft   = pos.x - (-BOUNDS_X);
    const distRight  = BOUNDS_X - pos.x;
    const distBottom = pos.y - (-BOUNDS_Y);
    const distTop    = BOUNDS_Y - pos.y;

    const minX = Math.min(distLeft, distRight);
    const minY = Math.min(distBottom, distTop);
    const minDist = Math.min(minX, minY);

    if (minDist <= PICKUP_EDGE_LOG_THRESHOLD) {
        const edge = minX < minY 
            ? (distLeft < distRight ? 'LEFT' : 'RIGHT')
            : (distBottom < distTop ? 'BOTTOM' : 'TOP');
            
        console.warn(`[Edge Warning] Pickup (${type}) spawned near ${edge} edge!`, {
            pattern: patternName,
            position: { x: pos.x.toFixed(2), y: pos.y.toFixed(2) },
            distanceFromEdge: minDist.toFixed(2),
            threshold: PICKUP_EDGE_LOG_THRESHOLD
        });
    }
}

/* ═══════════════════════════════════════════════════════════
   COLLECTION BURST PARTICLES
   ═══════════════════════════════════════════════════════════ */
const burstParticles = [];
const burstGeo = new THREE.OctahedronGeometry(0.15, 0);

// Pre-allocated material pool for burst particles to avoid per-collection allocation
const BURST_MAT_POOL_SIZE = 80;
const _burstMatPool = [];
let _burstMatPoolIdx = 0;
for (let i = 0; i < BURST_MAT_POOL_SIZE; i++) {
    _burstMatPool.push(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 }));
}
function _getBurstMat(colour) {
    const mat = _burstMatPool[_burstMatPoolIdx % BURST_MAT_POOL_SIZE];
    _burstMatPoolIdx++;
    mat.color.set(colour);
    mat.opacity = 1;
    return mat;
}

export function spawnCollectBurst(scene, pos, colour) {
    const count = settings.preset === 'Low' ? 5 : 10;
    for (let i = 0; i < count; i++) {
        const mat = _getBurstMat(colour);
        const m = new THREE.Mesh(burstGeo, mat);
        m.position.copy(pos);
        const spd = 4 + Math.random() * 10;
        if (!m.userData.vel) m.userData.vel = new THREE.Vector3();
        m.userData.vel.set(
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
        p.userData.life -= dt * 4.5;
        if (p.userData.life <= 0) {
            scene.remove(p);
            // Materials are pooled, no dispose needed
            burstParticles.splice(i, 1);
            continue;
        }
        p.position.addScaledVector(p.userData.vel, dt);
        p.userData.vel.multiplyScalar(0.92);
        p.material.opacity = p.userData.life;
        p.scale.setScalar(p.userData.life * 0.8 + 0.2);
    }
}

export function clearBurstParticles(scene) {
    for (const p of burstParticles) {
        scene.remove(p);
        // Materials are pooled, no dispose needed
    }
    burstParticles.length = 0;
}

/* ═══════════════════════════════════════════════════════════
   PICKUP TYPES
   ═══════════════════════════════════════════════════════════ */

export function spawnFuelPickup(scene, pos) {
    const mainMat = fuelMat.clone();
    mainMat.transparent = true;
    mainMat.opacity = 0;
    const m = new THREE.Mesh(fuelGeo, mainMat);

    const hazeMat = fuelHazeMat.clone();
    hazeMat.opacity = 0;
    const haze = new THREE.Mesh(fuelHazeGeo, hazeMat);
    m.add(haze);

    m.add(new THREE.PointLight(0xffcc00, 0, 22));
    if (pos) {
        m.position.set(pos.x, pos.y, pos.z);
    } else {
        m.position.set((Math.random() - 0.5) * BOUNDS_X * 0.7, (Math.random() - 0.5) * BOUNDS_Y * 0.5, SPAWN_Z);
    }
    scene.add(m);
    pickups.push({ mesh: m, type: 'fuel', fadeAge: 0, haze });
    if (pos && pos.patternName) logIfCloseToEdge(m.position, 'fuel', pos.patternName);
}

export function spawnHighValuePickup(scene, pos) {
    const mainMat = highValueMat.clone();
    mainMat.transparent = true;
    mainMat.opacity = 0;
    const m = new THREE.Mesh(highValueGeo, mainMat);

    const hazeMat = highValueHazeMat.clone();
    hazeMat.opacity = 0;
    const haze = new THREE.Mesh(highValueHazeGeo, hazeMat);
    m.add(haze);

    m.add(new THREE.PointLight(0x44ff88, 0, 18));
    if (pos) {
        m.position.set(pos.x, pos.y, pos.z);
    } else {
        m.position.set((Math.random() - 0.5) * BOUNDS_X * 0.8, (Math.random() - 0.5) * BOUNDS_Y * 0.6, SPAWN_Z);
    }
    scene.add(m);
    pickups.push({ mesh: m, type: 'credits_high', fadeAge: 0, haze });
    if (pos && pos.patternName) logIfCloseToEdge(m.position, 'credits_high', pos.patternName);
}

const _lowGeo = new THREE.OctahedronGeometry(0.55, 0);
const _lowMat = new THREE.MeshBasicMaterial({ color: 0x55ee99 });

let formationIdCounter = 0;
const formationTracker = {};

export function spawnLowValuePickup(scene, wx, wy, wz, formationId = null) {
    const mat = _lowMat.clone();
    mat.transparent = true;
    mat.opacity = 0;
    const m = new THREE.Mesh(_lowGeo, mat);
    m.position.set(wx, wy, wz);
    if (formationId) m.userData.formationId = formationId;
    scene.add(m);
    pickups.push({ mesh: m, type: 'credits_low', fadeAge: 0 });
    if (formationId && formationTracker[formationId] && formationTracker[formationId].patternName) {
        logIfCloseToEdge(m.position, 'credits_low', formationTracker[formationId].patternName);
    }
}

export function spawnLowValueFormation(scene, slot) {
    if (!slot) return;
    const count = slot.count ?? 4;
    const dx    = slot.dx   ?? 0;
    const dy    = slot.dy   ?? 0;
    const zStep = slot.zStep ?? 8;
    const startZ = slot.z ?? SPAWN_Z;
    
    const fid = ++formationIdCounter;
    formationTracker[fid] = { total: count, collected: 0, patternName: slot.patternName || 'Unknown' };
    
    for (let i = 0; i < count; i++) {
        spawnLowValuePickup(scene, slot.x + dx * i, slot.y + dy * i, startZ - i * zStep, fid);
    }
}

export function spawnShieldPickup(scene, pos) {
    const mat = shieldMatClone.clone();
    mat.transparent = true;
    mat.opacity = 0;
    const m = new THREE.Mesh(shieldGeo, mat);

    const hazeMat = shieldHazeMat.clone();
    hazeMat.opacity = 0;
    const haze = new THREE.Mesh(shieldHazeGeo, hazeMat);
    m.add(haze);

    if (pos) {
        m.position.set(pos.x, pos.y, pos.z);
    } else {
        m.position.set((Math.random() - 0.5) * BOUNDS_X * 0.6, (Math.random() - 0.5) * BOUNDS_Y * 0.5, SPAWN_Z);
    }
    m.add(new THREE.PointLight(0x33aaff, 0, 10));
    scene.add(m);
    pickups.push({ mesh: m, type: 'shield', fadeAge: 0, haze });
    if (pos && pos.patternName) logIfCloseToEdge(m.position, 'shield', pos.patternName);
}

/* ═══════════════════════════════════════════════════════════
   UPDATE
   ═══════════════════════════════════════════════════════════ */

export function updatePickups(scene, dt, speed, aircraftPos, magnetStrength = 0) {
    const result = { fuel: 0, credits: 0, creditsPos: null, shield: 0, formationCompleted: false };
    for (let i = pickups.length - 1; i >= 0; i--) {
        const p = pickups[i];
        p.mesh.position.z += speed * dt;
        if (p.type === 'fuel') {
            p.mesh.rotation.y -= dt * 4.0;
            p.mesh.rotation.x -= dt * 2.5;
        } else {
            p.mesh.rotation.y += dt * 3;
            p.mesh.rotation.x += dt * 1.7;
        }

        // Handle fade-in
        if (p.fadeAge < OBS_FADE_TIME) {
            p.fadeAge += dt;
            const t = Math.min(p.fadeAge / OBS_FADE_TIME, 1.0);
            const opacity = t * OBS_TARGET_OPACITY;
            p.mesh.material.opacity = opacity;
            if (p.haze) {
                // Fading haze to its target opacity (0.18 or 0.20)
                const targetHaze = p.type === 'fuel' ? 0.18 : 0.20;
                p.haze.material.opacity = t * targetHaze;
            }
            // Fade point lights if they exist
            p.mesh.children.forEach(c => {
                if (c.isPointLight) {
                    const targetInt = (p.type === 'fuel') ? 4 : (p.type === 'credits_high' || p.type === 'shield' ? 3 : 1.5);
                    c.intensity = t * targetInt;
                }
            });
        }

        if (magnetStrength > 0) {
            // Upgrade Logic: Magnet attracts nearby pickups
            const dist = p.mesh.position.distanceTo(aircraftPos);
            if (dist < 15) {
                _magnetDir.copy(aircraftPos).sub(p.mesh.position).normalize();
                p.mesh.position.addScaledVector(_magnetDir, magnetStrength * dt);
            }
        }

        if (aircraftPos.distanceTo(p.mesh.position) < getCollectRadius(aircraftPos)) {
            switch (p.type) {
                case 'fuel':
                    result.fuel = FUEL_PICKUP_VALUE;
                    playCollect1();
                    break;

                case 'credits_high':
                    result.credits += 200;
                    result.creditsPos = p.mesh.position.clone();
                    playCollect1();
                    break;
                case 'credits_low':
                    result.credits += 40;
                    result.creditsPos = p.mesh.position.clone();
                    // Upgrade Logic: Formation Bonus tracking
                    if (p.mesh.userData.formationId) {
                        const fid = p.mesh.userData.formationId;
                        if (formationTracker[fid]) {
                            formationTracker[fid].collected++;
                            if (formationTracker[fid].collected >= formationTracker[fid].total) {
                                result.formationCompleted = true;
                                delete formationTracker[fid];
                            }
                        }
                    }
                    playCollect2();
                    break;
                case 'shield':
                    result.shield = SHIELD_DURATION;
                    playCollect1();
                    break;
            }
            scene.remove(p.mesh);
            pickups.splice(i, 1);
            continue;
        }

        if (p.mesh.position.z > DESPAWN_Z) {
            if (p.mesh.userData.formationId) {
                delete formationTracker[p.mesh.userData.formationId];
            }
            scene.remove(p.mesh);
            pickups.splice(i, 1);
        }
    }
    return result;
}

export function clearPickups(scene) {
    for (const p of pickups) {
        scene.remove(p.mesh);
        // Dispose cloned materials
        if (p.mesh.material) p.mesh.material.dispose();
        if (p.haze && p.haze.material) p.haze.material.dispose();
        // Dispose child PointLights
        p.mesh.children.forEach(c => {
            if (c.isPointLight && c.dispose) c.dispose();
        });
    }
    pickups.length = 0;
    clearBurstParticles(scene);
    for (let key in formationTracker) delete formationTracker[key];
}
