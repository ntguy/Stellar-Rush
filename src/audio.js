/* ═══════════════════════════════════════════════════════════
   AUDIO SYSTEM  —  Stellar Rush
   ═══════════════════════════════════════════════════════════ */

let ctx = null;
const buffers = {};
let engineSource = null;
let boostSource = null;

/**
 * Loads an audio file and decodes it into a buffer.
 */
async function loadBuffer(key, url) {
    try {
        const res = await fetch(url);
        const raw = await res.arrayBuffer();
        buffers[key] = await ctx.decodeAudioData(raw);
    } catch (err) {
        console.error(`Failed to load sound: ${url}`, err);
    }
}

/**
 * Initialises the audio context and loads essential sounds.
 */
export async function initAudio() {
    if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
    }

    await Promise.all([
        loadBuffer('engine',   '/src/audio/spaceship-hum-low-frequency-trimmed.mp3'),
        loadBuffer('boost',    '/src/audio/fighter-jet-taking-off-trimmed.mp3'),
        loadBuffer('collect1', '/src/audio/collect1.mp3'),
        loadBuffer('collect2', '/src/audio/collect2.mp3'),
    ]);

    startBaseEngine();
}

/**
 * Resumes the AudioContext (required by browser security policies).
 */
export function resumeAudioContext() {
    if (ctx && ctx.state === 'suspended') {
        ctx.resume();
    }
}

/**
 * Starts the constant base engine hum.
 */
export function startBaseEngine() {
    if (!buffers['engine']) return;
    
    if (engineSource) {
        try { engineSource.stop(); } catch(e) {}
    }

    engineSource = ctx.createBufferSource();
    engineSource.buffer = buffers['engine'];
    engineSource.loop = true;

    const gain = ctx.createGain();
    gain.gain.value = 0.10; 

    engineSource.connect(gain).connect(ctx.destination);
    engineSource.start();
}

/**
 * Stops all engine-related audio (used on crash).
 */
export function stopAllAudio() {
    if (engineSource) {
        try { engineSource.stop(); } catch(e) {}
        engineSource = null;
    }
    if (boostSource) {
        try { boostSource.stop(); } catch(e) {}
        boostSource = null;
    }
}

/**
 * Helper to play a one-shot sound buffer.
 */
function playOneShot(key, volume = 0.5) {
    if (!ctx || !buffers[key]) return;
    
    const src = ctx.createBufferSource();
    src.buffer = buffers[key];
    
    const gain = ctx.createGain();
    gain.gain.value = volume;
    
    src.connect(gain).connect(ctx.destination);
    src.start();
}

/**
 * Helper to start a looping sound with a gain node for control.
 */
function startLoop(key, volume = 0.5) {
    if (!ctx || !buffers[key]) return () => {};

    const src = ctx.createBufferSource();
    src.buffer = buffers[key];
    src.loop = true;

    if (key === 'boost') boostSource = src;

    const gain = ctx.createGain();
    gain.gain.value = 0; 
    gain.gain.setTargetAtTime(volume, ctx.currentTime, 0.1);

    src.connect(gain).connect(ctx.destination);
    src.start();

    return () => {
        gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
        setTimeout(() => {
            try { src.stop(); } catch (_) {}
            if (key === 'boost') boostSource = null;
        }, 200);
    };
}

/* ── One-shot sounds ──────────────────────────────────────── */

export function playLaserFire()   {}
export function playCrash()       {
    stopAllAudio();
}

/** Played when a single pickup is collected. */
export function playCollect1() {
    playOneShot('collect1', 0.2);
}

/** Played when an item in a formation is collected. */
export function playCollect2() {
    playOneShot('collect2', 0.45);
}

export function playFuelCollect()   {}
export function playPointsCollect() {}
export function playShieldCollect() {}


/* ── Looping sounds ───────────────────────────────────────── */

export function startShieldHum() {
    return () => {};
}

export function startBoostHum() {
    return startLoop('boost', 0.4);
}

export function startFuelLowBeep() {
    return () => {};
}
