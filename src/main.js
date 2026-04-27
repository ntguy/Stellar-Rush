import * as THREE from 'three';

import {
    BOUNDS_X, BOUNDS_Y, SPAWN_Z, DESPAWN_Z, PLANE_RADIUS,
    FUEL_MAX, FUEL_PICKUP_BASE, FORMATION_BASE, POINTS_PICKUP_BASE, SHIELD_PICKUP_BASE,
    OBS_BASE_SPEED, OBS_SPEED_RAMP, OBS_TARGET_OPACITY, OBS_FADE_TIME,
    BOOST_SPEED_MULT, BOOST_SCORE_MULT, SHIELD_DURATION,
    matBody, matAccent, matGlow, matAsteroid, matLine,
} from './config.js';

import { nextObstacle, resetSequencer } from './patterns.js';
import { spawnMover, spawnLaserTurret, updateEnemies, clearEnemies } from './enemies.js';
import { spawnFuelPickup, spawnHighValuePickup, spawnShieldPickup, spawnLowValueFormation, updatePickups, clearPickups, spawnCollectBurst, updateBurstParticles, clearBurstParticles } from './pickups.js';
import {
    playLaserFire, playCrash, playFuelCollect, playPointsCollect, playShieldCollect,
    startShieldHum, startBoostHum, startFuelLowBeep,
    initAudio, resumeAudioContext, stopAllAudio, startBaseEngine,
    setLowFuelVolume, stopFuelLowBeep, playOutOfFuel,
    startMenuMusic, stopMenuMusic
} from './audio.js';
import { initTunnel, updateTunnel, clearTunnel } from './tunnel.js';
import { makeAircraft } from './aircraft.js';
import { buildStarField } from './stars.js';
import { createMenu } from './menu.js';
import Stats from 'stats';
import { settings, saveSettings } from './settings.js';

// ─── Menu animation config ───
import { getMenuConfig } from './menu-variation-1.js';

/* ═══════════════════════════════════════════════════════════
   DEVELOPMENT_MODE  —  set true to skip menu and boot into game
   ═══════════════════════════════════════════════════════════ */
const DEVELOPMENT_MODE = true;

/* ═══════════════════════════════════════════════════════════
   GAME STATE  —  'MENU' | 'PLAYING'
   ═══════════════════════════════════════════════════════════ */
let gameState = 'MENU';
let paused = false;
let menuController = null;

// Initialize audio loading
initAudio();

// Resume audio context on first interaction
window.addEventListener('mousedown', resumeAudioContext, { once: true });
window.addEventListener('keydown', resumeAudioContext, { once: true });

/* ═══════════════════════════════════════════════════════════
   RENDERER  /  SCENE  /  CAMERA
   ═══════════════════════════════════════════════════════════ */
// Init defaults
if (!localStorage.getItem('stellarRushSettings')) {
    settings.fpsEnabled = DEVELOPMENT_MODE;
    saveSettings();
}

const stats = new Stats();
stats.showPanel(0);
stats.dom.style.display = settings.fpsEnabled ? 'block' : 'none';
stats.dom.style.position = 'absolute';
stats.dom.style.right = '0px';
stats.dom.style.left = '';
stats.dom.style.top = '';
stats.dom.style.bottom = '0px';
document.body.appendChild(stats.dom);

const isLow = settings.preset === 'Low';
const isMedium = settings.preset === 'Medium';

const renderer = new THREE.WebGLRenderer({ antialias: !isLow });
const pr = isLow ? 1.0 : (isMedium ? 1.5 : Math.min(devicePixelRatio, 2));
renderer.setPixelRatio(pr);
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000005);
scene.fog = new THREE.FogExp2(0x000005, 0.0015);

const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.1, 500);
camera.position.set(0, 10, 20);

/* ═══════════════════════════════════════════════════════════
   LIGHTS
   ═══════════════════════════════════════════════════════════ */
