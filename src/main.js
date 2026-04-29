import * as THREE from 'three';

import {
    BOUNDS_X, BOUNDS_Y, SPAWN_Z, DESPAWN_Z, PLANE_RADIUS,
    FUEL_MAX, FUEL_PICKUP_BASE, FORMATION_BASE, CREDITS_PICKUP_BASE, SHIELD_PICKUP_BASE,
    OBS_BASE_SPEED, OBS_SPEED_RAMP, OBS_TARGET_OPACITY, OBS_FADE_TIME,
    BOOST_SPEED_MULT, BOOST_CREDITS_MULT, SHIELD_DURATION,
    matBody, matAccent, matGlow, matAsteroid, matLine, DEVELOPMENT_MODE
} from './config.js';

import { nextObstacle, resetSequencer } from './patterns.js';
import { spawnMover, spawnLaserTurret, updateEnemies, clearEnemies } from './enemies.js';
import { spawnFuelPickup, spawnHighValuePickup, spawnShieldPickup, spawnLowValueFormation, updatePickups, clearPickups, spawnCollectBurst, updateBurstParticles, clearBurstParticles } from './pickups.js';
import {
    playLaserFire, playCrash, playFuelCollect, playCreditsCollect, playShieldCollect,
    startShieldHum, startBoostHum, startFuelLowBeep,
    initAudio, resumeAudioContext, stopAllAudio, startBaseEngine,
    setLowFuelVolume, stopFuelLowBeep, playOutOfFuel,
    startMenuMusic, stopMenuMusic
} from './audio.js';
import { initTunnel, updateTunnel, clearTunnel, setTunnelColor, getTunnelColor } from './tunnel.js';
import { LEVELS, TUNNEL_TRANSITION_DURATION, lerpTunnelColor, spawnInterLevelFormation } from './levels.js';
import { makeAircraft } from './aircraft.js';
import { buildStarField } from './stars.js';
import { createMenu } from './menu.js';
import { enterUpgradesMenu, exitUpgradesMenu, getEquippedUpgrades } from './upgrades.js';
import Stats from 'stats';
import { settings, saveSettings } from './settings.js';

// ─── Menu animation config ───
import { getMenuConfig } from './menu-variation-1.js';

/* ═══════════════════════════════════════════════════════════
   GAME STATE  —  'MENU' | 'PLAYING'
   ═══════════════════════════════════════════════════════════ */
let gameState = 'MENU';
let paused = false;
let menuController = null;
let currentScore = 0;
let distanceTraveled = 0;
let hasPlayedBefore = false;

// Remove startup fade
window.addEventListener('DOMContentLoaded', () => {
    const fade = document.getElementById('startup-fade');
    if (fade) {
        // Short delay to ensure first frame is ready
        setTimeout(() => {
            fade.style.opacity = '0';
            setTimeout(() => fade.remove(), 500);
        }, 100);
    }
});

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
stats.dom.style.right = '70px';
stats.dom.style.left = '';
stats.dom.style.top = '16px';
stats.dom.style.bottom = '';
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
   CREDITS TEXT DISPLAY — pops out and fizzles
   ═══════════════════════════════════════════════════════════ */

const creditsTextMeshes = [];

function spawnCreditsText(scene, pos, points) {
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
    creditsTextMeshes.push(sprite);
}

function updateCreditsText(scene, dt) {
    for (let i = creditsTextMeshes.length - 1; i >= 0; i--) {
        const s = creditsTextMeshes[i];
        s.userData.life -= dt * 2.2;  // fade over ~0.45s
        if (s.userData.life <= 0) {
            scene.remove(s);
            s.material.map.dispose();
            s.material.dispose();
            creditsTextMeshes.splice(i, 1);
            continue;
        }
        s.position.addScaledVector(s.userData.velocity, dt);
        s.material.opacity = s.userData.life;
        s.scale.multiplyScalar(0.98);  // slightly shrink as they fade
    }
}

