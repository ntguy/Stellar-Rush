/* ═══════════════════════════════════════════════════════════
   WORLD2.JS  —  Stellar Rush
   ─────────────────────────────────────────────────────────
   "The Cloud Kingdom" — ocean below, clouds everywhere,
   birds instead of asteroids.

   Lifecycle:
     initWorld2(scene)      → build environment
     updateWorld2(…)        → animate per-frame
     clearWorld2(scene)     → dispose everything

   Transition visuals:
     createTransitionPlanet(scene)  → swirling blue gas giant
     updateTransitionPlanet(…)      → grow + animate
     clearTransitionPlanet(scene)   → dispose planet
   ═══════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { BOUNDS_X, BOUNDS_Y, SPAWN_Z, DESPAWN_Z } from './config.js';
import { settings } from './settings.js';

/* ═══════════════════════════════════════════════════════════
   SHARED NOISE  — hash-based 3D Perlin used in multiple
   shaders. Kept as a GLSL string so we can include it once.
   ═══════════════════════════════════════════════════════════ */
const GLSL_NOISE = `
    float hash(vec3 p){ p=fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
    float noise(vec3 p){
        vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),
                       mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                       mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
    }
    float fbm(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){v+=a*noise(p);p*=2.0;a*=0.5;} return v; }
`;

/* ═══════════════════════════════════════════════════════════
   TRANSITION PLANET  — "Blue Gas Giant"
   Spawned at screen-center tunnel-end just before world swap.
   Uses multi-layer Perlin for slowly swirling cloud bands
   and a Fresnel rim for atmospheric glow.
   ═══════════════════════════════════════════════════════════ */
let _tPlanet = null;  // { mesh, mat, age }