scene.add(new THREE.AmbientLight(0x335588, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(4, 12, 8);
scene.add(sun);
const rim = new THREE.DirectionalLight(0x4488ff, 0.6);
rim.position.set(-3, -4, -6);
scene.add(rim);

/* ═══════════════════════════════════════════════════════════
   AIRCRAFT
   ═══════════════════════════════════════════════════════════ */
// Aircraft is now imported from aircraft.js (shared with menu)
const aircraft = makeAircraft();
scene.add(aircraft);

/* ═══════════════════════════════════════════════════════════
   EXHAUST PARTICLES
   Pre-allocated pool of meshes — no GC pressure each frame.
   ═══════════════════════════════════════════════════════════ */
const EXHAUST_POOL = 60;

// Shared geometry. Materials are pre-allocated in a pool so we never
// call `new THREE.MeshBasicMaterial` inside the hot game loop.
const exhaustGeo = new THREE.PlaneGeometry(0.18, 0.18);
const exhaustMatPool = Array.from({ length: EXHAUST_POOL }, () =>
    new THREE.MeshBasicMaterial({
        color: 0x00fff7, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide,
    })
);
const exhaustMeshPool = exhaustMatPool.map(mat => new THREE.Mesh(exhaustGeo, mat));
// Track which meshes are currently active vs available
const exhaustActive = new Set();
const exhaustFree   = [...exhaustMeshPool];

function emitExhaust(boosting) {
    if (exhaustFree.length === 0) return;           // pool exhausted
    const m = exhaustFree.pop();
    const mat = m.material;
    // Colour follows the engine glow (tracks fuel level)
    mat.color.copy(matGlow.color);
    mat.opacity = 0.80;

    const nozzle = new THREE.Vector3(0, 0, 1.4).applyQuaternion(aircraft.quaternion).add(aircraft.position);
    m.position.copy(nozzle);
    m.scale.setScalar(1);
    const spd = 5 + Math.random() * 4;
    const spread = boosting ? 2.4 : 1.2;
    m.userData.vel = new THREE.Vector3(
        (Math.random() - 0.5) * spread,
        (Math.random() - 0.5) * spread,
        spd,
    );
    m.userData.life = 1.0;
    scene.add(m);
    exhaustActive.add(m);
}

function updateExhaust(dt) {
    for (const p of [...exhaustActive]) {
        p.userData.life -= dt * 3.5;
        if (p.userData.life <= 0) {
            scene.remove(p);
            exhaustActive.delete(p);
            exhaustFree.push(p);
            continue;
        }
        p.position.addScaledVector(p.userData.vel, dt);
        p.material.opacity = p.userData.life * 0.85;
        p.scale.setScalar(p.userData.life * 0.9);
        p.lookAt(camera.position);
    }
}

function clearExhaust() {
    for (const p of exhaustActive) {
        scene.remove(p);
        exhaustFree.push(p);
    }
    exhaustActive.clear();
}

/* ═══════════════════════════════════════════════════════════
   CURSOR GUIDE LINE
   ═══════════════════════════════════════════════════════════ */
const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const guideLine = new THREE.Line(lineGeo, matLine);
scene.add(guideLine);

/* ═══════════════════════════════════════════════════════════
   STAR FIELD  (twinkling shader)
   ═══════════════════════════════════════════════════════════ */
// Star field is now imported from stars.js (shared with menu)
const STAR_COUNT = isLow ? 900 : (isMedium ? 1500 : 3000);
(function initStars() {
    const { mesh, material } = buildStarField(STAR_COUNT);
    scene.add(mesh);
    scene.userData.starField = mesh;
    scene.userData.starField.material = material;
})();

/* ═══════════════════════════════════════════════════════════
   ASTEROIDS  (decoration only — off to the sides)
   ═══════════════════════════════════════════════════════════ */
const asteroids = [];
const asteroidGeo = new THREE.IcosahedronGeometry(1, 0);

function spawnAsteroid(zOverride) {
    const mat = matAsteroid.clone();
    mat.transparent = true;
    mat.opacity = 0;
    const m = new THREE.Mesh(asteroidGeo, mat);
    const r = 0.7 + Math.random() * 4.5;
    m.scale.set(r * (0.6 + Math.random() * 0.8), r * (0.6 + Math.random() * 0.8), r * (0.6 + Math.random() * 0.8));
    const side = Math.random() < 0.5 ? -1 : 1;
    // Pushed asteroids on average 20 units further away from the play area
    m.position.x = side * (BOUNDS_X + 26 + Math.random() * 55);
    m.position.y = (Math.random() - 0.5) * 50;
    m.position.z = zOverride !== undefined ? zOverride : SPAWN_Z;
    m.rotation.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, 0);
    scene.add(m);
    asteroids.push({
        mesh: m,
        radius: r * 0.85,
        fadeAge: 0,
        rotVel: new THREE.Vector3(
            (Math.random() - 0.5) * 0.7,
            (Math.random() - 0.5) * 0.7,
            (Math.random() - 0.5) * 0.3
        ),
    });
}

/* ═══════════════════════════════════════════════════════════
   AMBIENT PLANET  (large decorative sphere drifting by)
   ═══════════════════════════════════════════════════════════ */
let planetMesh = null;
let planetSpawnTimer = -30;  // first planet at t=30s, then every 60s
const PLANET_INTERVAL = 60;  // seconds between planets

function spawnPlanet() {
    if (planetMesh) {
        scene.remove(planetMesh);
        planetMesh.geometry.dispose();
        planetMesh.material.dispose();
        planetMesh = null;
    }
    const r = 30 + Math.random() * 45;
    
    // Curated planet colors — pick one at random
    const planetColors = [
        0xff6b5b,  // coral red
        0xff9944,  // orange
        0xffdd55,  // warm yellow
        0x44cc88,  // teal green
        0x5599ff,  // sky blue
        0x9966ff,  // purple
        0xff4488,  // pink
        0x88ccff,  // light blue
    ];
    const baseColor = planetColors[Math.floor(Math.random() * planetColors.length)];
    // Add some saturation/lightness variation on top of the base color
    const col = new THREE.Color(baseColor);
    
    const mat = new THREE.MeshPhongMaterial({ color: col, flatShading: true, transparent: true, opacity: 0 });
    planetMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 2), mat);
    const side = Math.random() < 0.5 ? -1 : 1;
    // Start at the same depth as obstacles so it's immediately in the visible scene.
    // Far off to the side so it clears the play area completely.
    planetMesh.position.set(
        side * (BOUNDS_X + 80 + Math.random() * 40),
        (Math.random() - 0.5) * 35,
        SPAWN_Z
    );
    planetMesh.userData.fadeAge = 0;
    // Very slow lateral drift for a parallax feel
    planetMesh.userData.driftVel = new THREE.Vector3(
        side * -(0.3 + Math.random() * 0.4),
        (Math.random() - 0.5) * 0.3,
        0
    );
    scene.add(planetMesh);
}

function updatePlanet(dt, speed) {
    if (!planetMesh) return;
    // Move forward at only ~8 % of obstacle speed → ~60 s fly-past window
    planetMesh.position.z += speed * 0.08 * dt;
    planetMesh.position.addScaledVector(planetMesh.userData.driftVel, dt);
    planetMesh.rotation.y += dt * 0.04;
    planetMesh.rotation.x += dt * 0.015;
    // Fade in over 10 seconds
    planetMesh.userData.fadeAge = Math.min(planetMesh.userData.fadeAge + dt, 10);
    planetMesh.material.opacity = (planetMesh.userData.fadeAge / 10) * 0.70;
    if (planetMesh.position.z > DESPAWN_Z + 100) {
        scene.remove(planetMesh);
        planetMesh.geometry.dispose();
        planetMesh.material.dispose();
        planetMesh = null;
    }
}