function clearCreditsText(scene) {
    for (const s of creditsTextMeshes) {
        scene.remove(s);
        s.material.map.dispose();
        s.material.dispose();
    }
    creditsTextMeshes.length = 0;
}

/* ═══════════════════════════════════════════════════════════
   STATE
   ═══════════════════════════════════════════════════════════ */
let fuel, credits, elapsed, gameOver, boosting;
let fuelOut = false, fuelOutTimer = 0;

/* ── Upgrades State ───────────────────────────────────────── */
let upgFuelTankMult = 1.0;
let upgBaseAccelMult = 1.0;
let upgTopSpeedMult = 1.0;
let upgBoostFuelMult = 1.0;
let upgPassiveCreditsMult = 1.0;
let upgMagnetStrength = 0;
let upgFormationBonus = 0;
let upgShieldDurationBonus = 0;
let upgInvincibleShield = false;
let upgPermanentShield = false;
let upgNavSystem = false;
let navBeam = null;
let navDot = null;
let navPointLight = null;
const navRaycaster = new THREE.Raycaster();

function applyUpgrades() {
    // Upgrade Logic: compute multipliers based on equipped upgrades
    const eq = getEquippedUpgrades().map(u => u.id);
    
    upgFuelTankMult = 1.0 + (eq.includes('eng1') ? 0.15 : 0) + (eq.includes('eng3') ? 0.30 : 0);
    upgBaseAccelMult = 1.0 + (eq.includes('eng2') ? 0.10 : 0) + (eq.includes('eng5') ? 0.25 : 0);
    upgTopSpeedMult = 1.0 + (eq.includes('eng5') ? 0.25 : 0);
    upgBoostFuelMult = eq.includes('eng4') ? 0.5 : 1.0;
    
    upgPassiveCreditsMult = 1.0 + (eq.includes('eco1') ? 0.10 : 0);
    upgMagnetStrength = (eq.includes('eco2') ? 10 : 0) + (eq.includes('eco4') ? 15 : 0);
    upgFormationBonus = eq.includes('eco3') ? 50 : 0;
    
    upgShieldDurationBonus = (eq.includes('def1') ? 5 : 0) + (eq.includes('def2') ? 5 : 0);
    upgInvincibleShield = eq.includes('def3');
    upgNavSystem = eq.includes('def4');
    upgPermanentShield = eq.includes('def5');

    if (upgNavSystem && !navBeam) {
        // Upgrade Logic: Laser Navigation System Initialization
        const beamGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,-1)]);
        const beamMat = new THREE.LineBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.8 });
        navBeam = new THREE.Line(beamGeo, beamMat);
        scene.add(navBeam);

        const dotGeo = new THREE.SphereGeometry(0.15, 8, 8);
        const dotMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        navDot = new THREE.Mesh(dotGeo, dotMat);
        scene.add(navDot);

        navPointLight = new THREE.PointLight(0xff0000, 5.0, 12);
        scene.add(navPointLight);
    } else if (!upgNavSystem && navBeam) {
        scene.remove(navBeam);
        scene.remove(navDot);
        scene.remove(navPointLight);
        navBeam.geometry.dispose();
        navBeam.material.dispose();
        navDot.geometry.dispose();
        navDot.material.dispose();
        navPointLight.dispose();
        navBeam = null;
        navDot = null;
        navPointLight = null;
    }
}

let spawnTimer, asteroidTimer, fuelPUTimer, formationTimer, creditsTimer, shieldPUTimer, enemyTimer;
let shieldTimer;
// How many times enemies have been spawned — drives multi-enemy probability ramp
let enemySpawnCount;
let exploding = false, explodeTimer = 0;
const explosionParts = [];
const obstacles = [];

