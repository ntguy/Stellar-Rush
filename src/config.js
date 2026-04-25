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
export const FUEL_MAX        = 30;      // seconds
export const POWERUP_EVERY   = 10;      // seconds between fuel pickups
export const PICKUP_EVERY    = 6;       // seconds between point/shield pickups
export const PLANE_RADIUS    = 1.4;   // hatbox radius — matches fuselage body width
export const OBS_BASE_SPEED  = 45;
export const OBS_SPEED_RAMP  = 0.30;   // units/s² — reduced from 0.55 for gentler acceleration
export const OBS_TARGET_OPACITY = 0.78;
export const OBS_FADE_TIME   = 3.0;  // increased from 2.0 to fade over 4s
export const BOOST_SPEED_MULT = 1.15;   // +15 % forward speed while boosting
export const BOOST_SCORE_MULT = 1.15;   // +15 % points while boosting
export const SHIELD_DURATION  = 10;      // seconds

/* ── Safe-zone pickup placement ───────────────────────────
   Patterns generate "safe zones" — positions guaranteed to be
   clear of obstacles — so pickups never overlap walls.

   SINGLE ZONES: spots where a fuel / shield / high-value pickup
   can be placed.  Each pattern step generates up to this many:  */
export const SAFE_ZONE_SINGLES_PER_STEP = 3;   // max single-item safe spots per obstacle step
/*  Minimum clearance (world units) between a safe-zone centre
    and the nearest obstacle edge.  Larger = more breathing room.  */
export const SAFE_ZONE_MARGIN = 3.5;

/*  FORMATION ZONES: corridors where a chain of small pickups can
    be laid out.  Each pattern step generates up to this many:    */
export const SAFE_ZONE_FORMATIONS_PER_STEP = 2; // max formation corridors per obstacle step
/*  Max lateral extent (x/y) of a formation corridor.  Formations
    are clipped so they don't wander outside this radius from the
    corridor origin.                                               */
export const SAFE_ZONE_FORMATION_RADIUS = 8;

/*  How many safe zones to keep pooled before discarding old ones.
    Higher = more choices for the pickup scheduler but more memory. */
export const SAFE_ZONE_POOL_MAX = 24;

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