/* ═══════════════════════════════════════════════════════════
   POINTS TEXT DISPLAY — pops out and fizzles
   ═══════════════════════════════════════════════════════════ */

const pointsTextMeshes = [];

function spawnPointsText(scene, pos, points) {
    // Create canvas texture with point value
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    
    // Clear and draw text
    ctx.fillStyle = '#ffff88';
    ctx.font = 'bold 60px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`+${points}`, 128, 64);
    
    // Create texture and sprite
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.copy(pos);
    sprite.scale.set(8, 4, 1);  // scale to be readable
    
    sprite.userData.life = 1.0;
    sprite.userData.velocity = new THREE.Vector3(0, 2, 0);  // drift upward
    scene.add(sprite);
    pointsTextMeshes.push(sprite);
}

function updatePointsText(scene, dt) {
    for (let i = pointsTextMeshes.length - 1; i >= 0; i--) {
        const s = pointsTextMeshes[i];
        s.userData.life -= dt * 2.2;  // fade over ~0.45s
        if (s.userData.life <= 0) {
            scene.remove(s);
            s.material.map.dispose();
            s.material.dispose();
            pointsTextMeshes.splice(i, 1);
            continue;
        }
        s.position.addScaledVector(s.userData.velocity, dt);
        s.material.opacity = s.userData.life;
        s.scale.multiplyScalar(0.98);  // slightly shrink as they fade
    }
}

function clearPointsText(scene) {
    for (const s of pointsTextMeshes) {
        scene.remove(s);
        s.material.map.dispose();
        s.material.dispose();
    }
    pointsTextMeshes.length = 0;
}

/* ═══════════════════════════════════════════════════════════
   STATE
   ═══════════════════════════════════════════════════════════ */
let fuel, score, elapsed, gameOver, boosting;
let fuelOut = false, fuelOutTimer = 0;

let spawnTimer, asteroidTimer, fuelPUTimer, formationTimer, pointsTimer, shieldPUTimer, enemyTimer;
let shieldTimer;
// How many times enemies have been spawned — drives multi-enemy probability ramp
let enemySpawnCount;
let exploding = false, explodeTimer = 0;
const explosionParts = [];
const obstacles = [];

/* ── Pickup slot pool ──────────────────────────────────────
   nextObstacle() returns slot arrays; we accumulate them here
   and consume one per pickup-spawn event.                    */
const pendingPickups = [];
const mouseNDC = new THREE.Vector2(0, 0);
const target   = new THREE.Vector3();
const vel      = new THREE.Vector3();
const tmpV     = new THREE.Vector3();
const tmpBox   = new THREE.Box3();
const pSphere  = new THREE.Sphere(new THREE.Vector3(), PLANE_RADIUS);

/* ── Shield visual ────────────────────────────────────────── */
let shieldMesh = null;  // IcosahedronGeometry bubble around plane
let shieldMat  = null;  // direct ref so we can animate opacity

function createShieldMesh() {
    shieldMat = new THREE.MeshBasicMaterial({
        color: 0x33aaff,
        transparent: true,
        opacity: 0.10,   // subtle glow — was 0.30
        side: THREE.DoubleSide,
        depthWrite: false,
    });
    return new THREE.Mesh(new THREE.IcosahedronGeometry(2.2, 1), shieldMat);
}

/* ── Looping sound stop-function handles ──────────────────── */
let stopBoostHum    = null;
let stopShieldHum   = null;

// Previous-frame flags for detecting transitions
let prevBoosting = false;
let prevFuelLow  = false;

/* ═══════════════════════════════════════════════════════════
   INPUT
   ═══════════════════════════════════════════════════════════ */
window.addEventListener('mousemove', e => {
    mouseNDC.x =  (e.clientX / innerWidth)  * 2 - 1;
    mouseNDC.y = -(e.clientY / innerHeight) * 2 + 1;
});
window.addEventListener('mousedown', e => { if (e.button === 0 && gameState === 'PLAYING') boosting = true; });
window.addEventListener('mouseup',   e => { if (e.button === 0) boosting = false; });
window.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
});

/* ── Pause / Escape handling ──────────────────────────────── */
window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && gameState === 'PLAYING') {
        togglePause();
    }
});

/* ═══════════════════════════════════════════════════════════
   HUD ELEMENTS
   ═══════════════════════════════════════════════════════════ */
const elScore   = document.getElementById('score');
const elFuel    = document.getElementById('fuel-bar');
const elBoost   = document.getElementById('boost-indicator');
const elShield  = document.getElementById('shield-indicator');
const elOverlay = document.getElementById('game-over');
const elFinal   = document.getElementById('final-score');
const elHud     = document.getElementById('hud');
const elMenuBtn = document.getElementById('menu-btn');
const elPause   = document.getElementById('pause-menu');
const elResume  = document.getElementById('pause-resume-btn');
const elSettingPreset = document.getElementById('setting-preset');
const elSettingFps = document.getElementById('setting-fps');
const elSettingFov = document.getElementById('setting-fov');

// Init UI from settings
if (elSettingPreset) elSettingPreset.value = settings.preset;
if (elSettingFps) elSettingFps.checked = settings.fpsEnabled;
if (elSettingFov) elSettingFov.value = settings.fov;