/* ── Level Scaling — level system state ──────────────────── */
let currentLevelIdx = 0;        // index into LEVELS[]
let levelTimer = 0;             // seconds elapsed within current level
// 'PLAYING' = normal gameplay, 'TRANSITION' = inter-level pickup formation & color shift
let levelState = 'PLAYING';
let transitionFormationDepth = 0;  // Z-depth of spawned inter-level formation
let transitionWaitTimer = 0;       // counts up while waiting for formation to pass
let formationSpawned = false;      // true once inter-level formation is triggered
let colorShiftTimer = 0;           // 0→TUNNEL_TRANSITION_DURATION during colour shift
let colorShiftFrom = null;         // THREE.Color we're transitioning from
let colorShiftTo = null;           // THREE.Color we're transitioning to

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
let shieldIsBreaking = false;

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
const elCredits   = document.getElementById('credits');
const elFuel    = document.getElementById('fuel-bar');
const elBoost   = document.getElementById('boost-indicator');
const elShield  = document.getElementById('shield-indicator');
const elOverlay = document.getElementById('game-over');
const elFinalCredits   = document.getElementById('final-credits');
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
document.getElementById('game-over-back-btn').addEventListener('click', backToMainMenu);
document.getElementById('pause-back-btn').addEventListener('click', backToMainMenu);
elResume.addEventListener('click', togglePause);
elMenuBtn.addEventListener('click', () => { if (gameState === 'PLAYING') togglePause(); });

document.getElementById('upgrades-btn').addEventListener('click', () => {
    enterUpgradesMenu(scene, camera, aircraft, () => {
        // Returned from Game Over upgrades
        document.getElementById('game-over').classList.add('show');
    });
});

document.getElementById('upgrades-menu-btn').addEventListener('click', () => {
    enterUpgradesMenu(scene, camera, aircraft, () => {
        // Returned from Main Menu upgrades
        document.getElementById('main-menu').style.display = 'flex'; // or whatever the default display is, though it uses CSS to show
        // Wait, main-menu is handled by enterMenu(), let's just redraw the main menu
        enterMenu();
    });
});

