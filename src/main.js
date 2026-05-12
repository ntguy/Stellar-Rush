import * as THREE from 'three';

import {
    BOUNDS_X, BOUNDS_Y, SPAWN_Z, DESPAWN_Z, PLANE_RADIUS,
    FUEL_MAX, FUEL_PICKUP_BASE, FORMATION_BASE, CREDITS_PICKUP_BASE, SHIELD_PICKUP_BASE,
    OBS_BASE_SPEED, OBS_TARGET_OPACITY, OBS_FADE_TIME,
    BOOST_SPEED_MULT, BOOST_CREDITS_MULT, SHIELD_DURATION,
    matGlow, matAsteroid, matLine, DEVELOPMENT_MODE, FORCE_MOBILE
} from './config.js';

import { nextObstacle, resetSequencer, currentPatternName, isPatternFinished } from './patterns.js';
import { spawnMover, spawnLaserTurret, updateEnemies, clearEnemies } from './enemies.js';
import { spawnFuelPickup, spawnHighValuePickup, spawnShieldPickup, spawnLowValueFormation, updatePickups, clearPickups, spawnCollectBurst, updateBurstParticles, clearBurstParticles, pickups } from './pickups.js';
import {
    playCrash,
    startShieldHum, startBoostHum, startFuelLowBeep,
    initAudio, resumeAudioContext, stopAllAudio, startBaseEngine,
    setLowFuelVolume, stopFuelLowBeep, playOutOfFuel, stopOutOfFuel,
    startMenuMusic, stopMenuMusic, setMasterAudioVolume, setMasterMusicVolume, 
    crossfadeMusicTheme, stopGameplayMusic
} from './audio.js';
import { initTunnel, updateTunnel, clearTunnel, setTunnelColor, getTunnelColor, setTunnelOpacity } from './tunnel.js';
import { LEVELS, WORLD_2_LEVELS, WORLDS, TUNNEL_TRANSITION_DURATION, lerpTunnelColor, spawnInterLevelFormation } from './levels.js';
import {
    createTransitionPlanet, updateTransitionPlanet, clearTransitionPlanet,
    createFogOverlay, setFogOverlayOpacity, clearFogOverlay,
    initWorld2, updateWorld2, clearWorld2, isWorld2Active
} from './world2.js';
import { setupMenuNavigation, handleMenuInput, clearMenuFocus } from './keyboardMenus.js';
import { makeAircraft } from './aircraft.js';
import { buildStarField } from './stars.js';
import { createMenu } from './menu.js';
import { enterUpgradesMenu, exitUpgradesMenu, getEquippedUpgrades, isUpgradesOpen } from './upgrades.js';
import Stats from 'stats';

/* ── Reusable vectors (hoisted out of animate to avoid GC pressure) ── */
const _targetVel   = new THREE.Vector3();
const _beamOrigin  = new THREE.Vector3();
const _beamDir     = new THREE.Vector3(0, 0, -1);
const _nozzleV3    = new THREE.Vector3();
const _exhaustVelV3= new THREE.Vector3();
const _tmpV2       = new THREE.Vector2();
const _navTargets  = [];           // reused array for laser raycasting
const _exhaustRemoveList = [];     // reused array for exhaust cleanup
import { settings, saveSettings } from './settings.js';

// ─── Menu animation config ───
import { getMenuConfig } from './menu-variation-1.js';
import { inputManager } from './inputManager.js';

/* ═══════════════════════════════════════════════════════════
   GAME STATE  —  'MENU' | 'PLAYING'
   ═══════════════════════════════════════════════════════════ */
let gameState = 'MENU';
let paused = false;
let menuController = null;
let currentScore = 0;
let distanceTraveled = 0;
let hasPlayedBefore = false;

/* ── World tracking ──────────────────────────────────────── */
let currentWorldIdx = 0;          // 0 = World 1 (space), 1 = World 2 (clouds)
let selectedWorldIdx = 0;         // which world the player selected from menu
let activeLevels = LEVELS;        // reference to active world's level array

// World transition state
let worldTransitionState = 'NONE'; // 'NONE' | 'PLANET' | 'FOG_IN' | 'SWAP' | 'FOG_OUT'
let worldTransitionTimer = 0;
let asteroidGlobalOpacity = 1.0; // Fades to 0 during World 1 -> World 2 transition

/** Persistence: max world unlocked (1-indexed for display, 0-indexed internally) */
function getMaxWorldUnlocked() {
    return parseInt(localStorage.getItem('maxWorldUnlocked') || '1', 10);
}
function setMaxWorldUnlocked(v) {
    localStorage.setItem('maxWorldUnlocked', v.toString());
}

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
window.addEventListener('touchstart', resumeAudioContext, { once: true });

/* ═══════════════════════════════════════════════════════════
   RENDERER  /  SCENE  /  CAMERA
   ═══════════════════════════════════════════════════════════ */
// Init defaults
if (!localStorage.getItem('stellarRushSettings')) {
    settings.fpsEnabled = DEVELOPMENT_MODE;
    saveSettings();
}

const isLow = settings.preset === 'Low';
const isMedium = settings.preset === 'Medium';
const elGameContainer = document.getElementById('game-container');

const stats = new Stats();
stats.showPanel(0);
stats.dom.style.display = settings.fpsEnabled ? 'block' : 'none';
stats.dom.style.position = 'absolute';
stats.dom.style.right = '4.63vw';
stats.dom.style.left = '';
stats.dom.style.top = '1.63vh';
stats.dom.style.bottom = '';
if (elGameContainer) elGameContainer.appendChild(stats.dom);
else document.body.appendChild(stats.dom);

/* ═══════════════════════════════════════════════════════════
   PERFORMANCE MONITOR  — detailed perf HUD (Shift+P to toggle)
   Shows FPS, frame time, frame budget, draw calls, tris, object counts.
   Uses EMA (exponential moving average) for smooth readings.
   ═══════════════════════════════════════════════════════════ */
const elPerfMonitor = document.getElementById('perf-monitor');
let perfMonitorEnabled = settings.perfMonitor || false;
if (perfMonitorEnabled && elPerfMonitor) elPerfMonitor.classList.add('visible');

const _perf = {
    frameTimes: [],
    lastUpdate: 0,
    emaFps: 60,
    emaFrameMs: 16.7,
    alpha: 0.05,   // EMA smoothing (lower = smoother)
};

function updatePerfMonitor(dt) {
    if (!perfMonitorEnabled || !elPerfMonitor) return;
    const now = performance.now();
    const frameMs = dt * 1000;
    _perf.emaFrameMs = _perf.emaFrameMs * (1 - _perf.alpha) + frameMs * _perf.alpha;
    _perf.emaFps = _perf.emaFps * (1 - _perf.alpha) + (1 / Math.max(dt, 0.001)) * _perf.alpha;

    // Update display at 4Hz to avoid excessive DOM writes
    if (now - _perf.lastUpdate < 250) return;
    _perf.lastUpdate = now;

    const info = renderer.info;
    const fps = Math.round(_perf.emaFps);
    const frameTime = _perf.emaFrameMs.toFixed(1);
    // Budget: what % of the available frame time are we using?
    // At 60Hz, budget is 16.67ms. At 144Hz, budget is 6.94ms.
    const budgetMs = 1000 / Math.max(fps, 30);
    const budgetPct = Math.min(100, ((_perf.emaFrameMs / budgetMs) * 100)).toFixed(0);
    const draws = info.render.calls;
    const tris = info.render.triangles;
    const textures = info.memory.textures;
    const geometries = info.memory.geometries;

    const trisStr = tris > 1000 ? (tris / 1000).toFixed(1) + 'K' : tris;

    elPerfMonitor.textContent =
        `FPS: ${fps}  Frame: ${frameTime}ms  Budget: ${budgetPct}%\n` +
        `Draws: ${draws}  Tris: ${trisStr}  Tex: ${textures}  Geo: ${geometries}\n` +
        `Obstacles: ${obstacles.length}  Pickups: ${pickups.length}  Exhaust: ${exhaustActive.size}`;
}

