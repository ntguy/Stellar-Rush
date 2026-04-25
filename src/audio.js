/* ═══════════════════════════════════════════════════════════
   AUDIO SYSTEM  —  Stellar Rush
   ─────────────────────────────────────────────────────────
   All functions are stubs. To wire up real sounds:
     1. Add audio files to /assets/sounds/ (ogg + mp3 pairs)
     2. Initialise AudioContext below and load buffers
     3. Implement each stub
     4. Remove "TODO: SOUND" markers
   ═══════════════════════════════════════════════════════════ */

// TODO: SOUND — Initialise AudioContext and load sound buffers here.
// Example approach (Web Audio API):
//
//   const ctx = new AudioContext();
//   const buffers = {};
//
//   async function loadBuffer(key, url) {
//       const res = await fetch(url);
//       const raw = await res.arrayBuffer();
//       buffers[key] = await ctx.decodeAudioData(raw);
//   }
//
//   export async function initAudio() {
//       await Promise.all([
//           loadBuffer('laserFire',      '/assets/sounds/laser_fire.ogg'),
//           loadBuffer('crash',          '/assets/sounds/crash.ogg'),
//           loadBuffer('fuelCollect',    '/assets/sounds/fuel_collect.ogg'),
//           loadBuffer('pointsCollect',  '/assets/sounds/points_collect.ogg'),
//           loadBuffer('shieldCollect',  '/assets/sounds/shield_collect.ogg'),
//           loadBuffer('shieldHum',      '/assets/sounds/shield_hum.ogg'),
//           loadBuffer('boostHum',       '/assets/sounds/boost_hum.ogg'),
//           loadBuffer('fuelLowBeep',    '/assets/sounds/fuel_low_beep.ogg'),
//       ]);
//   }
//
// Helper to play a one-shot buffer:
//   function playOneShot(key, volume = 1) {
//       const src = ctx.createBufferSource();
//       src.buffer = buffers[key];
//       const gain = ctx.createGain();
//       gain.gain.value = volume;
//       src.connect(gain).connect(ctx.destination);
//       src.start();
//   }
//
// Helper to start a looping buffer (returns stop function):
//   function startLoop(key, volume = 0.5) {
//       const src = ctx.createBufferSource();
//       src.buffer = buffers[key];
//       src.loop = true;
//       const gain = ctx.createGain();
//       gain.gain.value = volume;
//       src.connect(gain).connect(ctx.destination);
//       src.start();
//       return () => { try { src.stop(); } catch (_) {} };
//   }

/* ── One-shot sounds ──────────────────────────────────────── */

/** Played when a laser turret fires its beam. */
export function playLaserFire() {
    // TODO: SOUND — playOneShot('laserFire', 0.8);
}

/** Played when the player collides with an obstacle or enemy. */
export function playCrash() {
    // TODO: SOUND — playOneShot('crash', 1.0);
}

/** Played when the player collects a fuel pickup. */
export function playFuelCollect() {
    // TODO: SOUND — playOneShot('fuelCollect', 0.9);
}

/** Played when the player collects a points pickup. */
export function playPointsCollect() {
    // TODO: SOUND — playOneShot('pointsCollect', 0.7);
}

/** Played when the player collects a shield pickup. */
export function playShieldCollect() {
    // TODO: SOUND — playOneShot('shieldCollect', 0.9);
}

/* ── Looping sounds — each returns a stop() function ─────── */

/**
 * Starts the shield hum loop (active while shielded).
 * @returns {() => void} Call to stop the sound.
 */
export function startShieldHum() {
    // TODO: SOUND — return startLoop('shieldHum', 0.4);
    return () => {};
}

/**
 * Starts the boost engine hum loop (active while boosting).
 * @returns {() => void} Call to stop the sound.
 */
export function startBoostHum() {
    // TODO: SOUND — return startLoop('boostHum', 0.6);
    return () => {};
}

/**
 * Starts the low-fuel warning beep loop (fuel < 20%).
 * @returns {() => void} Call to stop the sound.
 */
export function startFuelLowBeep() {
    // TODO: SOUND — return startLoop('fuelLowBeep', 0.5);
    return () => {};
}