if (elSettingPreset) {
    elSettingPreset.addEventListener('change', (e) => {
        settings.preset = e.target.value;
        saveSettings();
        location.reload();
    });
}
if (elSettingFps) {
    elSettingFps.addEventListener('change', (e) => {
        settings.fpsEnabled = e.target.checked;
        stats.dom.style.display = settings.fpsEnabled ? 'block' : 'none';
        saveSettings();
    });
}
if (elSettingFov) {
    elSettingFov.addEventListener('change', (e) => {
        settings.fov = parseInt(e.target.value);
        saveSettings();
        camera.fov = settings.fov;
        camera.updateProjectionMatrix();
    });
}

document.getElementById('restart-btn').addEventListener('click', restart);
document.getElementById('pause-back-btn').addEventListener('click', backToMainMenu);
elResume.addEventListener('click', togglePause);
elMenuBtn.addEventListener('click', () => { if (gameState === 'PLAYING') togglePause(); });

/* ═══════════════════════════════════════════════════════════
   CLOCK  /  RAYCASTER
   ═══════════════════════════════════════════════════════════ */
const clock     = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const zPlane    = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

/* ═══════════════════════════════════════════════════════════
   INIT  /  RESTART
   ═══════════════════════════════════════════════════════════ */
function init() {
    fuel = FUEL_MAX; score = 0; elapsed = 0;
    gameOver = false; boosting = false;
    fuelOut = false; fuelOutTimer = 0;
    paused = false;

    spawnTimer = 0; asteroidTimer = 0;
    // Initialise pickup timers as objects with value and threshold
    const _jitter0 = base => base * (0.8 + Math.random() * 0.4);
    fuelPUTimer    = { value: 0, _threshold: _jitter0(FUEL_PICKUP_BASE) };
    formationTimer = { value: 0, _threshold: _jitter0(FORMATION_BASE) };
    pointsTimer    = { value: 0, _threshold: _jitter0(POINTS_PICKUP_BASE) };
    shieldPUTimer  = { value: 0, _threshold: _jitter0(SHIELD_PICKUP_BASE) };
    enemyTimer = 0;
    shieldTimer = 0;
    enemySpawnCount = 0;
    prevBoosting = false;
    prevFuelLow  = false;
    // Stop any active looping sounds
    stopBoostHum?.();    stopBoostHum    = null;
    stopShieldHum?.();   stopShieldHum   = null;
    stopFuelLowBeep();
    stopMenuMusic();

    aircraft.position.set(0, 0, 0);
    aircraft.rotation.set(0, 0, 0);
    aircraft.scale.setScalar(1);
    vel.set(0, 0, 0);
    matGlow.color.set(0x00fff7);

    clearExhaust();
    // Remove shield mesh if still alive from previous run
    if (shieldMesh) { scene.remove(shieldMesh); shieldMesh = null; shieldMat = null; }

    // Clean up world
    for (const o of obstacles) o.parts.forEach(m => scene.remove(m));
    obstacles.length = 0;
    for (const a of asteroids) {
        scene.remove(a.mesh);
        a.mesh.material.dispose();
    }
    asteroids.length = 0;
    clearPickups(scene);
    clearEnemies(scene);
    clearPointsText(scene);
    for (const p of explosionParts) {
        scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
    }
    explosionParts.length = 0;
    exploding = false; explodeTimer = 0;
    aircraft.visible = true;

    // Make sure aircraft is in the scene (menu may have removed it)
    if (!aircraft.parent) scene.add(aircraft);
    // Make sure star field is in the scene
    if (scene.userData.starField && !scene.userData.starField.parent) {
        scene.add(scene.userData.starField);
    }

    resetSequencer();
    pendingPickups.length = 0;
    initTunnel(scene);
    if (planetMesh) {
        scene.remove(planetMesh);
        planetMesh.geometry.dispose();
        planetMesh.material.dispose();
        planetMesh = null;
    }
    planetSpawnTimer = -30;  // first planet at t=30s, then every 60s

    startBaseEngine();

    // Seed initial asteroids
    for (let i = 0; i < 30; i++) {
        spawnAsteroid(SPAWN_Z + Math.random() * (DESPAWN_Z - SPAWN_Z));
    }

    scene.userData.starField.material.uniforms.uTime.value = 0;
    elOverlay.classList.remove('show');
    elPause.classList.remove('show');

    // Show gameplay UI
    elHud.classList.remove('hidden');
    elMenuBtn.classList.add('visible');

    // Reset camera
    camera.position.set(0, 10, 20);

    gameState = 'PLAYING';
    clock.getDelta();
}

function restart() { init(); }

/* ═══════════════════════════════════════════════════════════
   PAUSE / MENU TRANSITIONS
   ═══════════════════════════════════════════════════════════ */
function togglePause() {
    if (gameOver) return;
    paused = !paused;
    if (paused) {
        elPause.classList.add('show');
        document.body.style.cursor = 'default';
        
        // Stop looping sounds so they don't get stuck while paused
        stopBoostHum?.();
        stopBoostHum = null;
        stopShieldHum?.();
        stopShieldHum = null;
        stopFuelLowBeep();
    } else {
        elPause.classList.remove('show');
        document.body.style.cursor = 'crosshair';
        clock.getDelta(); // eat accumulated dt
    }
}

function backToMainMenu() {
    paused = false;
    elPause.classList.remove('show');
    elOverlay.classList.remove('show');
    stopAllAudio();
    document.body.style.cursor = 'default';
    enterMenu();
}