// Toggle with Shift+P
window.addEventListener('keydown', e => {
    if (e.shiftKey && e.code === 'KeyP') {
        perfMonitorEnabled = !perfMonitorEnabled;
        settings.perfMonitor = perfMonitorEnabled;
        saveSettings();
        if (elPerfMonitor) elPerfMonitor.classList.toggle('visible', perfMonitorEnabled);
    }
});

const MIN_ASPECT = 1.6; // 16:10
const MAX_ASPECT = 2.0; // 18:9
let gameRect = { width: window.innerWidth, height: window.innerHeight, left: 0, top: 0 };

const renderer = new THREE.WebGLRenderer({ antialias: !isLow });
const pr = isLow ? 1.0 : (isMedium ? 1.5 : Math.min(devicePixelRatio, 2));
renderer.setPixelRatio(pr);

function updateSize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    let aspect = w / h;

    let gameW = w;
    let gameH = h;

    if (aspect < MIN_ASPECT) {
        gameH = w / MIN_ASPECT;
    } else if (aspect > MAX_ASPECT) {
        gameW = h * MAX_ASPECT;
    }

    gameRect.width = gameW;
    gameRect.height = gameH;
    gameRect.left = (w - gameW) / 2;
    gameRect.top = (h - gameH) / 2;

    if (elGameContainer) {
        elGameContainer.style.width = `${gameW}px`;
        elGameContainer.style.height = `${gameH}px`;
    }

    renderer.setSize(gameW, gameH);
    camera.aspect = gameW / gameH;
    camera.updateProjectionMatrix();
}

if (elGameContainer) elGameContainer.appendChild(renderer.domElement);
else document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000005);
scene.fog = new THREE.FogExp2(0x000005, 0.0015);

const camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.1, 500);
updateSize();
camera.position.set(0, 10, 20);

/* ═══════════════════════════════════════════════════════════
   LIGHTS
   ═══════════════════════════════════════════════════════════ */
scene.add(new THREE.AmbientLight(0x335588, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(4, 12, 8);
scene.add(sun);

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

    _nozzleV3.set(0, 0, 1.4).applyQuaternion(aircraft.quaternion).add(aircraft.position);
    m.position.copy(_nozzleV3);
    m.scale.setScalar(1);
    const spd = 5 + Math.random() * 4;
    const spread = boosting ? 2.4 : 1.2;
    if (!m.userData.vel) m.userData.vel = new THREE.Vector3();
    m.userData.vel.set(
        (Math.random() - 0.5) * spread,
        (Math.random() - 0.5) * spread,
        spd,
    );
    m.userData.life = 1.0;
    scene.add(m);
    exhaustActive.add(m);
}

function updateExhaust(dt) {
    _exhaustRemoveList.length = 0;
    for (const p of exhaustActive) {
        p.userData.life -= dt * 3.5;
        if (p.userData.life <= 0) {
            _exhaustRemoveList.push(p);
            continue;
        }
        p.position.addScaledVector(p.userData.vel, dt);
        p.material.opacity = p.userData.life * 0.85;
        p.scale.setScalar(p.userData.life * 0.9);
        p.lookAt(camera.position);
    }
    for (let i = 0; i < _exhaustRemoveList.length; i++) {
        const p = _exhaustRemoveList[i];
        scene.remove(p);
        exhaustActive.delete(p);
        exhaustFree.push(p);
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
    ctx.clearRect(0, 0, 256, 128);
    ctx.fillStyle = '#ffff88';
    ctx.font = 'bold 60px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`+${points}`, 128, 64);
    
    // Create texture and sprite
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
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
let fuel, credits, elapsed, gameOver;
let fuelOut = false, fuelOutTimer = 0;
let effectiveFuelMax = FUEL_MAX;
let boostExtraFuelSpent = 0;
let boostFadeTimer = 0;

/* ── Upgrades State ───────────────────────────────────────── */
let upgFuelTankMult = 1.0;
let upgTopSpeedMult = 1.0;
let upgBoostFuelMult = 1.0;
let upgBoostPowerMult = 1.0;
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
    upgTopSpeedMult = 1.0 + (eq.includes('eng2') ? 0.10 : 0) + (eq.includes('eng5') ? 0.25 : 0);
    upgBoostFuelMult = eq.includes('eng4') ? 0.5 : 1.0;
    upgBoostPowerMult = eq.includes('eng6') ? 1.5 : 1.0;
    
    upgPassiveCreditsMult = 1.0 + (eq.includes('eco1') ? 0.10 : 0);
    upgMagnetStrength = (eq.includes('eco2') ? 10 : 0) + (eq.includes('eco4') ? 15 : 0);
    upgFormationBonus = eq.includes('eco3') ? 50 : 0;
    
    upgShieldDurationBonus = (eq.includes('def1') ? 5 : 0) + (eq.includes('def2') ? 5 : 0);
    upgInvincibleShield = eq.includes('def3');
    upgNavSystem = eq.includes('def4');
    upgPermanentShield = eq.includes('def5');
    
    effectiveFuelMax = FUEL_MAX * upgFuelTankMult;
    if (elFuelWrap) {
        elFuelWrap.style.width = (13.23 * upgFuelTankMult) + 'vw';
    }

    // Navigation Laser — Now always present, upgrade makes it better
    if (!navBeam) {
        const beamGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,-1)]);
        const beamMat = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: new THREE.Color(0xff0000) },
                uOpacity: { value: 0.8 },
                uFade: { value: 0.0 }
            },
            vertexShader: `
                varying float vZ;
                void main() {
                    vZ = position.z; // 0 at plane, -1 at end
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uColor;
                uniform float uOpacity;
                uniform float uFade;
                varying float vZ;
                void main() {
                    float alpha = uOpacity;
                    if (uFade > 0.5) {
                        // vZ goes from 0 to -1
                        alpha *= (1.0 + vZ); 
                    }
                    gl_FragColor = vec4(uColor, alpha);
                }
            `,
            transparent: true
        });
        navBeam = new THREE.Line(beamGeo, beamMat);
        navBeam.frustumCulled = false;
        scene.add(navBeam);

        const dotGeo = new THREE.SphereGeometry(0.15, 8, 8);
        const dotMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        navDot = new THREE.Mesh(dotGeo, dotMat);
        scene.add(navDot);

        navPointLight = new THREE.PointLight(0xff0000, 5.0, 12);
        scene.add(navPointLight);
    }

    if (upgNavSystem) {
        // Improved: Bright, solid, no fade
        navBeam.material.uniforms.uOpacity.value = 0.8;
        navBeam.material.uniforms.uFade.value = 0.0;
    } else {
        // Base: Thinner/Fainter, fades out
        navBeam.material.uniforms.uOpacity.value = 0.6;
        navBeam.material.uniforms.uFade.value = 1.0;
    }
}

