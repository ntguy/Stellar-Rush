import * as THREE from 'three';
import {
    SPAWN_Z, DESPAWN_Z, BOUNDS_X, BOUNDS_Y, PLANE_RADIUS,
    FUEL_MAX, FUEL_PICKUP_VALUE, SHIELD_DURATION, matShield
} from './config.js';

import { playCollect1, playCollect2 } from './audio.js';
import { settings } from './settings.js';

/* ═══════════════════════════════════════════════════════════
   SHARED GEOMETRIES & MATERIALS
   ═══════════════════════════════════════════════════════════ */
const fuelGeo = new THREE.OctahedronGeometry(1.0, 0);
const fuelMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
const fuelHazeGeo = new THREE.SphereGeometry(2.8, 8, 6);
const fuelHazeMat = new THREE.MeshBasicMaterial({ color: 0xffdd44, transparent: true, opacity: 0.18, side: THREE.BackSide, depthWrite: false });

const highValueGeo = new THREE.OctahedronGeometry(1.1, 0);
const highValueMat = new THREE.MeshBasicMaterial({ color: 0x22ff66 });
const highValueHazeGeo = new THREE.SphereGeometry(3.0, 8, 6);
const highValueHazeMat = new THREE.MeshBasicMaterial({ color: 0x44ff88, transparent: true, opacity: 0.20, side: THREE.BackSide, depthWrite: false });

const shieldGeo = new THREE.TorusGeometry(0.55, 0.2, 6, 8);
const shieldMatClone = matShield.clone();
shieldMatClone.opacity = 0.7;

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

/* ═══════════════════════════════════════════════════════════
   COLLECTION BURST PARTICLES
   ═══════════════════════════════════════════════════════════ */
const burstParticles = [];
const burstGeo = new THREE.OctahedronGeometry(0.15, 0);

export function spawnCollectBurst(scene, pos, colour) {
    const count = settings.preset === 'Low' ? 5 : 10;
    for (let i = 0; i < count; i++) {
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
        p.userData.life -= dt * 4.5;
        if (p.userData.life <= 0) {
            scene.remove(p);
            p.material.dispose();
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
        p.material.dispose();
    }
    burstParticles.length = 0;
}

/* ═══════════════════════════════════════════════════════════
   PICKUP TYPES
   ═══════════════════════════════════════════════════════════ */

export function spawnFuelPickup(scene, pos) {
    const m = new THREE.Mesh(fuelGeo, fuelMat);
    m.add(new THREE.Mesh(fuelHazeGeo, fuelHazeMat));
    m.add(new THREE.PointLight(0xffcc00, 4, 22));
    if (pos) {
        m.position.set(pos.x, pos.y, pos.z);
    } else {
        m.position.set((Math.random() - 0.5) * BOUNDS_X * 0.7, (Math.random() - 0.5) * BOUNDS_Y * 0.5, SPAWN_Z);
    }
    scene.add(m);
    pickups.push({ mesh: m, type: 'fuel' });
}

export function spawnHighValuePickup(scene, pos) {
    const m = new THREE.Mesh(highValueGeo, highValueMat);
    m.add(new THREE.Mesh(highValueHazeGeo, highValueHazeMat));
    m.add(new THREE.PointLight(0x44ff88, 3, 18));
    if (pos) {
        m.position.set(pos.x, pos.y, pos.z);
    } else {
        m.position.set((Math.random() - 0.5) * BOUNDS_X * 0.8, (Math.random() - 0.5) * BOUNDS_Y * 0.6, SPAWN_Z);
    }
    scene.add(m);
    pickups.push({ mesh: m, type: 'credits_high' });
}

const _lowGeo = new THREE.OctahedronGeometry(0.55, 0);
const _lowMat = new THREE.MeshBasicMaterial({ color: 0x55ee99 });

let formationIdCounter = 0;
const formationTracker = {};

export function spawnLowValuePickup(scene, wx, wy, wz, formationId = null) {
    const m = new THREE.Mesh(_lowGeo, _lowMat);
    m.position.set(wx, wy, wz);
    if (formationId) m.userData.formationId = formationId;
    scene.add(m);
    pickups.push({ mesh: m, type: 'credits_low' });
}

export function spawnLowValueFormation(scene, slot) {
    if (!slot) return;
    const count = slot.count ?? 4;
    const dx    = slot.dx   ?? 0;
    const dy    = slot.dy   ?? 0;
    const Z_STEP = 8;
    
    const fid = ++formationIdCounter;
    formationTracker[fid] = { total: count, collected: 0 };
    
    for (let i = 0; i < count; i++) {
        spawnLowValuePickup(scene, slot.x + dx * i, slot.y + dy * i, SPAWN_Z - i * Z_STEP, fid);
    }
}

export function spawnShieldPickup(scene, pos) {
    const m = new THREE.Mesh(shieldGeo, shieldMatClone);
    if (pos) {
        m.position.set(pos.x, pos.y, pos.z);
    } else {
        m.position.set((Math.random() - 0.5) * BOUNDS_X * 0.6, (Math.random() - 0.5) * BOUNDS_Y * 0.5, SPAWN_Z);
    }
    m.add(new THREE.PointLight(0x33aaff, 1.5, 10));
    scene.add(m);
    pickups.push({ mesh: m, type: 'shield' });
}

/* ═══════════════════════════════════════════════════════════
   UPDATE
   ═══════════════════════════════════════════════════════════ */

export function updatePickups(scene, dt, speed, aircraftPos, magnetStrength = 0) {
    const result = { fuel: 0, credits: 0, creditsPos: null, shield: 0, formationCompleted: false };
    for (let i = pickups.length - 1; i >= 0; i--) {
        const p = pickups[i];
        p.mesh.position.z += speed * dt;
        p.mesh.rotation.y += dt * 3;
        p.mesh.rotation.x += dt * 1.7;

        if (magnetStrength > 0) {
            // Upgrade Logic: Magnet attracts nearby pickups
            const dist = p.mesh.position.distanceTo(aircraftPos);
            if (dist < 15) {
                const dir = aircraftPos.clone().sub(p.mesh.position).normalize();
                p.mesh.position.add(dir.multiplyScalar(magnetStrength * dt));
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
    for (const p of pickups) scene.remove(p.mesh);
    pickups.length = 0;
    clearBurstParticles(scene);
    for (let key in formationTracker) delete formationTracker[key];
}
