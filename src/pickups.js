import * as THREE from 'three';
import {
    SPAWN_Z, DESPAWN_Z, BOUNDS_X, BOUNDS_Y, PLANE_RADIUS,
    FUEL_MAX, FUEL_PICKUP_VALUE, SHIELD_DURATION, matShield
} from './config.js';

import { playCollect1, playCollect2 } from './audio.js';

/* ═══════════════════════════════════════════════════════════
   SHARED STATE
   ═══════════════════════════════════════════════════════════ */
export const pickups = [];

// Collection radius — wider than PLANE_RADIUS so pickups feel generous to grab
function getCollectRadius(aircraftPos) {
    const dx = Math.abs(aircraftPos.x) / (BOUNDS_X * 0.5);
    const dy = Math.abs(aircraftPos.y) / (BOUNDS_Y * 0.5);
    const edgeProximity = Math.max(dx, dy);
    const base = PLANE_RADIUS * 2.2;
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
        p.userData.life -= dt * 4.5;
        if (p.userData.life <= 0) {
            scene.remove(p);
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
    for (const p of burstParticles) scene.remove(p);
    burstParticles.length = 0;
}

/* ═══════════════════════════════════════════════════════════
   PICKUP TYPES
   ═══════════════════════════════════════════════════════════ */

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
        m.position.set((Math.random() - 0.5) * BOUNDS_X * 0.7, (Math.random() - 0.5) * BOUNDS_Y * 0.5, SPAWN_Z);
    }
    scene.add(m);
    pickups.push({ mesh: m, type: 'fuel' });
}

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
        m.position.set((Math.random() - 0.5) * BOUNDS_X * 0.8, (Math.random() - 0.5) * BOUNDS_Y * 0.6, SPAWN_Z);
    }
    scene.add(m);
    pickups.push({ mesh: m, type: 'points_high' });
}

const _lowGeo = new THREE.OctahedronGeometry(0.55, 0);
const _lowMat = new THREE.MeshBasicMaterial({ color: 0x55ee99 });

function _spawnLowPickupAt(scene, wx, wy, wz) {
    const m = new THREE.Mesh(_lowGeo, _lowMat);
    m.position.set(wx, wy, wz);
    scene.add(m);
    pickups.push({ mesh: m, type: 'points_low' });
}

export function spawnLowValueFormation(scene, slot) {
    if (!slot) return;
    const count = slot.count ?? 4;
    const dx    = slot.dx   ?? 0;
    const dy    = slot.dy   ?? 0;
    const Z_STEP = 8;
    for (let i = 0; i < count; i++) {
        _spawnLowPickupAt(scene, slot.x + dx * i, slot.y + dy * i, SPAWN_Z - i * Z_STEP);
    }
}

export function spawnShieldPickup(scene, pos) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.2, 6, 8), matShield.clone());
    m.material.opacity = 0.7;
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

export function updatePickups(scene, dt, speed, aircraftPos) {
    const result = { fuel: 0, points: 0, pointsPos: null, shield: 0 };
    for (let i = pickups.length - 1; i >= 0; i--) {
        const p = pickups[i];
        p.mesh.position.z += speed * dt;
        p.mesh.rotation.y += dt * 3;
        p.mesh.rotation.x += dt * 1.7;

        if (aircraftPos.distanceTo(p.mesh.position) < getCollectRadius(aircraftPos)) {
            switch (p.type) {
                case 'fuel':
                    result.fuel = FUEL_PICKUP_VALUE;
                    playCollect1();
                    break;

                case 'points_high':
                    result.points += 200;
                    result.pointsPos = p.mesh.position.clone();
                    playCollect1();
                    break;
                case 'points_low':
                    result.points += 40;
                    result.pointsPos = p.mesh.position.clone();
                    playCollect2();
                    break;
                case 'shield':
                    result.shield = SHIELD_DURATION;
                    playCollect1();
                    break;
            }
            scene.remove(p.mesh);
            if (p.type !== 'points_low') {
                p.mesh.geometry.dispose();
                p.mesh.material.dispose();
            }
            pickups.splice(i, 1);
            continue;
        }

        if (p.mesh.position.z > DESPAWN_Z) {
            scene.remove(p.mesh);
            if (p.type !== 'points_low') {
                p.mesh.geometry.dispose();
                p.mesh.material.dispose();
            }
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
