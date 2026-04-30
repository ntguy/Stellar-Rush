/* ═══════════════════════════════════════════════════════════
   AIRCRAFT.JS  —  Stellar Rush
   ─────────────────────────────────────────────────────────
   Shared aircraft builder used by both gameplay and menu.
   ═══════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { matBody, matAccent, matGlow } from './config.js';

export function makeAircraft() {
    const g = new THREE.Group();

    const coolBody = new THREE.MeshPhysicalMaterial({
        color: 0xbbddff, // very light blue
        metalness: 0,
        roughness: 0.05,
        clearcoat: 1.0,
        clearcoatRoughness: 0.02,
        emissive: 0x112233
    });
    
    const coolAccent = new THREE.MeshPhysicalMaterial({
        color: 0x00ffcc, // Cyan
        metalness: 0.1,
        roughness: 0.1,
        clearcoat: 1.0,
        clearcoatRoughness: 0.2,
        emissive: 0x003322
    });

    // Main fuselage (sharp hexagonal cylinder)
    const fuseGeo = new THREE.CylinderGeometry(0.12, 0.42, 2.4, 6);
    const fuse = new THREE.Mesh(fuseGeo, coolBody);
    fuse.rotation.x = -Math.PI / 2;
    fuse.position.z = 0.1;
    g.add(fuse);

    // Sharp nose cone
    const noseGeo = new THREE.ConeGeometry(0.12, 0.6, 6);
    const nose = new THREE.Mesh(noseGeo, coolBody);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -1.4;
    g.add(nose);

    // Engine nozzle (hexagonal, tapers inward)
    const nozzleGeo = new THREE.CylinderGeometry(0.42, 0.32, 0.15, 6);
    const nozzle = new THREE.Mesh(nozzleGeo, coolAccent);
    nozzle.rotation.x = -Math.PI / 2;
    nozzle.position.z = 1.375;
    g.add(nozzle);

    // Cockpit (sharp stealth canopy)
    const cockpitGeo = new THREE.CylinderGeometry(0, 0.22, 1.2, 4);
    const cockpit = new THREE.Mesh(cockpitGeo, coolAccent);
    cockpit.rotation.x = -Math.PI / 2 - 0.15; // pitched down slightly
    cockpit.position.set(0, 0.16, -0.4); // lowered into fuselage
    g.add(cockpit);

    // Swept-back Wings (sharper)
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, -0.5);      // root leading edge
    wingShape.lineTo(2.0, 0.1);     // tip leading edge
    wingShape.lineTo(1.8, 0.4);     // tip trailing edge
    wingShape.lineTo(0, 0.5);       // root trailing edge

    const extrudeSettings = { depth: 0.04, bevelEnabled: false };
    const wingGeo = new THREE.ExtrudeGeometry(wingShape, extrudeSettings);
    
    const rightWing = new THREE.Mesh(wingGeo, coolBody);
    rightWing.rotation.x = Math.PI / 2;
    rightWing.position.set(0.15, -0.02, 0);
    g.add(rightWing);

    const leftWingShape = new THREE.Shape();
    leftWingShape.moveTo(0, -0.5);
    leftWingShape.lineTo(-2.0, 0.1);
    leftWingShape.lineTo(-1.8, 0.4);
    leftWingShape.lineTo(0, 0.5);

    const leftWingGeo = new THREE.ExtrudeGeometry(leftWingShape, extrudeSettings);
    const leftWing = new THREE.Mesh(leftWingGeo, coolBody);
    leftWing.rotation.x = Math.PI / 2;
    leftWing.position.set(-0.15, -0.02, 0);
    g.add(leftWing);

    // Vertical fin (sharp triangle)
    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0);
    finShape.lineTo(0.6, 0);
    finShape.lineTo(0.5, 0.8);
    
    const finGeo = new THREE.ExtrudeGeometry(finShape, extrudeSettings);
    finGeo.center();
    const fin = new THREE.Mesh(finGeo, coolAccent);
    fin.rotation.y = Math.PI / 2;
    fin.position.set(0, 0.5, 1.1);
    g.add(fin);

    // Horizontal stabilizers (sharper)
    const stabShape = new THREE.Shape();
    stabShape.moveTo(0, -0.2);
    stabShape.lineTo(0.9, 0.1);
    stabShape.lineTo(0.8, 0.3);
    stabShape.lineTo(0, 0.4);

    const stabGeo = new THREE.ExtrudeGeometry(stabShape, extrudeSettings);
    const rightStab = new THREE.Mesh(stabGeo, coolBody);
    rightStab.rotation.x = Math.PI / 2;
    rightStab.position.set(0.15, 0, 0.9);
    g.add(rightStab);

    const leftStabShape = new THREE.Shape();
    leftStabShape.moveTo(0, -0.2);
    leftStabShape.lineTo(-0.9, 0.1);
    leftStabShape.lineTo(-0.8, 0.3);
    leftStabShape.lineTo(0, 0.4);

    const leftStabGeo = new THREE.ExtrudeGeometry(leftStabShape, extrudeSettings);
    const leftStab = new THREE.Mesh(leftStabGeo, coolBody);
    leftStab.rotation.x = Math.PI / 2;
    leftStab.position.set(-0.15, 0, 0.9);
    g.add(leftStab);

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