function enterMenu() {
    gameState = 'MENU';
    elHud.classList.add('hidden');
    elMenuBtn.classList.remove('visible');

    // Clean up gameplay objects from scene
    for (const o of obstacles) o.parts.forEach(m => scene.remove(m));
    obstacles.length = 0;
    for (const a of asteroids) {
        scene.remove(a.mesh);
        a.mesh.material.dispose();
    }
    asteroids.length = 0;
    clearPickups(scene);
    clearEnemies(scene);
    clearPointsText(scene);
    clearExhaust();
    for (const p of explosionParts) {
        scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
    }
    explosionParts.length = 0;
    if (shieldMesh) { scene.remove(shieldMesh); shieldMesh = null; shieldMat = null; }
    if (planetMesh) {
        scene.remove(planetMesh);
        planetMesh.geometry.dispose();
        planetMesh.material.dispose();
        planetMesh = null;
    }
    aircraft.visible = false;
    if (scene.userData.starField) scene.remove(scene.userData.starField);
    clearTunnel(scene);
    // Remove gameplay lights (menu adds its own)
    scene.children
        .filter(c => c.isLight || c === guideLine)
        .forEach(c => scene.remove(c));

    // Create menu
    if (menuController) menuController.dispose();
    menuController = createMenu(scene, camera, getMenuConfig());
    menuController.onReady(startMenuMusic);
    menuController.onPlay(() => {
        menuController.dispose();
        menuController = null;
        // Re-add gameplay lights
        scene.add(new THREE.AmbientLight(0x224466, 1.0));
        const s = new THREE.DirectionalLight(0xffffff, 1.5);
        s.position.set(4, 12, 8);
        scene.add(s);
        const r = new THREE.DirectionalLight(0x4488ff, 0.6);
        r.position.set(-3, -4, -6);
        scene.add(r);
        scene.add(guideLine);
        document.body.style.cursor = 'crosshair';
        init();
    });
    clock.getDelta();
}

/* ── Startup ──────────────────────────────────────────────── */
if (DEVELOPMENT_MODE) {
    init();
} else {
    enterMenu();
}

/* ═══════════════════════════════════════════════════════════
   END GAME
   ═══════════════════════════════════════════════════════════ */
function endGame() {
    gameOver = true;
    elFinal.textContent = Math.floor(score);
    elOverlay.classList.add('show');
    stopAllAudio();
}


/* ═══════════════════════════════════════════════════════════
   EXPLOSION
   ═══════════════════════════════════════════════════════════ */
function spawnExplosion(pos) {
    exploding = true; explodeTimer = 0;
    aircraft.visible = false;
    clearExhaust();
    playCrash();
    const cols = [0xff6600, 0xff3300, 0xffaa00, 0xffffff, 0xff8800];
    const maxParts = settings.preset === 'Low' ? 12 : 24;
    for (let i = 0; i < maxParts; i++) {
        const r = 0.1 + Math.random() * 0.45;
        const mat = new THREE.MeshBasicMaterial({ color: cols[i % cols.length], transparent: true, opacity: 1 });
        const m = new THREE.Mesh(new THREE.TetrahedronGeometry(r, 0), mat);
        m.position.copy(pos);
        const spd = 2 + Math.random() * 12;
        const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, (Math.random() - 0.5) * 0.4).normalize();
        scene.add(m);
        explosionParts.push({ mesh: m, vel: dir.multiplyScalar(spd), life: 1.0 });
    }
    const flash = new THREE.PointLight(0xff6600, 12, 30);
    flash.position.copy(pos);
    scene.add(flash);
    setTimeout(() => scene.remove(flash), 300);
}

/* ═══════════════════════════════════════════════════════════
   ENEMY SPAWN HELPER
   Picks a random enemy type and spawns it at SPAWN_Z + zOffset
   so multiple enemies in a wave are staggered in depth.
   ═══════════════════════════════════════════════════════════ */
function _doSpawnEnemy(zOffset = 0) {
    if (Math.random() < 0.6) {
        const types = ['horizontal', 'vertical', 'diagonal', 'circle'];
        spawnMover(scene, types[Math.floor(Math.random() * types.length)], zOffset);
    } else {
        spawnLaserTurret(scene, zOffset);
    }
}

/* ═══════════════════════════════════════════════════════════
   MAIN LOOP
   ═══════════════════════════════════════════════════════════ */