function cleanupNavBeam() {
    if (navBeam) {
        scene.remove(navBeam);
        navBeam.geometry.dispose();
        navBeam.material.dispose();
        navBeam = null;
    }
    if (navDot) {
        scene.remove(navDot);
        navDot.geometry.dispose();
        navDot.material.dispose();
        navDot = null;
    }
    if (navPointLight) {
        scene.remove(navPointLight);
        navPointLight.dispose();
        navPointLight = null;
    }
}

function showNotification(text) {
    const el = document.getElementById('notification-overlay');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    if (el._timer) clearTimeout(el._timer);
    el._timer = setTimeout(() => {
        el.classList.remove('show');
    }, 2000);
}

let spawnTimer, asteroidTimer, fuelPUTimer, formationTimer, creditsTimer, shieldPUTimer, enemyTimer;
let shieldTimer;
// How many times enemies have been spawned — drives multi-enemy probability ramp
let enemySpawnCount;
let exploding = false, explodeTimer = 0;
const explosionParts = [];
const obstacles = [];

/* ── Level Scaling — level system state ──────────────────── */
let currentLevelIdx = 0;        // index into activeLevels[]
let targetLevelIdx = 0;         // next level to transition to
let levelTimer = 0;             // seconds elapsed within current level
// 'PLAYING' = normal gameplay, 'TRANSITION' = inter-level pickup formation & color shift
// 'WORLD_TRANSITION' = transitioning between worlds
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

const target   = new THREE.Vector3();
const vel      = new THREE.Vector3();
const tmpV     = new THREE.Vector3();
const tmpBox   = new THREE.Box3();
const pSphere  = new THREE.Sphere(new THREE.Vector3(), PLANE_RADIUS);

/** 
 * Signed Distance Function for an Equilateral Triangle 
 * (Returns < 0 if inside, > 0 if outside)
 */
function sdEquilateralTriangle(px, py, r) {
    const k = 1.73205081; // sqrt(3)
    px = Math.abs(px) - r;
    py = py + r/k;
    if (px + k*py > 0.0) {
        const tx = px - k*py;
        const ty = -k*px - py;
        px = tx / 2.0;
        py = ty / 2.0;
    }
    px -= Math.max(-2.0*r, Math.min(px, 0.0));
    return -Math.sqrt(px*px + py*py) * Math.sign(py);
}

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
// Initial mobile check
if (inputManager.isMobile || FORCE_MOBILE) {
    document.body.classList.add('is-mobile');
    inputManager.isMobile = true;
}

function getIsMobile() {
    return inputManager.isMobile || FORCE_MOBILE;
}

inputManager.on('onControlModeChange', mode => {
    if (gameState === 'PLAYING') {
        if (mode === 'KEYBOARD') {
            showNotification('Keyboard Input');
            document.body.style.cursor = 'none';
        } else if (mode === 'MOUSE') {
            showNotification('Mouse Input');
            document.body.style.cursor = 'crosshair';
        }
    } else if ((gameState !== 'PLAYING' || paused || gameOver) && mode === 'MOUSE') {
        clearMenuFocus();
    }
});

inputManager.on('onMenuAction', key => {
    if ((gameState !== 'PLAYING' || paused || gameOver) && !isUpgradesOpen()) {
        handleMenuInput(key);
    }
});

inputManager.on('onPauseAction', () => {
    if (gameState === 'PLAYING') {
        togglePause();
    }
});

inputManager.on('onAnyInput', () => {
    resumeAudioContext();
});

window.addEventListener('resize', updateSize);

/* ═══════════════════════════════════════════════════════════
   HUD ELEMENTS
   ═══════════════════════════════════════════════════════════ */
const elCredits   = document.getElementById('credits');
const elFuelWrap  = document.getElementById('fuel-wrap');
const elFuel      = document.getElementById('fuel-bar');
const elFuelBoost = document.getElementById('fuel-bar-boost');
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
const elSettingAudioVol = document.getElementById('setting-audio-vol');
const elSettingMusicVol = document.getElementById('setting-music-vol');

// Init UI from settings
if (elSettingPreset) elSettingPreset.value = settings.preset;
if (elSettingFps) elSettingFps.checked = settings.fpsEnabled;
if (elSettingFov) elSettingFov.value = settings.fov;
if (elSettingAudioVol) elSettingAudioVol.value = settings.audioVol !== undefined ? settings.audioVol : 1.0;
if (elSettingMusicVol) elSettingMusicVol.value = settings.musicVol !== undefined ? settings.musicVol : 1.0;

// Apply volume immediately
setMasterAudioVolume(settings.audioVol !== undefined ? settings.audioVol : 1.0);
setMasterMusicVolume(settings.musicVol !== undefined ? settings.musicVol : 1.0);

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
if (elSettingAudioVol) {
    elSettingAudioVol.addEventListener('input', (e) => {
        settings.audioVol = parseFloat(e.target.value);
        setMasterAudioVolume(settings.audioVol);
        saveSettings();
    });
}
if (elSettingMusicVol) {
    elSettingMusicVol.addEventListener('input', (e) => {
        settings.musicVol = parseFloat(e.target.value);
        setMasterMusicVolume(settings.musicVol);
        saveSettings();
    });
}

document.getElementById('restart-btn').addEventListener('click', restart);
document.getElementById('game-over-back-btn').addEventListener('click', backToMainMenu);
document.getElementById('pause-back-btn').addEventListener('click', backToMainMenu);
elResume.addEventListener('click', togglePause);
elMenuBtn.addEventListener('click', () => { if (gameState === 'PLAYING') togglePause(); });

document.getElementById('upgrades-btn').addEventListener('click', () => {
    clearMenuFocus();
    inputManager.setControlMode('MOUSE');
    document.body.style.cursor = 'default';
    enterUpgradesMenu(scene, camera, aircraft, () => {
        // Returned from Game Over upgrades
        document.getElementById('game-over').classList.add('show');
        setupMenuNavigation('game-over', inputManager.controlMode === 'KEYBOARD' ? 1 : -1);
    });
});

