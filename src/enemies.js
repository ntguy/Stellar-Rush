import * as THREE from 'three';
import {
    SPAWN_Z, DESPAWN_Z, BOUNDS_X, BOUNDS_Y, PLANE_RADIUS,
    ENEMY_MOVER_SPEED, ENEMY_LASER_RANGE, ENEMY_LASER_WARN, ENEMY_LASER_DURATION,
    matEnemy, matEnemyGlow, matLaser
} from './config.js';
import { playLaserFire, playLaserWarning } from './audio.js';


/* ═══════════════════════════════════════════════════════════
   SHARED GEOMETRIES & MATERIALS
   ═══════════════════════════════════════════════════════════ */
const moverBodyGeo = new THREE.SphereGeometry(3.8, 7, 6);
const moverBoosterGeo = new THREE.ConeGeometry(2.0, 1.5, 5);

const turretBodyGeo = new THREE.SphereGeometry(1, 6, 5);
const turretStripeGeo = new THREE.CylinderGeometry(1.02, 1.02, 0.45, 16);
const turretStripeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
const turretEyeGeo = new THREE.SphereGeometry(0.35, 5, 4);
const turretBarrelGeo = new THREE.CylinderGeometry(0.18, 0.18, 1.2, 6);
const turretBarrelMat = new THREE.MeshPhongMaterial({ color: 0xffffff, flatShading: true });

const warnGeo = new THREE.RingGeometry(0.8, 1.2, 16);
const beamGeo = new THREE.CylinderGeometry(0.35, 0.35, 1, 6);
const beamMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.85 });

/* ═══════════════════════════════════════════════════════════
   SHARED STATE  — owned by main.js, mutated here
   ═══════════════════════════════════════════════════════════ */
export const enemies = [];

/* ═══════════════════════════════════════════════════════════
   MOVER ENEMY
   A sphere with a cone "booster" tail, flying in a pattern.
   moveType: 'horizontal' | 'vertical' | 'diagonal' | 'circle'
   ═══════════════════════════════════════════════════════════ */

export function spawnMover(scene, moveType = 'horizontal', zOffset = 0) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(moverBodyGeo, matEnemy);
    g.add(body);
    // Booster cone
    const booster = new THREE.Mesh(moverBoosterGeo, matEnemyGlow);
    g.add(booster);



    // Starting position
    const startX = (Math.random() - 0.5) * BOUNDS_X * 1.2;
    const startY = (Math.random() - 0.5) * BOUNDS_Y * 0.8;
    g.position.set(startX, startY, SPAWN_Z + zOffset);

    // Movement config — use consistent speed (no random variation)
    const spd = ENEMY_MOVER_SPEED;
    let vel, circleCenter, circleAngle;

    switch (moveType) {
        case 'vertical':
            vel = new THREE.Vector3(0, (Math.random() < 0.5 ? 1 : -1) * spd, 0);
            booster.rotation.x = vel.y > 0 ? Math.PI : 0;
            booster.position.y = vel.y > 0 ? -0.9 : 0.9;
            break;
        case 'diagonal': {
            const dx = (Math.random() < 0.5 ? 1 : -1);
            const dy = (Math.random() < 0.5 ? 1 : -1);
            vel = new THREE.Vector3(dx, dy, 0).normalize().multiplyScalar(spd);
            booster.rotation.z = Math.atan2(-vel.y, -vel.x) + Math.PI / 2;
            booster.position.set(-vel.x * 0.12, -vel.y * 0.12, 0);
            break;
        }
        case 'circle':
            circleCenter = new THREE.Vector2(startX, startY);
            circleAngle = 0;
            vel = new THREE.Vector3(); // updated in tick
            booster.position.z = 0.9;
            booster.rotation.x = -Math.PI / 2;
            break;
        default: // horizontal
            vel = new THREE.Vector3((Math.random() < 0.5 ? 1 : -1) * spd, 0, 0);
            booster.rotation.z = vel.x > 0 ? -Math.PI / 2 : Math.PI / 2;
            booster.position.x = vel.x > 0 ? -0.9 : 0.9;
            break;
    }

    scene.add(g);
    enemies.push({
        type: 'mover', group: g, vel, moveType, spd,
        circleCenter, circleAngle,
        radius: 3.2,
    });
}



/* ═══════════════════════════════════════════════════════════
   LASER TURRET ENEMY
   Sphere that sits in place. When player is within range it
   locks on, flashes a warning reticle, then fires a beam.
   ═══════════════════════════════════════════════════════════ */

export function spawnLaserTurret(scene, zOffset = 0) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(turretBodyGeo, matEnemy);
    g.add(body);
    
    // Black stripe through the center — visible from the front (horizontal)
    const stripe = new THREE.Mesh(turretStripeGeo, turretStripeMat);
    stripe.rotation.z = Math.PI / 2; // horizontal band across the Y axis
    g.add(stripe);



    // "Eye" — glowing red sphere
    const eye = new THREE.Mesh(turretEyeGeo, matEnemyGlow);
    eye.position.z = -0.7;
    g.add(eye);

    // Turret barrel — bright white cylinder so it's visible against the dark scene
    const barrel = new THREE.Mesh(turretBarrelGeo, turretBarrelMat);
    barrel.rotation.x = Math.PI / 2; // point forward (-Z)
    barrel.position.z = -1.2;
    g.add(barrel);

    g.position.set(
        (Math.random() - 0.5) * BOUNDS_X * 0.8,
        (Math.random() - 0.5) * BOUNDS_Y * 0.6,
        SPAWN_Z + zOffset
    );

    scene.add(g);
    enemies.push({
        type: 'laser', group: g,
        radius: 0.9,
        state: 'idle',       // idle → warning → firing → cooldown
        timer: 0,
        lockPos: null,       // {x,y} in world space where the reticle targets
        warningMesh: null,
        laserMesh: null,
        flashCount: 0,
    });
}