function loop() {
    requestAnimationFrame(loop);
    stats.begin();
    const dt = Math.min(clock.getDelta(), 0.05);

    /* ── MENU state ───────────────────────────────────── */
    if (gameState === 'MENU') {
        if (menuController) menuController.update(dt);
        renderer.render(scene, camera);
        stats.end();
        return;
    }

    /* ── PAUSED ───────────────────────────────────────── */
    if (paused) { renderer.render(scene, camera); stats.end(); return; }

    if (gameOver) { renderer.render(scene, camera); stats.end(); return; }

    /* ── Explosion sequence ──────────────────────────── */
    if (exploding) {
        explodeTimer += dt;
        for (let i = explosionParts.length - 1; i >= 0; i--) {
            const p = explosionParts[i];
            p.life -= dt * 0.6;
            p.vel.y -= dt * 6;
            p.mesh.position.addScaledVector(p.vel, dt);
            p.mesh.rotation.x += dt * 7;
            p.mesh.rotation.z += dt * 5;
            p.mesh.material.opacity = Math.max(0, p.life);
            p.mesh.scale.setScalar(Math.max(0.01, p.life));
            if (p.life <= 0) {
                scene.remove(p.mesh);
                p.mesh.geometry.dispose();
                p.mesh.material.dispose();
                explosionParts.splice(i, 1);
            }
        }
        if (explodeTimer > 1.8) { exploding = false; endGame(); }
        renderer.render(scene, camera);
        return;
    }

    elapsed += dt;
    const shielded = shieldTimer > 0;
    if (shielded) shieldTimer -= dt;

    const baseSpeed = OBS_BASE_SPEED + elapsed * OBS_SPEED_RAMP;
    let speed = boosting ? baseSpeed * BOOST_SPEED_MULT : baseSpeed;
    
    // Out of fuel slowdown
    if (fuelOut) {
        fuelOutTimer += dt;
        const slowdown = Math.max(0, 1 - fuelOutTimer / 5.0);
        speed *= slowdown;
        boosting = false; // can't boost without fuel
        if (fuelOutTimer >= 5.0) { endGame(); return; }
    }

    const scoreMult = boosting ? BOOST_SCORE_MULT : 1;
    score += dt * (10 + elapsed * 0.5) * scoreMult;

    /* ── Fuel ─────────────────────────────────────────── */
    if (!fuelOut) {
        fuel -= dt * (boosting ? 2 : 1);
        if (fuel <= 0) { 
            fuel = 0; 
            fuelOut = true; 
            fuelOutTimer = 0; 
            playOutOfFuel();
            stopFuelLowBeep();
        }
    }


    /* ── Mouse → world target ─────────────────────────── */
    raycaster.setFromCamera(mouseNDC, camera);
    raycaster.ray.intersectPlane(zPlane, target);
    target.x = THREE.MathUtils.clamp(target.x, -BOUNDS_X, BOUNDS_X);
    target.y = THREE.MathUtils.clamp(target.y, -BOUNDS_Y, BOUNDS_Y);
    target.z = 0;

    /* ── Plane steering ───────────────────────────────── */
    const maxSpd = boosting ? 60 : 20;
    const accel  = boosting ? 120 : 40;

    tmpV.subVectors(target, aircraft.position);
    const dist = tmpV.length();

    if (dist > 0.05) {
        const desiredSpd = Math.min(dist * 4, maxSpd);
        tmpV.normalize().multiplyScalar(desiredSpd).sub(vel);
        if (tmpV.length() > accel * dt) tmpV.setLength(accel * dt);
        vel.add(tmpV);
    } else {
        vel.multiplyScalar(1 - 5 * dt);
    }

    aircraft.position.addScaledVector(vel, dt);
    aircraft.position.x = THREE.MathUtils.clamp(aircraft.position.x, -BOUNDS_X, BOUNDS_X);
    aircraft.position.y = THREE.MathUtils.clamp(aircraft.position.y, -BOUNDS_Y, BOUNDS_Y);
    aircraft.position.z = 0;

    /* ── Tilt ─────────────────────────────────────────── */
    aircraft.rotation.z = THREE.MathUtils.lerp(aircraft.rotation.z, -vel.x * 0.045, 6 * dt);
    aircraft.rotation.x = THREE.MathUtils.lerp(aircraft.rotation.x,  vel.y * 0.025, 6 * dt);

    /* ── Engine glow + fuel colour ────────────────────── */
    const pulse = boosting
        ? 1.6 + Math.sin(elapsed * 22) * 0.35
        : 0.9 + Math.sin(elapsed * 8) * 0.12;
    aircraft.userData.glow.scale.set(pulse, pulse, boosting ? pulse * 2 : pulse);
    aircraft.userData.eLight.intensity = boosting ? 3 : 1.2;
    const ft = 1 - fuel / FUEL_MAX;
    matGlow.color.setRGB(
        THREE.MathUtils.lerp(0,    1,    ft),
        THREE.MathUtils.lerp(1,    0.27, ft),
        THREE.MathUtils.lerp(0.97, 0.27, ft)
    );
    aircraft.userData.eLight.color.copy(matGlow.color);

    /* ── Guide line ───────────────────────────────────── */
    const lp = guideLine.geometry.attributes.position.array;
    lp[0] = aircraft.position.x; lp[1] = aircraft.position.y; lp[2] = aircraft.position.z;
    lp[3] = target.x;            lp[4] = target.y;            lp[5] = target.z;
    guideLine.geometry.attributes.position.needsUpdate = true;
    matLine.opacity = THREE.MathUtils.clamp(dist * 0.06, 0, 0.4);

    /* ── Camera follow ────────────────────────────────── */
    camera.position.x += (aircraft.position.x * 0.35 - camera.position.x) * 3 * dt;
    camera.position.y += ((aircraft.position.y * 0.25 + 4.5) - camera.position.y) * 3 * dt;
    camera.lookAt(aircraft.position.x * 0.2, aircraft.position.y * 0.2, -35);

    /* ── Spawn obstacles ──────────────────────────────── */
    // Difficulty comes primarily from wallSize growing (wider obstacles = more traversal).
    // Spawn frequency ramps slowly so the game stays readable.
    const interval = Math.max(0.7, 1.6 - elapsed * 0.004);
    spawnTimer += dt;
    if (spawnTimer > interval) {
        spawnTimer -= interval;
        const slots = nextObstacle(scene, obstacles, elapsed);
        
        // Process pending pickups using the slots generated for this exact obstacle
        // Priority: fuel > shield > points > formation
        const priority = { 'fuel': 0, 'shield': 1, 'points': 2, 'formation': 3 };
        pendingPickups.sort((a, b) => priority[a] - priority[b]);

        for (let i = 0; i < pendingPickups.length; i++) {
            const type = pendingPickups[i];
            const reqSlotType = (type === 'formation') ? 'formation' : 'single';
            
            const slotIdx = slots.findIndex(s => s.type === reqSlotType);
            if (slotIdx !== -1) {
                const slot = slots.splice(slotIdx, 1)[0];
                if (type === 'fuel') spawnFuelPickup(scene, slot);
                else if (type === 'shield') spawnShieldPickup(scene, slot);
                else if (type === 'points') spawnHighValuePickup(scene, slot);
                else if (type === 'formation') spawnLowValueFormation(scene, slot);
                
                pendingPickups.splice(i, 1);
                i--; // adjust index after removal
            }
        }
    }

    /* ── Move + fade-in obstacles ──────────────────────── */
    for (let i = obstacles.length - 1; i >= 0; i--) {
        const obs = obstacles[i];
        obs.fadeAge = Math.min(obs.fadeAge + dt, OBS_FADE_TIME);
        const opacity = (obs.fadeAge / OBS_FADE_TIME) * OBS_TARGET_OPACITY;
        let rm = false;

        for (const m of obs.parts) {
            if (m.material.transparent) {
                // ShaderMaterial (circle-hole walls & premium boxes) uses uniforms
                if (m.material.isShaderMaterial) {
                    m.material.uniforms.uOpacity.value = opacity;
                    if (m.material.uniforms.uTime) m.material.uniforms.uTime.value = elapsed;
                } else {
                    m.material.opacity = opacity;
                }
            }
            m.position.z += speed * dt;

            if (m.position.z > DESPAWN_Z) rm = true;
        }
        if (rm) {
            obs.parts.forEach(m => { m.geometry.dispose(); m.material.dispose(); scene.remove(m); });
            obstacles.splice(i, 1);
        }
    }

    /* ── Stars ────────────────────────────────────────── */
    scene.userData.starField.material.uniforms.uTime.value = elapsed;

    /* ── Asteroids ────────────────────────────────────── */
    asteroidTimer += dt;
    if (asteroidTimer > 1.3) { asteroidTimer = 0; spawnAsteroid(); }
    for (let i = asteroids.length - 1; i >= 0; i--) {
        const a = asteroids[i];
        a.mesh.position.z += speed * 0.32 * dt;
        a.mesh.rotation.x += a.rotVel.x * dt;
        a.mesh.rotation.y += a.rotVel.y * dt;
        // Fade in over 1.5 seconds
        a.fadeAge = Math.min(a.fadeAge + dt, 1.5);
        a.mesh.material.opacity = a.fadeAge / 1.5;
        if (a.mesh.position.z > DESPAWN_Z + 20) {
            scene.remove(a.mesh);
            a.mesh.material.dispose();
            asteroids.splice(i, 1);
        }
    }

    /* ── Ambient planet ───────────────────────────────── */
    planetSpawnTimer += dt;
    if (planetSpawnTimer >= 0) { planetSpawnTimer -= PLANET_INTERVAL; spawnPlanet(); }
    updatePlanet(dt, speed);

    /* ── Pickup timers ─────────────────────────────────────────
       Timers count up. When one reaches its threshold it marks
       itself "ready". At most ONE pickup spawns per obstacle tick,
       chosen by priority: fuel > shield > big points > formation.
       Each threshold is randomised ±20 % around its base value
       so spawns don't drift into lockstep.                        */
    formationTimer.value  += dt;
    fuelPUTimer.value     += dt;
    pointsTimer.value     += dt;
    shieldPUTimer.value   += dt;

    // Determine which timer (if any) has crossed its threshold.
    // Priority: fuel → shield → points → formation.
    // _jitter(base): returns base ±20 % (uniform)
    const _jitter = base => base * (0.8 + Math.random() * 0.4);

    if (fuelPUTimer.value >= fuelPUTimer._threshold) {
        pendingPickups.push('fuel');
        fuelPUTimer.value = 0; fuelPUTimer._threshold = _jitter(FUEL_PICKUP_BASE);
    } else if (shieldPUTimer.value >= shieldPUTimer._threshold) {
        pendingPickups.push('shield');
        shieldPUTimer.value = 0; shieldPUTimer._threshold = _jitter(SHIELD_PICKUP_BASE);
    } else if (pointsTimer.value >= pointsTimer._threshold) {
        pendingPickups.push('points');
        pointsTimer.value = 0; pointsTimer._threshold = _jitter(POINTS_PICKUP_BASE);
    } else if (formationTimer.value >= formationTimer._threshold) {
        pendingPickups.push('formation');
        formationTimer.value = 0; formationTimer._threshold = _jitter(FORMATION_BASE);
    }

    /* ── Enemies ──────────────────────────────────────── */
    enemyTimer += dt;
    const enemyInterval = Math.max(3, 9 - elapsed * 0.06);  // starts at 9s, floors at 3s
    if (enemyTimer >= enemyInterval) {
        enemyTimer -= enemyInterval;

        // Probability ramp for extra enemies.
        // Enemy 2: starts at 10 %, +5 % per spawn, caps at 50 %.
        // Enemy 3: once cap is reached, a second ramp starts at 10 %, same rule.
        const p2 = Math.min(0.50, 0.10 + enemySpawnCount * 0.05);
        const p3Stages = enemySpawnCount - 8; // negative before 8 spawns (cap reached at spawn 8)
        const p3 = p3Stages >= 0 ? Math.min(0.50, 0.10 + p3Stages * 0.05) : 0;

        _doSpawnEnemy(0);
        if (Math.random() < p2) _doSpawnEnemy(-18);  // slightly behind enemy 1
        if (Math.random() < p3) _doSpawnEnemy(-36);  // further behind
        enemySpawnCount++;
    }

    /* ── Update pickups ───────────────────────────────── */
    const puResult = updatePickups(scene, dt, speed, aircraft.position);
    if (puResult.fuel > 0)   { 
        fuel = Math.min(FUEL_MAX, fuel + puResult.fuel);
        stopFuelLowBeep();
        prevFuelLow = false;
    }


    if (puResult.points > 0) {
        score += puResult.points;
        // Spawn collection burst at pickup world position
        if (puResult.pointsPos) {
            spawnCollectBurst(scene, puResult.pointsPos, 0x44ff88);
            spawnPointsText(scene, puResult.pointsPos, puResult.points);
        }
    }
    if (puResult.shield > 0) {
        shieldTimer = SHIELD_DURATION;
        if (!stopShieldHum) stopShieldHum = startShieldHum();
    }

    updateBurstParticles(scene, dt);
    updatePointsText(scene, dt);

    /* ── Update enemies ───────────────────────────────── */
    const killedByEnemy = updateEnemies(scene, dt, speed, aircraft.position, shielded, camera);

    /* ── Collisions ───────────────────────────────────── */
    pSphere.center.copy(aircraft.position);
    let hitWhileShielded = false;

    // Helper: returns true if player hits this obstacle
    function obsHitsPlayer(obs) {
        if (obs.circleHole) {
            // Circle-hole wall — hit if player is NOT safely inside the hole
            const wallZ = obs.parts[0].position.z;
            if (Math.abs(aircraft.position.z - wallZ) > 3.5) return false;
            const ch = obs.circleHole;
            const dx = aircraft.position.x - ch.x;
            const dy = aircraft.position.y - ch.y;
            return Math.sqrt(dx * dx + dy * dy) > ch.r - PLANE_RADIUS;
        }
        // Normal AABB check
        for (const m of obs.parts) {
            tmpBox.setFromObject(m);
            if (tmpBox.intersectsSphere(pSphere)) return true;
        }
        return false;
    }

    if (!shielded) {
        for (const obs of obstacles) {
            if (obsHitsPlayer(obs)) { spawnExplosion(aircraft.position.clone()); renderer.render(scene, camera); return; }
        }
        if (killedByEnemy) { spawnExplosion(aircraft.position.clone()); renderer.render(scene, camera); return; }
    } else {
        let gotHit = killedByEnemy;
        if (!gotHit) {
            for (const obs of obstacles) {
                if (obsHitsPlayer(obs)) { gotHit = true; break; }
            }
        }
        if (gotHit) hitWhileShielded = true;
    }
    if (hitWhileShielded) {
        // Trigger the 1.5 s flash-out countdown instead of instant removal
        const FLASH_WINDOW = 1.5;
        shieldTimer = Math.min(shieldTimer, FLASH_WINDOW);
    }

    /* ── HUD ──────────────────────────────────────────── */
    elScore.textContent = Math.floor(score);
    const fuelPct = (fuel / FUEL_MAX) * 100;
    elFuel.style.width = fuelPct + '%';
    {
        const t = 1 - fuel / FUEL_MAX;
        const c1 = `rgb(${Math.round(255 * t)},${Math.round(THREE.MathUtils.lerp(170, 68, t))},${Math.round(THREE.MathUtils.lerp(255, 68, t))})`;
        const c2 = `rgb(${Math.round(THREE.MathUtils.lerp(255, 255, t))},${Math.round(THREE.MathUtils.lerp(255, 136, t))},${Math.round(THREE.MathUtils.lerp(255, 136, t))})`;
        elFuel.style.background = `linear-gradient(90deg, ${c1}, ${c2})`;
        if (fuel < 7) elFuel.classList.add('low'); else elFuel.classList.remove('low');
    }
    elBoost.style.opacity = boosting ? 1 : 0;
    if (elShield) elShield.style.opacity = shielded ? 1 : 0;

    /* ── Shield visual around plane ───────────────────── */
    if (shielded) {
        if (!shieldMesh) {
            shieldMesh = createShieldMesh();
            scene.add(shieldMesh);
        }
        shieldMesh.position.copy(aircraft.position);
        shieldMesh.rotation.y = elapsed * 1.5;
        shieldMesh.rotation.x = elapsed * 0.7;
        // Flash 3 times over the last 1.5 s before expiry
        const FLASH_WINDOW = 1.5;
        if (shieldTimer < FLASH_WINDOW) {
            const t = 1 - shieldTimer / FLASH_WINDOW;
            shieldMat.opacity = (0.5 + 0.5 * Math.sin(t * 6 * Math.PI)) * 0.12;
        } else {
            shieldMat.opacity = 0.10;
        }
    } else if (shieldMesh) {
        scene.remove(shieldMesh);
        shieldMesh = null; shieldMat = null;
        // TODO: SOUND — shield just expired
        stopShieldHum?.(); stopShieldHum = null;
    }

    /* ── Looping audio state transitions ──────────────── */
    const fuelLow = fuel < 7 && !fuelOut;
    if (boosting !== prevBoosting) {
        prevBoosting = boosting;
        if (boosting) {
            stopBoostHum = startBoostHum();
        } else {
            stopBoostHum?.(); stopBoostHum = null;
        }
    }
    if (fuelLow !== prevFuelLow) {
        prevFuelLow = fuelLow;
        if (fuelLow) {
            startFuelLowBeep();
        } else {
            stopFuelLowBeep();
        }
    }
    if (fuelLow) {
        // Volume scales from 0.05 at 7s to 0.6 at 0s
        const t = 1 - fuel / 7;
        setLowFuelVolume(0.05 + t * 0.55);
    }


    /* ── Exhaust particles ────────────────────────────── */
    // Emit several particles per frame; more when boosting
    const emitCount = boosting ? 2 : 1;
    for (let i = 0; i < emitCount; i++) emitExhaust(boosting);
    updateExhaust(dt);

    /* ── Hyperspace tunnel ────────────────────────────── */
    updateTunnel(dt, speed, elapsed);

    renderer.render(scene, camera);
    stats.end();
}

loop();
