/**
 * tunnel.js — Hyperspace tunnel / play-area boundary effects
 */
import * as THREE from 'three';
import { BOUNDS_X, BOUNDS_Y, SPAWN_Z, DESPAWN_Z } from './config.js';

/* ── Shared geometry constants ───────────────────────────── */
const Z_NEAR  = 20;              // Camera Z
const Z_FAR   = SPAWN_Z;         // Obstacle Spawn Z
const Z_SPAN  = Z_NEAR - Z_FAR;

/* ═══════════════════════════════════════════════════════════
   Z-RAILS ONLY
   ═══════════════════════════════════════════════════════════ */
function buildTunnelEffect(scene) {
    const BX = BOUNDS_X;
    const BY = BOUNDS_Y;

    /* ── 1. Z-RAILS ───────────────────────────────────────── */
    const RAILS_H = 800; 
    const RAILS_V = 500; 
    const TOTAL_RAILS = RAILS_H * 2 + RAILS_V * 2;

    const railPos = new Float32Array(TOTAL_RAILS * 6);
    let ri = 0;
    const setRail = (x0, y0, z0, x1, y1, z1) => {
        railPos[ri++] = x0; railPos[ri++] = y0; railPos[ri++] = z0;
        railPos[ri++] = x1; railPos[ri++] = y1; railPos[ri++] = z1;
    };

    for (let i = 0; i < RAILS_H; i++) {
        const x = THREE.MathUtils.lerp(-BX, BX, i / (RAILS_H - 1));
        setRail(x,  BY, Z_FAR,  x,  BY, Z_NEAR);
        setRail(x, -BY, Z_FAR,  x, -BY, Z_NEAR);
    }
    for (let i = 0; i < RAILS_V; i++) {
        const y = THREE.MathUtils.lerp(-BY, BY, i / (RAILS_V - 1));
        setRail(-BX, y, Z_FAR, -BX, y, Z_NEAR);
        setRail( BX, y, Z_FAR,  BX, y, Z_NEAR);
    }

    const railGeo = new THREE.BufferGeometry();
    railGeo.setAttribute('position', new THREE.BufferAttribute(railPos, 3));

    const railMat = new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: new THREE.Color(0x88bbff) },
            uOpacity: { value: 0.2 },
            uZFar: { value: Z_FAR },
            uZNear: { value: Z_NEAR }
        },
        vertexShader: `
            uniform float uZFar;
            uniform float uZNear;
            varying float vAlpha;
            void main() {
                float t = (position.z - uZFar) / (uZNear - uZFar);
                vAlpha = clamp(t, 0.0, 1.0); 
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uOpacity;
            varying float vAlpha;
            void main() {
                float brightness = pow(vAlpha, 2.0);
                gl_FragColor = vec4(uColor, brightness * uOpacity);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending 
    });

    const railMesh = new THREE.LineSegments(railGeo, railMat);
    railMesh.frustumCulled = false;
    scene.add(railMesh);

    function update(dt, speed) {
        // Rails are static segments; no per-frame update needed currently.
    }

    function dispose() {
        scene.remove(railMesh);  railGeo.dispose();  railMat.dispose();
    }
    return { update, dispose };
}

/* ═══════════════════════════════════════════════════════════
   PUBLIC API
   ═══════════════════════════════════════════════════════════ */
let _tunnel = null;

export function initTunnel(scene) {
    if (_tunnel) { _tunnel.dispose(); _tunnel = null; }
    _tunnel = buildTunnelEffect(scene);
}

export function updateTunnel(dt, speed, elapsed) {
    _tunnel?.update(dt, speed, elapsed);
}

export function clearTunnel(scene) {
    if (_tunnel) {
        _tunnel.dispose();
        _tunnel = null;
    }
}
