/* ═══════════════════════════════════════════════════════════
   CONFIG.JS  —  Stellar Rush
   ─────────────────────────────────────────────────────────
   Central constants and shared Three.js materials.
   All gameplay-tuning values live here so they can be
   adjusted without touching logic files.
   ═══════════════════════════════════════════════════════════ */
import * as THREE from 'three';

/* ── World bounds & spawn lanes ───────────────────────────── */
export const BOUNDS_X = 24;       // ±X limit for player & obstacles
export const BOUNDS_Y = 16;       // ±Y limit
export const SPAWN_Z  = -200;     // Z where new objects appear (behind camera) — spawned 2s earlier for longer fade-in
export const DESPAWN_Z = 25;      // Z where objects are removed (past camera)

/* ── Gameplay ─────────────────────────────────────────────── */
export const FUEL_MAX             = 30;  // seconds of fuel
export const FUEL_PICKUP_BASE     = 15;  // baseline seconds between fuel drops
export const FORMATION_BASE       = 5;   // baseline seconds between gem formations
export const POINTS_PICKUP_BASE   = 10;  // baseline seconds between high-value point gems
export const SHIELD_PICKUP_BASE   = 30;  // baseline seconds between shield drops
export const PLANE_RADIUS    = 1.4;   // hatbox radius — matches fuselage body width
export const OBS_BASE_SPEED  = 45;
export const OBS_SPEED_RAMP  = 0.30;   // units/s² — reduced from 0.55 for gentler acceleration
export const OBS_TARGET_OPACITY = 0.78;
export const OBS_FADE_TIME   = 3.0;
export const BOOST_SPEED_MULT = 1.15;   // +15 % forward speed while boosting
export const BOOST_SCORE_MULT = 1.15;   // +15 % points while boosting
export const SHIELD_DURATION  = 10;      // seconds

/* ── Safe-zone pickup placement ───────────────────────────
   Patterns generate "safe zones" — positions guaranteed to be
   clear of obstacles — so pickups never overlap walls.

   SINGLE ZONES: spots where a fuel / shield / high-value pickup
   can be placed.  Each pattern step generates up to this many:  */


/* ── Enemy tuning ─────────────────────────────────────────── */
export const ENEMY_MOVER_SPEED = 13;   // was 8 — faster movers
export const ENEMY_LASER_RANGE = 80;    // z-dist at which turret locks on
export const ENEMY_LASER_WARN  = 1;   // seconds of warning flashes
export const ENEMY_LASER_DURATION = 0.3;

/* ── Shared materials ─────────────────────────────────────
   Cloned per-instance when fade / opacity is needed (so the
   base material here stays unchanged).  depthWrite: false on
   transparent mats prevents overlapping walls from darkening. */
export const matBody     = new THREE.MeshPhongMaterial({ color: 0x1199dd, flatShading: true });   // aircraft fuselage & wings
export const matAccent   = new THREE.MeshPhongMaterial({ color: 0x00eeff, flatShading: true });   // cockpit, fins
export const matGlow     = new THREE.MeshBasicMaterial({ color: 0x00fff7 });                      // engine glow (colour mutated per-frame to track fuel)
export const matObs      = new THREE.MeshPhongMaterial({ color: 0xddeeff, flatShading: true, transparent: true, opacity: OBS_TARGET_OPACITY, depthWrite: false }); // solid obstacles (fade-in via cloned mats)
export const matObsSolid = new THREE.MeshPhongMaterial({ color: 0xbbd8ff, flatShading: true }); // opaque walls — used for single-piece walls that never overlap
export const matFrame    = new THREE.MeshPhongMaterial({ color: 0xeef8ff, flatShading: true, transparent: true, opacity: OBS_TARGET_OPACITY, depthWrite: false }); // gate/wall frames
export const matAsteroid = new THREE.MeshPhongMaterial({ color: 0x665544, flatShading: true });   // decorative asteroids
export const matLine     = new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.3 }); // cursor guide line
export const matEnemy    = new THREE.MeshPhongMaterial({ color: 0xff3355, flatShading: true });   // enemy body
export const matEnemyGlow = new THREE.MeshBasicMaterial({ color: 0xff2222 });                     // enemy glow / booster
export const matLaser    = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.9 }); // laser beam
export const matShield   = new THREE.MeshPhongMaterial({ color: 0x33aaff, flatShading: true, transparent: true, opacity: 0.35 }); // shield pickup