/* ═══════════════════════════════════════════════════════════
   UPDATE  (called from main loop)
   Returns true if player was killed by an enemy this frame.
   ═══════════════════════════════════════════════════════════ */

export function updateEnemies(scene, dt, speed, aircraftPos, shielded, camera) {
    const CIRCLE_RADIUS = 10;
    const CIRCLE_SPEED  = 2.5;

    let killed = false;

    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        const g = e.group;

        // Advance forward (toward camera) at world obstacle speed
        g.position.z += speed * dt;

        // Remove if past camera
        if (g.position.z > DESPAWN_Z + 10) {
            cleanupEnemy(scene, e);
            enemies.splice(i, 1);
            continue;
        }

        /* ── Mover ──────────────────────────────────────── */
        if (e.type === 'mover') {
            let currentVel;
            if (e.moveType === 'circle') {
                e.circleAngle += CIRCLE_SPEED * dt;
                g.position.x = e.circleCenter.x + Math.cos(e.circleAngle) * CIRCLE_RADIUS;
                g.position.y = e.circleCenter.y + Math.sin(e.circleAngle) * CIRCLE_RADIUS;
                // Approximate velocity from angular motion for exhaust direction
                currentVel = new THREE.Vector3(
                    -Math.sin(e.circleAngle) * CIRCLE_SPEED * CIRCLE_RADIUS,
                     Math.cos(e.circleAngle) * CIRCLE_SPEED * CIRCLE_RADIUS, 0);
            } else {
                g.position.x += e.vel.x * dt;
                g.position.y += e.vel.y * dt;
                if (Math.abs(g.position.x) > BOUNDS_X * 1.3) e.vel.x *= -1;
                if (Math.abs(g.position.y) > BOUNDS_Y * 1.1) e.vel.y *= -1;
                currentVel = e.vel;
            }

            // Collision with player
            if (!shielded && g.position.distanceTo(aircraftPos) < e.radius + PLANE_RADIUS) {
                killed = true;
            }
        }

        /* ── Laser turret ───────────────────────────────── */
        if (e.type === 'laser') {
            const distZ = Math.abs(g.position.z - aircraftPos.z);

            if (e.state === 'idle' && distZ < ENEMY_LASER_RANGE) {
                e.state = 'warning';
                e.timer = 0;
                e.flashCount = 0;
                // Lock on current player XY
                e.lockPos = { x: aircraftPos.x, y: aircraftPos.y };
                // Create warning reticle
                const warnMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0, side: THREE.DoubleSide });
                e.warningMesh = new THREE.Mesh(warnGeo, warnMat);
                e.warningMesh.position.set(e.lockPos.x, e.lockPos.y, aircraftPos.z);
                scene.add(e.warningMesh);
                // Trigger warning sound — speedMultiplier 1.0 matches 1s ENEMY_LASER_WARN
                playLaserWarning(1.0);
            }


            if (e.state === 'warning') {
                e.timer += dt;
                // Flash the reticle 3 times
                const flashPeriod = ENEMY_LASER_WARN / 3;
                const phase = (e.timer % flashPeriod) / flashPeriod;
                if (e.warningMesh) {
                    e.warningMesh.material.opacity = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
                    e.warningMesh.rotation.z += dt * 3;
                }
                if (e.timer >= ENEMY_LASER_WARN) {
                    e.state = 'firing';
                    e.timer = 0;
                    if (e.warningMesh) { 
                        scene.remove(e.warningMesh); 
                        e.warningMesh.material.dispose();
                        e.warningMesh = null; 
                    }
                    // Build beam as a thick cylinder between turret and lock position
                    e.laserMesh = new THREE.Mesh(beamGeo, beamMat);
                    scene.add(e.laserMesh);
                    // TODO: SOUND
                    playLaserFire();
                }
            }

            if (e.state === 'firing') {
                e.timer += dt;
                // Position the cylinder beam between turret and lock target
                if (e.laserMesh) {
                    const start = g.position;
                    const end = new THREE.Vector3(e.lockPos.x, e.lockPos.y, 0);
                    const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
                    e.laserMesh.position.copy(mid);
                    const beamLen = start.distanceTo(end);
                    e.laserMesh.scale.set(1, beamLen, 1);
                    e.laserMesh.lookAt(end);
                    e.laserMesh.rotateX(Math.PI / 2);
                }
                // Check if player is in the laser column
                if (!shielded) {
                    const dx = aircraftPos.x - e.lockPos.x;
                    const dy = aircraftPos.y - e.lockPos.y;
                    if (Math.sqrt(dx * dx + dy * dy) < 1.5) {
                        killed = true;
                    }
                }
                if (e.timer >= ENEMY_LASER_DURATION) {
                    e.state = 'cooldown';
                    e.timer = 0;
                    if (e.laserMesh) { scene.remove(e.laserMesh); e.laserMesh = null; }
                }
            }

            if (e.state === 'cooldown') {
                e.timer += dt;
                if (e.timer > 3) e.state = 'idle'; // can fire again
            }

            // Turret body collision
            if (!shielded && g.position.distanceTo(aircraftPos) < e.radius + PLANE_RADIUS) {
                killed = true;
            }
        }
    }

    return killed;
}

function cleanupEnemy(scene, e) {
    scene.remove(e.group);
    if (e.warningMesh) {
        scene.remove(e.warningMesh);
        e.warningMesh.material.dispose();
    }
    if (e.laserMesh)   scene.remove(e.laserMesh);
}

export function clearEnemies(scene) {
    for (const e of enemies) cleanupEnemy(scene, e);
    enemies.length = 0;
}