document.getElementById('upgrades-menu-btn').addEventListener('click', () => {
    clearMenuFocus();
    inputManager.setControlMode('MOUSE');
    document.body.style.cursor = 'default';
    enterUpgradesMenu(scene, camera, aircraft, () => {
        // Returned from Main Menu upgrades
        document.getElementById('main-menu').style.display = 'flex';
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
    effectiveFuelMax = FUEL_MAX * upgFuelTankMult;
    fuel = effectiveFuelMax;
    credits = 0; elapsed = 0;
    gameOver = false;
    fuelOut = false; fuelOutTimer = 0;
    paused = false;

    // World system — set the active level array based on selected world
    currentWorldIdx = selectedWorldIdx;
    activeLevels = currentWorldIdx === 0 ? LEVELS : WORLD_2_LEVELS;

    // Level Scaling — reset level state
    currentLevelIdx = 0;
    targetLevelIdx = 0;
    levelTimer = 0;
    levelState = 'PLAYING';
    transitionFormationDepth = 0;
    transitionWaitTimer = 0;
    formationSpawned = false;
    colorShiftTimer = 0;
    colorShiftFrom = null;
    colorShiftTo = null;
    worldTransitionState = 'NONE';
    worldTransitionTimer = 0;
    asteroidGlobalOpacity = 1.0;
    setTunnelOpacity(0.2); // Reset tunnel to default opacity

    spawnTimer = 0; asteroidTimer = 0; enemyTimer = 0;
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
    boostExtraFuelSpent = 0;
    boostFadeTimer = 0;
    // Stop any active looping sounds
    stopBoostHum?.();    stopBoostHum    = null;
    stopShieldHum?.();   stopShieldHum   = null;
    stopFuelLowBeep();
    stopMenuMusic();

    aircraft.position.set(0, 0, 0);
    aircraft.rotation.set(0, 0, 0);
    aircraft.scale.setScalar(1);
    vel.set(0, 0, 0);
    inputManager.reset();
    matGlow.color.set(0x00fff7);

    // Reset visibility of guide line and nav laser
    guideLine.visible = true;
    if (navBeam) navBeam.visible = true;

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
    clearTransitionPlanet(scene);
    clearFogOverlay(scene);
    clearWorld2(scene, camera);

    // Make sure aircraft is in the scene (menu may have removed it)
    if (!aircraft.parent) scene.add(aircraft);

    // Restore default scene background and fog for World 1
    scene.background = new THREE.Color(0x000005);
    scene.fog = new THREE.FogExp2(0x000005, 0.0015);

    if (currentWorldIdx === 0) {
        // World 1 init — space environment
        crossfadeMusicTheme('world1');
        // Make sure star field is in the scene
        if (scene.userData.starField && !scene.userData.starField.parent) {
            scene.add(scene.userData.starField);
        }
        initTunnel(scene);
        setTunnelColor(activeLevels[0].tunnelColor);
        if (planetMesh) {
            scene.remove(planetMesh);
            planetMesh.geometry.dispose();
            planetMesh.material.dispose();
            planetMesh = null;
        }
        planetSpawnTimer = -30;
        // Seed initial asteroids
        for (let i = 0; i < 30; i++) {
            spawnAsteroid(SPAWN_Z + Math.random() * (DESPAWN_Z - SPAWN_Z));
        }
        scene.userData.starField.material.uniforms.uTime.value = 0;
    } else if (currentWorldIdx === 1) {
        // World 2 init — cloud kingdom
        initWorld2(scene, camera);
        crossfadeMusicTheme('world2');
    }

    resetSequencer();
    pendingPickups.length = 0;

    startBaseEngine();

    elOverlay.classList.remove('show');
    elPause.classList.remove('show');
    clearMenuFocus();

    // Show gameplay UI
    elHud.classList.remove('hidden');
    elMenuBtn.classList.add('visible');
    if (getIsMobile()) document.getElementById('mobile-controls').classList.add('visible');

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
        setupMenuNavigation('pause-menu', inputManager.controlMode === 'KEYBOARD' ? 0 : -1);
        
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
    const ws = document.getElementById('world-select');
    if (ws) ws.style.display = 'none';
    stopAllAudio();
    document.body.style.cursor = 'default';
    enterMenu();
}


function enterMenu() {
    gameState = 'MENU';
    elHud.classList.add('hidden');
    elMenuBtn.classList.remove('visible');
    document.getElementById('mobile-controls').classList.remove('visible');
    inputManager.reset();
    setupMenuNavigation('main-menu', inputManager.controlMode === 'KEYBOARD' ? 0 : -1);


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
    clearTransitionPlanet(scene);
    clearFogOverlay(scene);
    clearWorld2(scene, camera);
    aircraft.visible = false;
    if (scene.userData.starField) scene.remove(scene.userData.starField);
    clearTunnel(scene);
    cleanupNavBeam();
    // Restore default scene state
    scene.background = new THREE.Color(0x000005);
    scene.fog = new THREE.FogExp2(0x000005, 0.0015);
    // Remove gameplay lights (menu adds its own)
    scene.children
        .filter(c => c.isLight || c === guideLine)
        .forEach(c => scene.remove(c));
    
    // Ensure menu buttons are visible and reset
    const menuActions = document.getElementById('menu-actions');
    if (menuActions) {
        menuActions.classList.remove('hidden');
    }

    // Create menu
    if (menuController) menuController.dispose();
    menuController = createMenu(scene, camera, getMenuConfig(), hasPlayedBefore);
    hasPlayedBefore = true;
    menuController.onReady(startMenuMusic);
    menuController.onPlay(() => {
        // Show world select instead of going straight to gameplay
        showWorldSelect();
    });
    clock.getDelta();
}

/* ═══════════════════════════════════════════════════════════
   WORLD SELECT  — shown after clicking PLAY
   ═══════════════════════════════════════════════════════════ */
function showWorldSelect() {
    const el = document.getElementById('world-select');
    if (!el) { startWithWorld(0); return; }  // fallback

    const maxUnlocked = getMaxWorldUnlocked();
    const btns = el.querySelectorAll('.world-btn');
    btns.forEach((btn, i) => {
        const locked = (i + 1) > maxUnlocked;
        // World 3 is always locked (no levels yet)
        const noLevels = i === 2;
        btn.classList.toggle('locked', locked || noLevels);
        btn.disabled = locked || noLevels;
        const lockIcon = btn.querySelector('.lock-icon');
        if (lockIcon) lockIcon.style.display = (locked || noLevels) ? 'inline' : 'none';
    });

    el.style.display = 'flex';
    
    // Hide main menu buttons when world selection is open
    const menuActions = document.getElementById('menu-actions');
    if (menuActions) {
        menuActions.classList.add('hidden');
        menuActions.classList.remove('visible');
    }

    setupMenuNavigation('world-select', inputManager.controlMode === 'KEYBOARD' ? 0 : -1);
}

function startWithWorld(worldIdx) {
    const el = document.getElementById('world-select');
    if (el) el.style.display = 'none';

    if (menuController) {
        menuController.dispose();
        menuController = null;
    }
    document.getElementById('main-menu').style.display = 'none';

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

    selectedWorldIdx = worldIdx;
    init();
}

// Wire up world-select buttons (bound once at load)
(function _bindWorldSelect() {
    const el = document.getElementById('world-select');
    if (!el) return;
    el.querySelectorAll('.world-btn').forEach((btn, i) => {
        btn.addEventListener('click', () => {
            if (!btn.disabled) startWithWorld(i);
        });
    });
    const backBtn = document.getElementById('world-select-back');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            el.style.display = 'none';
            document.getElementById('main-menu').style.display = 'flex';

            const menuActions = document.getElementById('menu-actions');
            if (menuActions) {
                menuActions.classList.remove('hidden');
                menuActions.classList.add('visible');
            }

            setupMenuNavigation('main-menu', inputManager.controlMode === 'KEYBOARD' ? 0 : -1);
        });
    }
})();

/* ── Startup ──────────────────────────────────────────────── */
if (DEVELOPMENT_MODE) {
    const splash = document.getElementById('play-splash');
    if (splash) splash.remove();
    hasPlayedBefore = true; // Skips intro animation
    enterMenu();
} else {
    (function initSplash() {
        const splash = document.getElementById('play-splash');
        if (!splash) return;

        function dismissSplash() {
            resumeAudioContext();
            splash.classList.add('hidden');
            setTimeout(() => splash.remove(), 750);
            enterMenu();
        }

        const playBtn = document.getElementById('play-splash-btn');
        
        function onSplashKey(e) {
            if (e.code === 'Space' || e.key === ' ') {
                e.preventDefault();
                cleanup();
                dismissSplash();
            }
        }

        function cleanup() {
            window.removeEventListener('keydown', onSplashKey);
        }

        playBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            cleanup();
            dismissSplash();
        });

        window.addEventListener('keydown', onSplashKey);
    })();
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
    setupMenuNavigation('game-over', inputManager.controlMode === 'KEYBOARD' ? 0 : -1);
    document.body.style.cursor = 'default';
    stopAllAudio();
    document.getElementById('mobile-controls').classList.remove('visible');
}


