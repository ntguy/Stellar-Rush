/* ═══════════════════════════════════════════════════════════
   AIRCRAFT.JS  —  Stellar Rush
   ─────────────────────────────────────────────────────────
   Shared aircraft builder used by both gameplay and menu.
   ═══════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { matBody, matAccent, matGlow } from './config.js';

export function makeAircraft() {
    const g = new THREE.Group();

    const fuse = new THREE.Mesh(new THREE.ConeGeometry(0.45, 3.2, 4), matBody);
    fuse.rotation.x = -Math.PI / 2;
    fuse.position.z = -0.3;
    g.add(fuse);

    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.32, 4, 3), matAccent);
    cockpit.scale.set(1, 0.55, 1.3);
    cockpit.position.set(0, 0.25, -0.4);
    g.add(cockpit);

    // Wings — narrower than before so the visual roughly matches the hitbox
    for (const s of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.07, 0.7), matBody);
        wing.position.set(s * 1.0, -0.08, 0.25);
        wing.rotation.y = s * 0.15;
        wing.rotation.z = s * 0.05;
        g.add(wing);
    }

    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.9, 0.7), matAccent);
    fin.position.set(0, 0.45, 1.1);
    g.add(fin);

    for (const s of [-1, 1]) {
        const stab = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.4), matBody);
        stab.position.set(s * 0.42, 0.0, 1.1);
        stab.rotation.y = s * 0.2;
        g.add(stab);
    }

    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.28, 4, 4), matGlow);
    glow.position.z = 1.4;
    g.add(glow);
    g.userData.glow = glow;

    const eLight = new THREE.PointLight(0x00ffee, 1.2, 10);
    eLight.position.z = 1.6;
    g.add(eLight);
    g.userData.eLight = eLight;

    return g;
}
