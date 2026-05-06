/* ═══════════════════════════════════════════════════════════
   STARS.JS  —  Stellar Rush
   ─────────────────────────────────────────────────────────
   Shared twinkling star field used by both gameplay and menu.

   moveWithCamera: when true the star mesh position is synced
   to the camera each frame (call syncToCamera(camera) in your
   update loop). Stars are placed in a sphere at radius ~300
   so they stay well within the far clip plane (500), but
   because they always re-center on the camera they show zero
   parallax — they look like a genuine skybox.
   ═══════════════════════════════════════════════════════════ */
import * as THREE from 'three';

export function buildStarField(count = 3000, spread = { x: 700, y: 350, z: 480 }, moveWithCamera = false) {
    const geo = new THREE.BufferGeometry();
    const pos   = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    const size  = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        if (moveWithCamera) {
            // Distribute on a sphere of radius 280 — safely inside far-clip of 500
            const theta = Math.random() * Math.PI * 2;
            const phi   = Math.acos(2 * Math.random() - 1);
            const r     = 430 + Math.random() * 40;
            pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
            pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            pos[i * 3 + 2] = r * Math.cos(phi);
        } else {
            pos[i * 3]     = (Math.random() - 0.5) * spread.x;
            // Increased Y spread and shifted downward to fill the bottom of the screen better
            pos[i * 3 + 1] = (Math.random() - 0.5) * (spread.y + 200) - 50;
            // Enforce minimum distance of 250 to prevent excessive parallax
            pos[i * 3 + 2] = -250 - Math.random() * (spread.z - 250);
        }
        phase[i] = Math.random() * Math.PI * 2;
        size[i]  = moveWithCamera ? (1.5 + Math.random() * 4) : (1 + Math.random() * 3);
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aPhase',   new THREE.Float32BufferAttribute(phase, 1));
    geo.setAttribute('aSize',    new THREE.Float32BufferAttribute(size,  1));

    const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: `
            attribute float aPhase;
            attribute float aSize;
            uniform float uTime;
            void main() {
                float twinkle = 0.3 + 0.9 * sin(uTime * 1.5 + aPhase);
                gl_PointSize = aSize * twinkle;
                gl_Position  = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
        fragmentShader: `
            void main() {
                float d = length(gl_PointCoord - 0.5) * 2.0;
                if (d > 1.0) discard;
                gl_FragColor = vec4(1.2, 1.2, 1.2, 1.0 - d * 0.5);
            }`,
        transparent: true,
        depthWrite: false,
    });

    const starField = new THREE.Points(geo, mat);

    // Call this once per frame when moveWithCamera=true
    function syncToCamera(camera) {
        if (moveWithCamera) {
            starField.position.copy(camera.position);
        }
    }

    return { mesh: starField, material: mat, syncToCamera };
}