document.getElementById('upgrades-back-btn').addEventListener('click', () => {
    exitUpgradesMenu(scene, camera, aircraft);
});

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
    applyUpgrades();
    const effectiveFuelMax = FUEL_MAX * upgFuelTankMult; // Upgrade Logic: Fuel tank
    fuel = effectiveFuelMax; credits = 0; elapsed = 0;
    gameOver = false; boosting = false;
    fuelOut = false; fuelOutTimer = 0;
    paused = false;

    // Level Scaling — reset level state
    currentLevelIdx = 0;
    levelTimer = 0;
    levelState = 'PLAYING';
    transitionFormationDepth = 0;
    transitionWaitTimer = 0;
    formationSpawned = false;
    colorShiftTimer = 0;
    colorShiftFrom = null;
    colorShiftTo = null;

    spawnTimer = 0; asteroidTimer = 0;
    // Initialise pickup timers as objects with value and threshold
    const _jitter0 = base => base * (0.8 + Math.random() * 0.4);
    fuelPUTimer    = { value: 0, _threshold: _jitter0(FUEL_PICKUP_BASE) };
    formationTimer = { value: 0, _threshold: _jitter0(FORMATION_BASE) };
    creditsTimer    = { value: 0, _threshold: _jitter0(CREDITS_PICKUP_BASE) };
    shieldPUTimer  = { value: 0, _threshold: _jitter0(SHIELD_PICKUP_BASE) };
    shieldTimer = 0;
    shieldIsBreaking = false;
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
    clearCreditsText(scene);
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
    // Level Scaling — set initial tunnel colour to level 1
    setTunnelColor(LEVELS[0].tunnelColor);
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
    clearCreditsText(scene);
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
    navBeam = null; 
    navDot = null;
    navPointLight = null;

    // Create menu
    if (menuController) menuController.dispose();
    menuController = createMenu(scene, camera, getMenuConfig(), hasPlayedBefore);
    hasPlayedBefore = true;
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
    let bank = parseInt(localStorage.getItem('bankedCredits') || '0', 10);
    bank += Math.floor(credits);
    localStorage.setItem('bankedCredits', bank.toString());

    elFinalCredits.textContent = Math.floor(credits);
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
    const effectiveFuelMax = FUEL_MAX * upgFuelTankMult;

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
    // Upgrade Logic: Permanent Shield
    if (shieldIsBreaking) {
        shieldTimer -= dt;
        if (shieldTimer <= 0) {
            shieldTimer = 0;
            shieldIsBreaking = false;
        }
    } else if (shielded && !upgPermanentShield) {
        shieldTimer -= dt;
    }

    // Level Scaling — speed is set per level, with optional ramp only on final level
    const currentLevel = LEVELS[currentLevelIdx];
    let levelSpeedRamp = 0;
    if (currentLevel.speedRampPerSecond) {
        // Level Scaling — minor speed increase over time only on final level
        levelSpeedRamp = levelTimer * currentLevel.speedRampPerSecond;
    }
    const baseSpeed = (OBS_BASE_SPEED + levelSpeedRamp) * currentLevel.speedMultiplier;
    // Upgrade Logic: Top Speed 
    let speed = (boosting ? baseSpeed * BOOST_SPEED_MULT : baseSpeed) * upgTopSpeedMult;
    
    // Out of fuel slowdown
    if (fuelOut) {
        fuelOutTimer += dt;
        const slowdown = Math.max(0, 1 - fuelOutTimer / 5.0);
        speed *= slowdown;
        boosting = false; // can't boost without fuel
        if (fuelOutTimer >= 5.0) { endGame(); return; }
    }

    const creditsMult = boosting ? BOOST_CREDITS_MULT : 1;
    // Upgrade Logic: Passive Credits
    credits += dt * (10 + elapsed * 0.5) * creditsMult * upgPassiveCreditsMult;

    /* ── Fuel ─────────────────────────────────────────── */
    if (!fuelOut) {
        // Upgrade Logic: Eff. Boost uses less extra fuel. (Base 1, Extra 1 * mult)
        const boostCost = 1 + (1 * upgBoostFuelMult); 
        fuel -= dt * (boosting ? boostCost : 1);
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
    // Upgrade Logic: Steering top speed and acceleration
    const maxSpd = (boosting ? 60 : 20) * upgTopSpeedMult;
    const accel  = (boosting ? 120 : 40) * upgBaseAccelMult;

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
    const ft = 1 - fuel / effectiveFuelMax;
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

    if (navBeam) {
        // Upgrade Logic: Navigation Laser Raycasting
        const beamOrigin = aircraft.position.clone();
        const beamDir = new THREE.Vector3(0, 0, -1); 
        navRaycaster.set(beamOrigin, beamDir);
        
        const targetMeshes = [];
        obstacles.forEach(obs => obs.parts.forEach(m => targetMeshes.push(m)));
        const intersects = navRaycaster.intersectObjects(targetMeshes);
        
        let laserDist = 200; 
        if (intersects.length > 0) {
            laserDist = intersects[0].distance;
            navDot.visible = true;
            navPointLight.visible = true;
            navDot.position.copy(intersects[0].point);
            navPointLight.position.copy(intersects[0].point);
        } else {
            navDot.visible = false;
            navPointLight.visible = false;
        }

        const positions = navBeam.geometry.attributes.position.array;
        positions[0] = beamOrigin.x; positions[1] = beamOrigin.y; positions[2] = beamOrigin.z;
        positions[3] = beamOrigin.x; positions[4] = beamOrigin.y; positions[5] = beamOrigin.z - laserDist;
        navBeam.geometry.attributes.position.needsUpdate = true;
    }

    /* ── Camera follow ────────────────────────────────── */
    camera.position.x += (aircraft.position.x * 0.35 - camera.position.x) * 3 * dt;
    camera.position.y += ((aircraft.position.y * 0.25 + 4.5) - camera.position.y) * 3 * dt;
    camera.lookAt(aircraft.position.x * 0.2, aircraft.position.y * 0.2, -35);

    /* ── Level State Machine (Level Scaling) ────────────────── */
    if (levelState === 'PLAYING') {
        levelTimer += dt;

        if (levelTimer >= currentLevel.duration) {
            if (currentLevelIdx < LEVELS.length - 1) {
                currentLevelIdx++;
                levelState = 'TRANSITION';
            } else {
                levelTimer = 0;
            }
            transitionWaitTimer = 0;
            formationSpawned = false;
            transitionFormationDepth = 0;
        } else {
            /* ── Spawn obstacles ──────────────────────────────── */
            spawnTimer += dt;
            if (spawnTimer > currentLevel.obstacleInterval) {
                spawnTimer -= currentLevel.obstacleInterval;
                const slots = nextObstacle(scene, obstacles, currentLevel.difficultyParams);
                
                const priority = { 'fuel': 0, 'shield': 1, 'credits': 2, 'formation': 3 };
                pendingPickups.sort((a, b) => priority[a] - priority[b]);

                for (let i = 0; i < pendingPickups.length; i++) {
                    const type = pendingPickups[i];
                    const reqSlotType = (type === 'formation') ? 'formation' : 'single';
                    
                    const slotIdx = slots.findIndex(s => s.type === reqSlotType);
                    if (slotIdx !== -1) {
                        const slot = slots.splice(slotIdx, 1)[0];
                        if (type === 'fuel') spawnFuelPickup(scene, slot);
                        else if (type === 'shield') spawnShieldPickup(scene, slot);
                        else if (type === 'credits') spawnHighValuePickup(scene, slot);
                        else if (type === 'formation') spawnLowValueFormation(scene, slot);
                        
                        pendingPickups.splice(i, 1);
                        i--;
                    }
                }
            }

            /* ── Pickup timers ───────────────────────────────────────── */
            formationTimer.value  += dt;
            fuelPUTimer.value     += dt;
            creditsTimer.value     += dt;
            shieldPUTimer.value   += dt;

            const _jitter = base => base * (0.8 + Math.random() * 0.4);

            if (fuelPUTimer.value >= fuelPUTimer._threshold) {
                pendingPickups.push('fuel');
                fuelPUTimer.value = 0; fuelPUTimer._threshold = _jitter(FUEL_PICKUP_BASE);
            } else if (shieldPUTimer.value >= shieldPUTimer._threshold) {
                pendingPickups.push('shield');
                shieldPUTimer.value = 0; shieldPUTimer._threshold = _jitter(SHIELD_PICKUP_BASE);
            } else if (creditsTimer.value >= creditsTimer._threshold) {
                pendingPickups.push('credits');
                creditsTimer.value = 0; creditsTimer._threshold = _jitter(CREDITS_PICKUP_BASE);
            } else if (formationTimer.value >= formationTimer._threshold) {
                pendingPickups.push('formation');
                formationTimer.value = 0; formationTimer._threshold = _jitter(FORMATION_BASE);
            }

            /* ── Enemies ──────────────────────────────────────── */
            enemyTimer += dt;
            if (enemyTimer >= currentLevel.enemyInterval) {
                enemyTimer -= currentLevel.enemyInterval;
                
                let numEnemies = 1;
                if (currentLevel.enemyMaxCount >= 2 && Math.random() < 0.4) numEnemies = 2;
                if (currentLevel.enemyMaxCount >= 3 && Math.random() < 0.2) numEnemies = 3;
                
                for(let i=0; i<numEnemies; i++) {
                    _doSpawnEnemy(-i * 18);
                }
            }
        }
    } else if (levelState === 'TRANSITION') {
        transitionWaitTimer += dt;
        
        const EMPTY_SPACE_DELAY = 2.0; 

        if (!formationSpawned && transitionWaitTimer >= EMPTY_SPACE_DELAY) {
            const depthInfo = spawnInterLevelFormation(scene);
            transitionFormationDepth = depthInfo.totalDepth;
            formationSpawned = true;

            // Level Scaling — capture color shift start state now that obstacles have cleared
            colorShiftFrom = getTunnelColor().clone();
            colorShiftTo = LEVELS[currentLevelIdx].tunnelColor;
            colorShiftTimer = 0;
        }
        
        if (formationSpawned) {
            // Level Scaling — process tunnel color shift during the formation phase
            if (colorShiftFrom && colorShiftTo) {
                colorShiftTimer += dt;
                const ct = Math.min(colorShiftTimer / TUNNEL_TRANSITION_DURATION, 1.0);
                setTunnelColor(lerpTunnelColor(colorShiftFrom, colorShiftTo, ct));
            }

            // Wait for formation to pass. Reduced padding from 50 to 10 for less downtime.
            const distanceToCover = DESPAWN_Z - (SPAWN_Z - transitionFormationDepth) + 10;
            const timeToCover = (distanceToCover / speed) + EMPTY_SPACE_DELAY;
            
            // Return to PLAYING once formation has passed AND color shift is complete
            const colorDone = colorShiftTimer >= TUNNEL_TRANSITION_DURATION;
            if (transitionWaitTimer > timeToCover && colorDone) {
                levelState = 'PLAYING';
                levelTimer = 0;
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

    /* ── Update pickups ───────────────────────────────── */
    const puResult = updatePickups(scene, dt, speed, aircraft.position, upgMagnetStrength); // Upgrade Logic: Magnet
    if (puResult.fuel > 0)   { 
        fuel = Math.min(FUEL_MAX * upgFuelTankMult, fuel + puResult.fuel); // Upgrade Logic: Fuel tank
        stopFuelLowBeep();
        prevFuelLow = false;
    }


    if (puResult.credits > 0) {
        credits += puResult.credits;
        // Spawn collection burst at pickup world position
        if (puResult.creditsPos) {
            spawnCollectBurst(scene, puResult.creditsPos, 0x44ff88);
            spawnCreditsText(scene, puResult.creditsPos, puResult.credits);
        }
    }
    
    if (puResult.formationCompleted && upgFormationBonus > 0) {
        // Upgrade Logic: Formation Bonus
        credits += upgFormationBonus;
        spawnCollectBurst(scene, puResult.creditsPos || aircraft.position, 0x44ff88);
        spawnCreditsText(scene, puResult.creditsPos || aircraft.position, upgFormationBonus);
    }
    
    if (puResult.shield > 0) {
        shieldTimer = SHIELD_DURATION + upgShieldDurationBonus; // Upgrade Logic: Shield Duration
        shieldIsBreaking = false;
        if (!stopShieldHum) stopShieldHum = startShieldHum();
    }

    updateBurstParticles(scene, dt);
    updateCreditsText(scene, dt);

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
        // Upgrade Logic: Invincible Shield
        if (!upgInvincibleShield) {
            // Upgrade Logic: Shield Breaking sequence (ignores permanent shield)
            shieldIsBreaking = true;
            shieldTimer = 0.5; // Fast flash before removal
        }
    }

    /* ── HUD ──────────────────────────────────────────── */
    elCredits.textContent = Math.floor(credits);
    const fuelPct = (fuel / effectiveFuelMax) * 100;
    elFuel.style.width = fuelPct + '%';
    {
        const t = 1 - fuel / effectiveFuelMax;
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
        
        // Upgrade Logic: Shield Flash Visualization
        if (shieldIsBreaking) {
            // Rapid single flash for impact breaking
            const t = 1 - shieldTimer / 0.5;
            shieldMat.opacity = (0.5 + 0.5 * Math.sin(t * Math.PI)) * 0.45;
        } else if (shieldTimer < 1.5) {
            // Standard flicker for time-based expiry
            const t = 1 - shieldTimer / 1.5;
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