export function createTransitionPlanet(scene) {
    clearTransitionPlanet(scene);

    const radius = 25;
    const geo = new THREE.SphereGeometry(radius, 64, 48);
    const mat = new THREE.ShaderMaterial({
        uniforms: {
            uTime:  { value: 0 },
            uScale: { value: 0.01 },  // grows from tiny → full
        },
        vertexShader: `
            varying vec3 vNormal, vPos, vViewDir;
            void main(){
                vNormal  = normalize(normalMatrix * normal);
                vPos     = position;
                vec4 mv  = modelViewMatrix * vec4(position, 1.0);
                vViewDir = normalize(-mv.xyz);
                gl_Position = projectionMatrix * mv;
            }`,
        fragmentShader: `
            uniform float uTime, uScale;
            varying vec3 vNormal, vPos, vViewDir;
            ${GLSL_NOISE}
            void main(){
                vec3 n = normalize(vNormal);
                // Swirling cloud bands — latitude-aligned turbulence
                vec3 samplePos = vPos * 0.12 + vec3(0.0, uTime * 0.04, uTime * 0.02);
                float turb  = fbm(samplePos);
                float turb2 = fbm(samplePos * 2.3 + 7.7);

                // Base deep-ocean blue → cloud white
                vec3 deepBlue  = vec3(0.06, 0.18, 0.55);
                vec3 midBlue   = vec3(0.20, 0.45, 0.85);
                vec3 cloudWhite= vec3(0.85, 0.90, 1.00);

                vec3 col = mix(deepBlue, midBlue, smoothstep(0.3, 0.6, turb));
                col      = mix(col, cloudWhite, smoothstep(0.5, 0.75, turb2) * 0.7);

                // Fresnel atmospheric rim
                float fresnel = pow(1.0 - abs(dot(n, normalize(vViewDir))), 3.0);
                vec3 rimColor = vec3(0.4, 0.7, 1.0);
                col = mix(col, rimColor, fresnel * 0.8);

                // Slight emissive so it glows against black space
                col += vec3(0.02, 0.05, 0.12);

                gl_FragColor = vec4(col, 1.0);
            }`,
        transparent: false,
        depthWrite: true,
    });

    const mesh = new THREE.Mesh(geo, mat);
    // Position at the end of the tunnel, dead center
    mesh.position.set(0, 0, SPAWN_Z);
    mesh.scale.setScalar(0.01);
    scene.add(mesh);

    // Atmospheric glow shell
    const glowMat = new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: new THREE.Color(0.3, 0.6, 1.0) },
            uTime:  { value: 0 },
        },
        vertexShader: `
            varying vec3 vNormal, vViewDir;
            void main(){
                vNormal = normalize(normalMatrix * normal);
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                vViewDir = normalize(-mv.xyz);
                gl_Position = projectionMatrix * mv;
            }`,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uTime;
            varying vec3 vNormal, vViewDir;
            void main(){
                float f = 1.0 - abs(dot(vNormal, vViewDir));
                f = pow(f, 3.0);
                float pulse = 0.85 + 0.15 * sin(uTime * 1.2);
                gl_FragColor = vec4(uColor * 2.0 * pulse, f * 0.7);
            }`,
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.FrontSide,
        depthWrite: false,
    });
    const glowMesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 1.15, 48, 36),
        glowMat
    );
    mesh.add(glowMesh);  // child of main planet so it inherits transforms

    _tPlanet = { mesh, mat, glowMat, age: 0 };
}

/**
 * Animate the transition planet.
 * @param {number} dt
 * @returns {number} current age in seconds
 */
export function updateTransitionPlanet(dt) {
    if (!_tPlanet) return 0;
    _tPlanet.age += dt;

    const t = _tPlanet.age;
    _tPlanet.mat.uniforms.uTime.value = t;
    _tPlanet.glowMat.uniforms.uTime.value = t;

    // Grow in over 4 seconds — exponential ease-out
    const growT = Math.min(t / 4.0, 1.0);
    const scale = growT * growT * (3 - 2 * growT);  // smoothstep
    _tPlanet.mesh.scale.setScalar(scale);

    // Slow rotation
    _tPlanet.mesh.rotation.y += dt * 0.06;

    return t;
}

export function clearTransitionPlanet(scene) {
    if (_tPlanet) {
        scene.remove(_tPlanet.mesh);
        _tPlanet.mesh.geometry.dispose();
        _tPlanet.mat.dispose();
        _tPlanet.glowMat.dispose();
        // Glow mesh is a child, will be removed with parent
        const glowChild = _tPlanet.mesh.children[0];
        if (glowChild) { glowChild.geometry.dispose(); }
        _tPlanet = null;
    }
}


/* ═══════════════════════════════════════════════════════════
   FOG OVERLAY  — full-screen white-out during world swap.
   A large sphere around the camera with animated opacity.
   ═══════════════════════════════════════════════════════════ */
let _fogOverlay = null;

export function createFogOverlay(scene, camera) {
    if (_fogOverlay) clearFogOverlay(scene);

    const geo = new THREE.SphereGeometry(2, 16, 12);
    const mat = new THREE.MeshBasicMaterial({
        color: 0xddeeff,
        transparent: true,
        opacity: 0,
        side: THREE.BackSide,
        depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    camera.add(mesh);
    if (!camera.parent) scene.add(camera);

    _fogOverlay = { mesh, mat };
}

export function setFogOverlayOpacity(opacity) {
    if (_fogOverlay) _fogOverlay.mat.opacity = Math.max(0, Math.min(1, opacity));
}

export function clearFogOverlay(scene) {
    if (_fogOverlay) {
        if (_fogOverlay.mesh.parent) _fogOverlay.mesh.parent.remove(_fogOverlay.mesh);
        _fogOverlay.mesh.geometry.dispose();
        _fogOverlay.mat.dispose();
        _fogOverlay = null;
    }
}


/* ═══════════════════════════════════════════════════════════
   WORLD 2 ENVIRONMENT  — Ocean + Clouds + Birds
   ═══════════════════════════════════════════════════════════ */
const _tracked = [];  // all Three.js objects to dispose

/* ── Ocean ─────────────────────────────────────────────── */
let _oceanMesh = null;

function _buildOcean(scene) {
    const size = 1500;
    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    const mat = new THREE.ShaderMaterial({
        uniforms: {
            uTime:    { value: 0 },
            uSunDir:  { value: new THREE.Vector3(0.3, 0.8, -0.5).normalize() },
        },
        vertexShader: `
            varying vec2 vUv;
            varying vec3 vWorldPos;
            void main(){
                vUv = uv;
                vec4 wp = modelMatrix * vec4(position, 1.0);
                vWorldPos = wp.xyz;
                gl_Position = projectionMatrix * viewMatrix * wp;
            }`,
        fragmentShader: `
            uniform float uTime;
            uniform vec3 uSunDir;
            varying vec2 vUv;
            varying vec3 vWorldPos;
            ${GLSL_NOISE}
            void main(){
                vec2 uv = vUv * 40.0;
                float n1 = noise(vec3(uv + uTime * 0.04, uTime * 0.02));
                float n2 = noise(vec3(uv * 2.3 + uTime * 0.02, uTime * 0.04 + 5.0));
                float wave = n1 * 0.6 + n2 * 0.4;

                // Deep blue → surface teal
                vec3 deep    = vec3(0.01, 0.04, 0.12);
                vec3 surface = vec3(0.06, 0.25, 0.35);
                vec3 col = mix(deep, surface, wave);

                // Sun glint — fake specular
                vec3 viewDir = normalize(cameraPosition - vWorldPos);
                vec3 normal  = normalize(vec3(
                    (noise(vec3(uv + 0.01, uTime * 0.02)) - wave) * 20.0,
                    1.0,
                    (noise(vec3(uv.yx + 0.01, uTime * 0.02)) - wave) * 20.0
                ));
                vec3 refl = reflect(-uSunDir, normal);
                float spec = pow(max(dot(refl, viewDir), 0.0), 128.0);
                col += vec3(1.0, 0.95, 0.8) * spec * 0.6;

                // Distance fade
                float dist = length(vWorldPos.xz - cameraPosition.xz);
                float fogT = smoothstep(400.0, 1200.0, dist);
                vec3 fogCol = vec3(0.55, 0.72, 0.88);
                col = mix(col, fogCol, fogT);

                gl_FragColor = vec4(col, 1.0);
            }`,
        side: THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -90;
    scene.add(mesh);
    _tracked.push(mesh);
    _oceanMesh = mesh;
}


/* ── Cloud Layers ──────────────────────────────────────── */
const _cloudLayers = [];

function _buildClouds(scene) {
    const isLow = settings.preset === 'Low';
    const layerCount = isLow ? 2 : 3;

    const configs = [
        { y:  35, scale: 12, speed: 0.08, alpha: 0.45, color: new THREE.Color(0.90, 0.93, 0.98) },
        { y:  20, scale: 8,  speed: 0.12, alpha: 0.35, color: new THREE.Color(0.80, 0.85, 0.95) },
        { y:  55, scale: 18, speed: 0.05, alpha: 0.25, color: new THREE.Color(0.95, 0.96, 1.00) },
    ];

    for (let i = 0; i < layerCount; i++) {
        const cfg = configs[i];
        const geo = new THREE.PlaneGeometry(800, 800, 1, 1);
        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uTime:  { value: 0 },
                uScale: { value: cfg.scale },
                uSpeed: { value: cfg.speed },
                uAlpha: { value: cfg.alpha },
                uColor: { value: cfg.color },
            },
            vertexShader: `
                varying vec2 vUv;
                varying vec3 vWorldPos;
                void main(){
                    vUv = uv;
                    vec4 wp = modelMatrix * vec4(position, 1.0);
                    vWorldPos = wp.xyz;
                    gl_Position = projectionMatrix * viewMatrix * wp;
                }`,
            fragmentShader: `
                uniform float uTime, uScale, uSpeed, uAlpha;
                uniform vec3 uColor;
                varying vec2 vUv;
                varying vec3 vWorldPos;
                ${GLSL_NOISE}
                void main(){
                    vec2 uv = vUv * uScale;
                    float n = fbm(vec3(uv + uTime * uSpeed, uTime * 0.05));
                    float alpha = smoothstep(0.38, 0.62, n) * uAlpha;

                    // Distance fade
                    float dist = length(vWorldPos.xz - cameraPosition.xz);
                    alpha *= 1.0 - smoothstep(150.0, 400.0, dist);

                    gl_FragColor = vec4(uColor, alpha);
                }`,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = cfg.y;
        scene.add(mesh);
        _tracked.push(mesh);
        _cloudLayers.push({ mesh, mat, cfg });
    }
}


/* ── Birds ─────────────────────────────────────────────── */
const _birds = [];
const MAX_BIRDS = 18;
let _birdSpawnTimer = 0;
const BIRD_SPAWN_INTERVAL = 4;  // seconds between flock spawns

// Simple low-poly bird geometry (two triangle wings + body)
let _birdGeo = null;
const _birdMat = new THREE.MeshPhongMaterial({
    color: 0x000000,
    flatShading: true,
    side: THREE.DoubleSide,
});

function _getBirdGeo() {
    if (_birdGeo) return _birdGeo;
    // Create a simple bird shape: two triangular wings
    const shape = new THREE.BufferGeometry();
    const verts = new Float32Array([
        // Left wing
        0, 0, 0.3,     -1.2, 0, -0.2,    0, 0, -0.3,
        // Right wing
        0, 0, 0.3,      0, 0, -0.3,       1.2, 0, -0.2,
        // Body (small triangle)
        -0.1, 0.05, 0.4,  0.1, 0.05, 0.4,  0, -0.05, -0.3,
    ]);
    shape.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    shape.computeVertexNormals();
    _birdGeo = shape;
    return _birdGeo;
}

function _spawnBirdFlock(scene) {
    if (_birds.length >= MAX_BIRDS) return;

    // V-formation or loose cluster
    const isV = Math.random() < 0.6;
    const count = 3 + Math.floor(Math.random() * 4); // 3-6 birds
    
    // Spawn left or right of the play area
    const isRight = Math.random() > 0.5;
    const centerX = isRight ? (BOUNDS_X - 5 + Math.random() * 15) : (-BOUNDS_X + 5 - Math.random() * 15);
    const centerY = -5 + Math.random() * 15;  // Roughly at play area height, but far to the side

    const baseSpeed = 0.4 + Math.random() * 0.2;  // relative to obstacle speed

    for (let i = 0; i < count && _birds.length < MAX_BIRDS; i++) {
        const mesh = new THREE.Mesh(_getBirdGeo(), _birdMat.clone());
        mesh.material.color.setHex(0x000000);
        const scale = 0.8 + Math.random() * 0.5;
        mesh.scale.setScalar(scale);

        let offX, offZ;
        if (isV) {
            // V formation
            const side = i % 2 === 0 ? 1 : -1;
            const row = Math.ceil(i / 2);
            offX = side * row * 3;
            offZ = -row * 5;
        } else {
            // Loose cluster
            offX = (Math.random() - 0.5) * 12;
            offZ = (Math.random() - 0.5) * 10;
        }

        mesh.position.set(
            centerX + offX,
            centerY + (Math.random() - 0.5) * 2,
            SPAWN_Z + offZ
        );
        mesh.rotation.y = Math.PI; // Face +Z (direction of travel)

        scene.add(mesh);
        _birds.push({
            mesh,
            speedMult: baseSpeed + (Math.random() - 0.5) * 0.08,
            flapPhase: Math.random() * Math.PI * 2,
            flapSpeed: 4 + Math.random() * 2,
        });
    }
}

function _updateBirds(dt, speed) {
    _birdSpawnTimer += dt;
    if (_birdSpawnTimer >= BIRD_SPAWN_INTERVAL) {
        _birdSpawnTimer -= BIRD_SPAWN_INTERVAL;
        _spawnBirdFlock(_scene);
    }

    for (let i = _birds.length - 1; i >= 0; i--) {
        const b = _birds[i];
        // Birds move at a fraction of obstacle speed (player overtakes them)
        b.mesh.position.z += speed * b.speedMult * dt;

        // Flapping: oscillate Y position and tilt wings
        b.flapPhase += b.flapSpeed * dt;
        b.mesh.position.y += Math.sin(b.flapPhase) * 0.3 * dt;
        b.mesh.rotation.z = Math.sin(b.flapPhase) * 0.3;

        // Remove if past camera
        if (b.mesh.position.z > DESPAWN_Z + 30) {
            _scene.remove(b.mesh);
            b.mesh.material.dispose();
            _birds.splice(i, 1);
        }
    }
}

function _clearBirds(scene) {
    for (const b of _birds) {
        scene.remove(b.mesh);
        b.mesh.material.dispose();
    }
    _birds.length = 0;
    _birdSpawnTimer = 0;
}

/* ── Islands ───────────────────────────────────────────── */
const _islands = [];
const _islandGeoBase = new THREE.DodecahedronGeometry(1, 1);
const _islandMat = new THREE.MeshPhongMaterial({ color: 0xd2b48c, flatShading: true, transparent: true, opacity: 0 }); // Sandy beige

function _spawnIsland() {
    if (_islands.length > 10) return;
    const mesh = new THREE.Mesh(_islandGeoBase, _islandMat.clone());
    
    // Tiny varied islands
    const sx = 5 + Math.random() * 20;
    const sz = 5 + Math.random() * 20;
    const sy = 1 + Math.random() * 5;
    mesh.scale.set(sx, sy, sz);
    
    // Spawn left or right far away
    const isRight = Math.random() > 0.5;
    const posX = isRight ? 30 + Math.random() * 120 : -30 - Math.random() * 120;
    
    mesh.position.set(posX, -90 + sy * 0.4, SPAWN_Z - 500);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    
    _scene.add(mesh);
    _islands.push({ mesh, fadeAge: 0 });
}

function _updateIslands(dt, speed) {
    if (Math.random() < 0.002) _spawnIsland();
    for (let i = _islands.length - 1; i >= 0; i--) {
        const island = _islands[i];
        island.fadeAge += dt;
        island.mesh.material.opacity = Math.min(1, island.fadeAge / 4.0);
        island.mesh.position.z += (speed / 4.0) * dt; // move in same direction as plane (slower relative pass)
        if (island.mesh.position.z > DESPAWN_Z + 100) {
            _scene.remove(island.mesh);
            island.mesh.material.dispose();
            _islands.splice(i, 1);
        }
    }
}

function _clearIslands(scene) {
    for (const island of _islands) {
        scene.remove(island.mesh);
        island.mesh.material.dispose();
    }
    _islands.length = 0;
}

/* ── Physical Clouds ───────────────────────────────────── */
const _physicalClouds = [];
const _physicalCloudMat = new THREE.MeshPhongMaterial({ 
    color: 0xffffff, 
    flatShading: true, 
    transparent: true, 
    opacity: 0 
});

function _spawnPhysicalCloud() {
    if (_physicalClouds.length > 6) return;
    
    const cloudGroup = new THREE.Group();
    const numPuffs = 5 + Math.floor(Math.random() * 6);
    const mats = [];
    
    for (let i = 0; i < numPuffs; i++) {
        // Less rock-like, more spherical overlapping shapes
        const puffGeo = new THREE.SphereGeometry(15 + Math.random() * 20, 7, 7);
        const mat = _physicalCloudMat.clone();
        mats.push(mat);
        const puff = new THREE.Mesh(puffGeo, mat);
        puff.position.set(
            (Math.random() - 0.5) * 40, 
            (Math.random() - 0.5) * 15, 
            (Math.random() - 0.5) * 30
        );
        // Randomize rotation so they look distinct
        puff.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
        
        // Scale non-uniformly for flatter bottoms or stretched cloud shapes
        puff.scale.set(1 + Math.random(), 0.6 + Math.random() * 0.5, 1 + Math.random());
        cloudGroup.add(puff);
    }
    
    let posX, posY;
    if (Math.random() < 0.4) {
        // Above the play area
        posX = (Math.random() - 0.5) * 80;
        posY = BOUNDS_Y + 50 + Math.random() * 30; // High enough to clear
    } else {
        // Sides of the play area
        const isRight = Math.random() > 0.5;
        posX = isRight ? (BOUNDS_X + 60 + Math.random() * 60) : (-BOUNDS_X - 60 - Math.random() * 60);
        posY = 10 + Math.random() * 60;
    }
    
    // Spawn much further away
    cloudGroup.position.set(posX, posY, SPAWN_Z - 400);
    
    _scene.add(cloudGroup);
    _physicalClouds.push({ group: cloudGroup, mats, fadeAge: 0 });
}

function _updatePhysicalClouds(dt, speed) {
    if (Math.random() < 0.008) _spawnPhysicalCloud(); // Spawn less frequently
    for (let i = _physicalClouds.length - 1; i >= 0; i--) {
        const cloud = _physicalClouds[i];
        cloud.fadeAge += dt;
        const alpha = Math.min(0.85, (cloud.fadeAge / 2.0) * 0.85);
        for(let m of cloud.mats) m.opacity = alpha;

        // Move slightly slower than ground to give parallax
        cloud.group.position.z += speed * 0.85 * dt; 
        if (cloud.group.position.z > DESPAWN_Z + 100) {
            _scene.remove(cloud.group);
            cloud.group.children.forEach(c => {
                c.geometry.dispose();
                c.material.dispose();
            });
            _physicalClouds.splice(i, 1);
        }
    }
}

function _clearPhysicalClouds(scene) {
    for (const cloud of _physicalClouds) {
        scene.remove(cloud.group);
        cloud.group.children.forEach(c => {
            c.geometry.dispose();
            c.material.dispose();
        });
    }
    _physicalClouds.length = 0;
}

/* ── World 2 Lighting ──────────────────────────────────── */
let _w2Lights = [];

function _buildLighting(scene) {
    // Bright daylight
    const ambient = new THREE.AmbientLight(0x88aacc, 1.5);
    scene.add(ambient);
    _tracked.push(ambient);
    _w2Lights.push(ambient);

    // Warm sun — directional
    const sun = new THREE.DirectionalLight(0xffeedd, 2.0);
    sun.position.set(50, 80, -100);
    scene.add(sun);
    _tracked.push(sun);
    _w2Lights.push(sun);

    // Cool fill from below (ocean bounce)
    const fill = new THREE.DirectionalLight(0x6688bb, 0.5);
    fill.position.set(0, -30, 0);
    scene.add(fill);
    _tracked.push(fill);
    _w2Lights.push(fill);
}


/* ═══════════════════════════════════════════════════════════
   PUBLIC API
   ═══════════════════════════════════════════════════════════ */
let _scene = null;
let _active = false;

export function initWorld2(scene, camera) {
    _scene = scene;
    _active = true;

    // Adjust camera for world 2
    if (camera) {
        camera.far = 800;
        camera.updateProjectionMatrix();
    }

    // Atmospheric background
    scene.background = new THREE.Color(0x5588bb);
    scene.fog = new THREE.FogExp2(0x7799bb, 0.0025);

    _buildOcean(scene);
    _buildClouds(scene);
    _buildLighting(scene);
    // Seed a first flock immediately
    _spawnBirdFlock(scene);
}

export function updateWorld2(dt, speed, elapsed) {
    if (!_active) return;

    // Ocean
    if (_oceanMesh) {
        _oceanMesh.material.uniforms.uTime.value = elapsed;
    }

    // Clouds
    for (const layer of _cloudLayers) {
        layer.mat.uniforms.uTime.value = elapsed;
    }

    // Birds
    _updateBirds(dt, speed);
    
    // Islands & Physical Clouds
    _updateIslands(dt, speed);
    _updatePhysicalClouds(dt, speed);
}

export function clearWorld2(scene, camera) {
    _active = false;

    // Reset camera
    if (camera) {
        camera.far = 500;
        camera.updateProjectionMatrix();
    }

    _clearBirds(scene);
    _clearIslands(scene);
    _clearPhysicalClouds(scene);
    _cloudLayers.length = 0;
    _oceanMesh = null;
    _w2Lights = [];

    for (const obj of _tracked) {
        scene.remove(obj);
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
            if (obj.material.dispose) obj.material.dispose();
        }
    }
    _tracked.length = 0;
    _scene = null;
}

export function isWorld2Active() { return _active; }