/* ═══════════════════════════════════════════════════════════
   EXPLOSION
   ═══════════════════════════════════════════════════════════ */
function spawnExplosion(pos) {
    exploding = true; explodeTimer = 0;
    aircraft.visible = false;
    guideLine.visible = false;
    if (navBeam) {
        navBeam.visible = false;
        navDot.visible = false;
        navPointLight.visible = false;
    }
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
function animate() {
    requestAnimationFrame(animate);
    let dt = Math.min(clock.getDelta(), 0.1);
    let boosting = false;

    if (gameState === 'PLAYING' && !paused && !gameOver) {
        boosting = inputManager.actions.boost;
    }

    stats.begin();

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

    // Level Scaling — speed is set per level
    const currentLevel = activeLevels[currentLevelIdx];
    let levelSpeedRamp = 0;
    if (currentLevel.speedRampPerSecond) {
        levelSpeedRamp = levelTimer * currentLevel.speedRampPerSecond;
    }
    const baseSpeed = (OBS_BASE_SPEED + levelSpeedRamp) * currentLevel.speedMultiplier;
    
    // Upgrade Logic: Boost Power increases the boost speed increase by 50%
    const boostSpeedInc = (BOOST_SPEED_MULT - 1) * upgBoostPowerMult;
    let speed = (boosting ? baseSpeed * (1 + boostSpeedInc) : baseSpeed) * upgTopSpeedMult;
    
    // TEMPORARY: 20% speed boost for World 2 to increase difficulty while we use World 1 patterns.
    // TODO: Remove this once custom World 2 patterns/balancing are implemented.
    if (currentWorldIdx === 1) speed *= 1.3;
    
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


    /* ── Input Processing ─────────────────────────────── */
    let inputX = inputManager.actions.moveX;
    let inputY = inputManager.actions.moveY;

    const inputMag = Math.sqrt(inputX * inputX + inputY * inputY);

    
    const defaultMaxSpd = 15;
    const topSpeedBoost = defaultMaxSpd * upgBoostPowerMult;
    const maxSpd = (boosting ? defaultMaxSpd + topSpeedBoost : defaultMaxSpd) * upgTopSpeedMult;
    
    _targetVel.set(0, 0, 0);

    if (inputManager.controlMode === 'KEYBOARD' || (getIsMobile() && inputMag > 0)) {
        // ── Direct Steering (Keys / Joystick) ──
        _targetVel.set(inputX * maxSpd, inputY * maxSpd, 0);
        guideLine.visible = false;
    } else if (inputManager.controlMode === 'MOUSE' && !getIsMobile()) {
        // ── Seek Mode (Mouse) ──
        guideLine.visible = true;
        const mouseNDC = inputManager.getMouseNDC(gameRect);
        raycaster.setFromCamera(mouseNDC, camera);
        raycaster.ray.intersectPlane(zPlane, target);
        target.x = THREE.MathUtils.clamp(target.x, -BOUNDS_X, BOUNDS_X);
        target.y = THREE.MathUtils.clamp(target.y, -BOUNDS_Y, BOUNDS_Y);
        target.z = 0;

        tmpV.subVectors(target, aircraft.position);
        const dist = tmpV.length();

        if (dist > 0.01) {
            // Cap speed right at the end to physically prevent overshooting the cursor in one frame.
            // For 95% of the distance, this equals maxSpd. Only slows down in the last ~1.5 units.
            const maxSafeSpd = (dist / dt) * 0.4; 
            const desiredSpd = Math.min(maxSpd, maxSafeSpd);
            _targetVel.copy(tmpV).setLength(desiredSpd);
        } else {
            // Absolute hard stop to kill all jiggle
            _targetVel.set(0, 0, 0);
            vel.set(0, 0, 0); 
        }
    } else {
        // ── Idle Damping ──
        guideLine.visible = false;
        _targetVel.set(0, 0, 0);
    }

    // Since acceleration has been removed, instantly apply target velocity
    vel.copy(_targetVel);

    aircraft.position.addScaledVector(vel, dt);
    aircraft.position.x = THREE.MathUtils.clamp(aircraft.position.x, -BOUNDS_X, BOUNDS_X);
    aircraft.position.y = THREE.MathUtils.clamp(aircraft.position.y, -BOUNDS_Y + 6.0, BOUNDS_Y);
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
    if (guideLine.visible) {
        const dist = aircraft.position.distanceTo(target);
        const lp = guideLine.geometry.attributes.position.array;
        lp[0] = aircraft.position.x; lp[1] = aircraft.position.y; lp[2] = aircraft.position.z;
        lp[3] = target.x;            lp[4] = target.y;            lp[5] = target.z;
        guideLine.geometry.attributes.position.needsUpdate = true;
        matLine.opacity = THREE.MathUtils.clamp(dist * 0.06, 0, 0.4);
    }

    if (navBeam) {
        // Upgrade Logic: Navigation Laser Raycasting
        _beamOrigin.set(0, 0, -1.4).applyQuaternion(aircraft.quaternion).add(aircraft.position);
        _beamDir.set(0, 0, -1);
        navRaycaster.set(_beamOrigin, _beamDir);
        
        // Reuse persistent array instead of allocating a new one each frame
        _navTargets.length = 0;
        for (let oi = 0; oi < obstacles.length; oi++) {
            const parts = obstacles[oi].parts;
            for (let pi = 0; pi < parts.length; pi++) {
                _navTargets.push(parts[pi]);
            }
        }
        const intersects = navRaycaster.intersectObjects(_navTargets);
        
        let maxDist = upgNavSystem ? 200 : 60;
        let laserDist = maxDist; 
        let hitFound = false;

        if (intersects.length > 0) {
            for (const hit of intersects) {
                const obs = obstacles.find(o => o.parts.includes(hit.object));
                if (obs) {
                    if (obs.circleHole) {
                        const dx = hit.point.x - obs.circleHole.x;
                        const dy = hit.point.y - obs.circleHole.y;
                        if (Math.sqrt(dx * dx + dy * dy) < obs.circleHole.r) continue;
                    }
                    if (obs.squareHole) {
                        const dx = Math.abs(hit.point.x - obs.squareHole.x);
                        const dy = Math.abs(hit.point.y - obs.squareHole.y);
                        if (dx < obs.squareHole.w / 2 && dy < obs.squareHole.h / 2) continue;
                    }
                    if (obs.triforceHoles) {
                        _tmpV2.set(hit.point.x, hit.point.y);
                        const th = obs.triforceHoles;
                        if (_tmpV2.distanceTo(th.p1) < th.r || _tmpV2.distanceTo(th.p2) < th.r || _tmpV2.distanceTo(th.p3) < th.r) continue;
                    }
                    if (obs.isRotatingSectorHole) {
                        const rsh = obs.isRotatingSectorHole;
                        const dx = hit.point.x;
                        const dy = hit.point.y;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist <= rsh.radius) {
                            let a = Math.atan2(dy, dx);
                            a += elapsed * rsh.speed;
                            a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
                            let inSector = false;
                            if (rsh.startAngle < rsh.endAngle) {
                                inSector = (a >= rsh.startAngle && a <= rsh.endAngle);
                            } else {
                                inSector = (a >= rsh.startAngle || a <= rsh.endAngle);
                            }
                            if (inSector) continue;
                        }
                    }
                }
                
                if (hit.distance < maxDist) {
                    laserDist = hit.distance;
                    hitFound = true;
                    
                    if (upgNavSystem) {
                        navDot.visible = true;
                        navPointLight.visible = true;
                        navDot.position.copy(hit.point);
                        navPointLight.position.copy(hit.point);
                    } else {
                        navDot.visible = false;
                        navPointLight.visible = false;
                    }
                }
                break;
            }
        }

        if (!hitFound) {
            navDot.visible = false;
            navPointLight.visible = false;
        }

        navBeam.position.copy(_beamOrigin);
        navBeam.rotation.set(0, 0, 0);
        navBeam.scale.set(1, 1, laserDist);
    }

    /* ── Camera follow ────────────────────────────────── */
    camera.position.x += (aircraft.position.x * 0.35 - camera.position.x) * 3 * dt;
    camera.position.y += ((aircraft.position.y * 0.25 + 4.5) - camera.position.y) * 3 * dt;
    camera.lookAt(aircraft.position.x * 0.2, aircraft.position.y * 0.2, -35);

    /* ── Level State Machine (Level Scaling) ────────────────── */
    if (levelState === 'PLAYING') {
        levelTimer += dt;

        if (levelTimer >= currentLevel.duration && isPatternFinished()) {
            if (currentLevelIdx < activeLevels.length - 1) {
                // Normal inter-level transition within same world
                targetLevelIdx = currentLevelIdx + 1;
                levelState = 'TRANSITION';
            } else if (currentWorldIdx === 0) {
                // End of World 1 — trigger world transition to World 2
                levelState = 'WORLD_TRANSITION';
                worldTransitionState = 'PLANET';
                worldTransitionTimer = 0;
                createTransitionPlanet(scene);
                createFogOverlay(scene, camera);
            } else {
                // End of last level in World 2+ — loop (for now)
                levelTimer = 0;
            }
            transitionWaitTimer = 0;
            formationSpawned = false;
            transitionFormationDepth = 0;
        } else {
            /* ── Spawn obstacles ──────────────────────────────── */
            spawnTimer += dt;
            if (spawnTimer > currentLevel.obstacleInterval) {
                if (levelTimer < currentLevel.duration || !isPatternFinished()) {
                    spawnTimer -= currentLevel.obstacleInterval;
                    const patternParams = { ...currentLevel.difficultyParams, obstacleInterval: currentLevel.obstacleInterval, speed: speed };
                    const slots = nextObstacle(scene, obstacles, patternParams);
                    slots.forEach(s => s.patternName = currentPatternName);

                // First, handle slots that have a MANDATORY pickup type (like patternChoice)
                for (let i = slots.length - 1; i >= 0; i--) {
                    const slot = slots[i];
                    if (slot.pickupType) {
                        if (slot.pickupType === 'fuel') spawnFuelPickup(scene, slot);
                        else if (slot.pickupType === 'credits') spawnHighValuePickup(scene, slot);
                        else if (slot.pickupType === 'shield') spawnShieldPickup(scene, slot);
                        else if (slot.pickupType === 'formation') spawnLowValueFormation(scene, slot);
                        slots.splice(i, 1);
                    }
                }

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
        
        const EMPTY_SPACE_DELAY = 1.0; 

        if (!formationSpawned && transitionWaitTimer >= EMPTY_SPACE_DELAY) {
            const depthInfo = spawnInterLevelFormation(scene, speed);
            transitionFormationDepth = depthInfo.totalDepth;
            formationSpawned = true;

            // Level Scaling — capture color shift start state now that obstacles have cleared
            colorShiftFrom = getTunnelColor().clone();
            colorShiftTo = activeLevels[targetLevelIdx].tunnelColor;
            colorShiftTimer = 0;
        }
        
        if (formationSpawned) {
            // Level Scaling — process tunnel color shift during the formation phase
            if (colorShiftFrom && colorShiftTo) {
                colorShiftTimer += dt;
                const ct = Math.min(colorShiftTimer / TUNNEL_TRANSITION_DURATION, 1.0);
                setTunnelColor(lerpTunnelColor(colorShiftFrom, colorShiftTo, ct));
            }

            // Start next level as soon as the formation has cleared SPAWN_Z with a small buffer
            const distanceToCover = transitionFormationDepth + 60;
            const timeToCover = (distanceToCover / speed) + EMPTY_SPACE_DELAY;
            
            // Return to PLAYING once formation has passed AND color shift is complete
            const colorDone = colorShiftTimer >= TUNNEL_TRANSITION_DURATION;
            if (transitionWaitTimer > timeToCover && colorDone) {
                currentLevelIdx = targetLevelIdx;
                levelState = 'PLAYING';
                levelTimer = 0;
            }
        }
    } else if (levelState === 'WORLD_TRANSITION') {
        /* ── World Transition State Machine ──────────────── */
        worldTransitionTimer += dt;

        if (worldTransitionState === 'PLANET') {
            // Phase 1: Planet grows, pickup formation spawns
            updateTransitionPlanet(dt);
            
            // Fade out existing asteroids over the first 3 seconds of the transition
            asteroidGlobalOpacity = Math.max(0, 1.0 - worldTransitionTimer / 3.0);
            
            // Fade out the hyperspace tunnel over the first 8 seconds
            const tunnelFade = Math.max(0, 1.0 - worldTransitionTimer / 8.0);
            setTunnelOpacity(0.2 * tunnelFade);

            if (!formationSpawned && worldTransitionTimer >= 1.0) {
                const depthInfo = spawnInterLevelFormation(scene, speed, true);
                transitionFormationDepth = depthInfo.totalDepth;
                formationSpawned = true;
            }

            // Wait until planet has grown and pickup formation has passed
            // Padding of 15 units ensures the last fuel gem is fully collected
            const distanceToCover = DESPAWN_Z - (SPAWN_Z - (transitionFormationDepth || 0)) + 15;
            const timeToClearFormation = (distanceToCover / speed);

            if (worldTransitionTimer >= Math.max(12.0, timeToClearFormation)) {
                worldTransitionState = 'FOG_IN';
                worldTransitionTimer = 0;
            }
        } else if (worldTransitionState === 'FOG_IN') {
            // Phase 2: Fog ramps up to white-out (reduced to 3s for tighter feel)
            const flashDuration = 2.5;
            const fogT = Math.min(worldTransitionTimer / flashDuration, 1.0);
            setFogOverlayOpacity(fogT);

            updateTransitionPlanet(dt);

            if (worldTransitionTimer >= flashDuration) {
                worldTransitionState = 'SWAP';
                worldTransitionTimer = 0;
            }
        } else if (worldTransitionState === 'SWAP') {
            // Phase 3: Instantaneous environment swap
            // Clean up World 1
            clearTransitionPlanet(scene);
            clearTunnel(scene);
            for (const a of asteroids) {
                scene.remove(a.mesh);
                a.mesh.material.dispose();
            }
            asteroids.length = 0;
            if (scene.userData.starField) scene.remove(scene.userData.starField);
            if (planetMesh) {
                scene.remove(planetMesh);
                planetMesh.geometry.dispose();
                planetMesh.material.dispose();
                planetMesh = null;
            }
            clearEnemies(scene);
            for (const o of obstacles) o.parts.forEach(m => { m.geometry?.dispose(); m.material?.dispose(); scene.remove(m); });
            obstacles.length = 0;
            clearPickups(scene);

            // Switch to World 2
            currentWorldIdx = 1;
            activeLevels = WORLD_2_LEVELS;
            currentLevelIdx = 0;
            levelTimer = 0;
            resetSequencer();
            pendingPickups.length = 0;
            initWorld2(scene, camera);
            crossfadeMusicTheme('world2');

            // Unlock World 2 in persistence
            if (getMaxWorldUnlocked() < 2) setMaxWorldUnlocked(2);

            worldTransitionState = 'FOG_OUT';
            worldTransitionTimer = 0;
        } else if (worldTransitionState === 'FOG_OUT') {
            // Phase 4: Fog clears, revealing Cloud Kingdom (reduced to 1.5s)
            const revealDuration = 1.5;
            const fogT = 1.0 - Math.min(worldTransitionTimer / revealDuration, 1.0);
            setFogOverlayOpacity(fogT);

            if (worldTransitionTimer >= revealDuration) {
                clearFogOverlay(scene);
                levelState = 'PLAYING';
                worldTransitionState = 'NONE';
                formationSpawned = false;
            }
        }
    }

    /* ── Move + fade-in obstacles ──────────────────────── */
    for (let i = obstacles.length - 1; i >= 0; i--) {
        const obs = obstacles[i];
        obs.fadeAge = Math.min(obs.fadeAge + dt, OBS_FADE_TIME);
        const targetOpacity = (obs.targetOpacity !== undefined) ? obs.targetOpacity : OBS_TARGET_OPACITY;
        let opacity = (obs.fadeAge / OBS_FADE_TIME) * targetOpacity;
        let rm = false;
            
        if (obs.isFadingOut) {
            obs.fadeOutTimer = (obs.fadeOutTimer ?? 1.0) - dt;
            opacity *= Math.max(0, obs.fadeOutTimer);
            if (obs.fadeOutTimer <= 0) rm = true;
        }

        for (const m of obs.parts) {
            if (m.material && m.material.transparent) {
                // ShaderMaterial (circle-hole walls & premium boxes) uses uniforms
                const partOpacity = (m.userData.opacityMult !== undefined) ? opacity * m.userData.opacityMult : opacity;
                
                let finalOpacity = partOpacity;
                if (m.userData.flash > 0) {
                    m.userData.flash -= dt * 2.5; // Flash over ~0.4s
                    const flashAmt = Math.max(0, m.userData.flash);
                    // Flash: fast ramp up and settle. Using a simple exponential decay feel.
                    finalOpacity = THREE.MathUtils.lerp(partOpacity, 1.0, flashAmt);
                }

                if (m.material.isShaderMaterial) {
                    m.material.uniforms.uOpacity.value = finalOpacity;
                    if (m.material.uniforms.uTime) m.material.uniforms.uTime.value = elapsed;
                } else {
                    m.material.opacity = finalOpacity;
                }
            }
            m.position.z += speed * dt;

            let despawnLimit = DESPAWN_Z; if (obs.isLong) despawnLimit += obs.isLong.depth / 2; if (m === obs.parts[0] && m.position.z > despawnLimit) rm = true;
        }

        // Tic-Tac-Toe / Interactive pattern capture logic
        if (obs.onPass && !obs.captured) {
            const firstPart = obs.parts[0];
            if (firstPart && firstPart.position.z >= aircraft.position.z) {
                obs.captured = true;
                obs.onPass(aircraft.position);
            }
        }

        if (rm) {
            obs.parts.forEach(m => {
                // Only dispose material (per-instance); geometry may be cached/shared
                if (m.material) m.material.dispose();
                scene.remove(m);
            });
            obstacles.splice(i, 1);
        }
    }

    /* ── World-specific environment updates ────────────── */
    if (currentWorldIdx === 0) {
        /* ── Stars ────────────────────────────────────────── */
        if (scene.userData.starField && scene.userData.starField.parent) {
            scene.userData.starField.material.uniforms.uTime.value = elapsed;
        }

        /* ── Asteroids ────────────────────────────────────── */
        asteroidTimer += dt;
        if (asteroidTimer > 1.3) { asteroidTimer = 0; spawnAsteroid(); }
        for (let i = asteroids.length - 1; i >= 0; i--) {
            const a = asteroids[i];
            a.mesh.position.z += speed * 0.32 * dt;
            a.mesh.rotation.x += a.rotVel.x * dt;
            a.mesh.rotation.y += a.rotVel.y * dt;
            // Fade in over 1.5 seconds, then apply global transition multiplier
            a.fadeAge = Math.min(a.fadeAge + dt, 1.5);
            a.mesh.material.opacity = (a.fadeAge / 1.5) * asteroidGlobalOpacity;
            if (a.mesh.position.z > DESPAWN_Z + 20) {
                scene.remove(a.mesh);
                a.mesh.material.dispose();
                asteroids.splice(i, 1);
            }
        }

        /* ── Ambient planet ───────────────────────────────── */
        planetSpawnTimer += dt;
        if (planetSpawnTimer >= 0) {
            planetSpawnTimer -= PLANET_INTERVAL;

            // Prevent planet spawn if we are in World 1 and nearing the World 2 transition,
            // or if we are already in the World transition phase.
            const isNearWorldTransition = (levelState === 'WORLD_TRANSITION') ||
                (currentLevel && currentLevel.level === 3 && levelTimer > (currentLevel.duration - 15));

            if (!isNearWorldTransition) {
                spawnPlanet();
            }
        }
        updatePlanet(dt, speed);
    } else if (currentWorldIdx === 1) {
        /* ── World 2 environment ──────────────────────────── */
        updateWorld2(dt, speed, elapsed);
    }

    /* ── Update pickups ───────────────────────────────── */
    const puResult = updatePickups(scene, dt, speed, aircraft.position, upgMagnetStrength); // Upgrade Logic: Magnet
    if (puResult.fuel > 0)   { 
        fuel = Math.min(effectiveFuelMax, fuel + puResult.fuel); // Upgrade Logic: Fuel tank
        stopFuelLowBeep();
        stopOutOfFuel();
        fuelOut = false;
        fuelOutTimer = 0;
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
        // Delay the formation bonus text so it doesn't overlap with the last gem pickup
        const bonusPos = (puResult.creditsPos ? puResult.creditsPos.clone() : aircraft.position.clone());
        // Push it slightly further into the distance (-Z) so it's "ahead"
        bonusPos.z -= 8; 
        
        setTimeout(() => {
            if (gameState === 'PLAYING' && !paused) {
                spawnCollectBurst(scene, bonusPos, 0x44ff88);
                spawnCreditsText(scene, bonusPos, upgFormationBonus);
            }
        }, 150);
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
        if (obs.isRotatingSectorHole) {
            const wallZ = obs.parts[0].position.z;
            if (Math.abs(aircraft.position.z - wallZ) > 3.5) return false;
            const rsh = obs.isRotatingSectorHole;
            const dist = Math.sqrt(aircraft.position.x * aircraft.position.x + aircraft.position.y * aircraft.position.y);
            if (dist > rsh.radius) return false;
            let angle = Math.atan2(aircraft.position.y, aircraft.position.x);
            angle += elapsed * rsh.speed;
            angle = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
            let inSector = false;
            if (rsh.startAngle < rsh.endAngle) {
                inSector = (angle >= rsh.startAngle && angle <= rsh.endAngle);
            } else {
                inSector = (angle >= rsh.startAngle || angle <= rsh.endAngle);
            }
            if (inSector) return false;
            return true;
        }
        if (obs.isTube) {
            const centerZ = obs.parts[0].position.z;
            const halfDepth = obs.isTube.depth / 2;
            const frontZ = centerZ + halfDepth;
            const backZ = centerZ - halfDepth;
            if (aircraft.position.z < frontZ + 2 && aircraft.position.z > backZ - 2) {
                const dist = Math.sqrt(aircraft.position.x * aircraft.position.x + aircraft.position.y * aircraft.position.y);
                if (dist > obs.isTube.radius - PLANE_RADIUS) return true;
            }
            return false;
        }
        if (obs.isSectorHole) {
            const wallZ = obs.parts[0].position.z;
            if (Math.abs(aircraft.position.z - wallZ) > 3.5) return false;
            const dist = Math.sqrt(aircraft.position.x * aircraft.position.x + aircraft.position.y * aircraft.position.y);
            if (dist > obs.isSectorHole.r - PLANE_RADIUS) return true;
            let angle = Math.atan2(aircraft.position.y, aircraft.position.x);
            if (angle < 0) angle += Math.PI * 2;
            let start = obs.isSectorHole.startAngle;
            let end = obs.isSectorHole.endAngle;
            let inSector = false;
            if (start < end) {
                inSector = (angle >= start && angle <= end);
            } else {
                inSector = (angle >= start || angle <= end);
            }
            // we want to be IN the cut-out section to survive.
            if (!inSector) return true;
            return false;
        }
        if (obs.circleHole) {
            // Circle-hole wall — hit if player is NOT safely inside the hole
            const wallZ = obs.parts[0].position.z;
            if (Math.abs(aircraft.position.z - wallZ) > 3.5) return false;
            const ch = obs.circleHole;
            const dx = aircraft.position.x - ch.x;
            const dy = aircraft.position.y - ch.y;
            return Math.sqrt(dx * dx + dy * dy) > ch.r - PLANE_RADIUS;
        }
        if (obs.squareHole) {
            // Square-hole wall
            const wallZ = obs.parts[0].position.z;
            if (Math.abs(aircraft.position.z - wallZ) > 3.5) return false;
            const sh = obs.squareHole;
            const dx = Math.abs(aircraft.position.x - sh.x);
            const dy = Math.abs(aircraft.position.y - sh.y);
            return dx > (sh.w / 2 - PLANE_RADIUS) || dy > (sh.h / 2 - PLANE_RADIUS);
        }
        if (obs.triforceHoles) {
            // Triforce wall (3 triangular holes)
            const wallZ = obs.parts[0].position.z;
            if (Math.abs(aircraft.position.z - wallZ) > 3.5) return false;
            const th = obs.triforceHoles;
            
            const px = aircraft.position.x;
            const py = aircraft.position.y;

            const d1 = sdEquilateralTriangle(px - th.p1.x, py - th.p1.y, th.r);
            const d2 = sdEquilateralTriangle(px - th.p2.x, py - th.p2.y, th.r);
            const d3 = sdEquilateralTriangle(px - th.p3.x, py - th.p3.y, th.r);
            
            // To be safely "inside" the hole, the aircraft's center must be 
            // further than PLANE_RADIUS from any edge (i.e. d <= -PLANE_RADIUS)
            if (d1 < -PLANE_RADIUS || d2 < -PLANE_RADIUS || d3 < -PLANE_RADIUS) return false;
            return true;
        }
        if (obs.isSimonWall) {
            const wallZ = obs.parts[0].position.z;
            // 3.5 is the collision depth buffer
            if (Math.abs(aircraft.position.z - wallZ) > 3.5) return false;
            
            const sw = obs.isSimonWall;
            const dx = aircraft.position.x - sw.holeX;
            const dy = aircraft.position.y - sw.holeY;
            
            let inside = false;
            if (sw.shapeType === 'circle') {
                inside = (dx*dx + dy*dy < sw.holeR * sw.holeR);
            } else if (sw.shapeType === 'square') {
                inside = (Math.abs(dx) < sw.holeR * 0.9 && Math.abs(dy) < sw.holeR * 0.9);
            } else if (sw.shapeType === 'triangle') {
                inside = (sdEquilateralTriangle(dx, dy, sw.holeR * 1.1) < 0);
            }
            
            // If aircraft is safely inside the correct hole, no collision
            if (inside) return false;
            return true; // Crash into the solid part of the wall
        }
        if (obs.isDiagonalTop) {
            const diag = obs.isDiagonalTop;
            const wallPos = obs.parts[0].position;
            const dx = aircraft.position.x - wallPos.x;
            const dy = aircraft.position.y - wallPos.y;
            const dz = aircraft.position.z - wallPos.z;
            const cosA = Math.cos(-diag.angle);
            const sinA = Math.sin(-diag.angle);
            const localX = dx * cosA + dz * sinA;
            const localY = dy;
            const localZ = -dx * sinA + dz * cosA;
            const halfW = diag.width / 2 + PLANE_RADIUS;
            const halfH = diag.height / 2 + PLANE_RADIUS;
            const halfD = PLANE_RADIUS;
            if (Math.abs(localX) > halfW) return false;
            if (Math.abs(localY) > halfH) return false;
            if (Math.abs(localZ) > halfD) return false;
            return true;
        }
        // Normal AABB check
        for (const m of obs.parts) {
            if (m.userData.noHit) continue;
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
    
    if (boosting && !fuelOut) {
        elFuelWrap.classList.add('boosting');
        boostFadeTimer = 0;
        elFuelBoost.style.opacity = '1';
        
        // Calculate extra fuel spent since this boost started
        const extraRate = 1 * upgBoostFuelMult;
        boostExtraFuelSpent += dt * extraRate;
        
        const extraPct = (boostExtraFuelSpent / effectiveFuelMax) * 100;
        elFuel.style.width = fuelPct + '%';
        elFuelBoost.style.width = Math.min(100, fuelPct + extraPct) + '%';
    } else {
        elFuelWrap.classList.remove('boosting');
        elFuel.style.width = fuelPct + '%';
        
        if (prevBoosting && !boosting) {
            boostFadeTimer = 0.3;
        }

        if (boostFadeTimer > 0) {
            boostFadeTimer -= dt;
            if (boostFadeTimer < 0) boostFadeTimer = 0;
            elFuelBoost.style.opacity = (boostFadeTimer / 0.3).toString();
            // Keep width at its last value during fade
        } else {
            boostExtraFuelSpent = 0;
            elFuelBoost.style.width = '0';
            elFuelBoost.style.opacity = '0';
        }
    }

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

    /* ── Hyperspace tunnel (World 1 only) ─────────────── */
    if (currentWorldIdx === 0) updateTunnel(dt, speed, elapsed);

    renderer.render(scene, camera);
    updatePerfMonitor(dt);
    stats.end();
}

animate();
