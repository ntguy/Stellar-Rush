/* ═══════════════════════════════════════════════════════════
   AUDIO SYSTEM  —  Stellar Rush
   ═══════════════════════════════════════════════════════════ */

let ctx = null;
const buffers = {};
let masterAudioGain = null;
let masterMusicGain = null;
let engineSource = null;
let boostSource = null;
let lowFuelSource = null;
let lowFuelGain = null;
let menuMusicSource = null;
let menuMusicGain = null;
let outOfFuelSource = null;
let outOfFuelGain = null;
let gameplayMusicSource = null;
let gameplayMusicGain = null;
let currentMusicTheme = null;

export function setMasterAudioVolume(val) {
    if (masterAudioGain) masterAudioGain.gain.value = val;
}

export function setMasterMusicVolume(val) {
    if (masterMusicGain) masterMusicGain.gain.value = val;
}

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
        masterAudioGain = ctx.createGain();
        masterAudioGain.connect(ctx.destination);
        masterMusicGain = ctx.createGain();
        masterMusicGain.connect(ctx.destination);
    }

    await Promise.all([
        loadBuffer('engine',     'src/audio/spaceship-hum-low-frequency.mp3'),
        loadBuffer('boost',      'src/audio/fighter-jet-taking-off-trimmed.mp3'),
        loadBuffer('collect1',   'src/audio/collect1.mp3'),
        loadBuffer('collect2',   'src/audio/collect2.mp3'),
        loadBuffer('explode',    'src/audio/explode.mp3'),
        loadBuffer('laser',      'src/audio/laser.mp3'),
        loadBuffer('warning',    'src/audio/warning.mp3'),
        loadBuffer('lowFuel',    'src/audio/LowOnFuel.mp3'),
        loadBuffer('outOfFuel',  'src/audio/OutOfFuel.mp3'),
        loadBuffer('menuMusic',  'src/audio/chillTitleMusic.mp3'),
        loadBuffer('spaceMusic', 'src/audio/SpaceMusic1'),
        loadBuffer('cloudMusic', 'src/audio/CloudsMusic1.mp3'),
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

    gain.gain.value = 0.05; 

    engineSource.connect(gain).connect(masterAudioGain);
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
    stopFuelLowBeep();
    stopMenuMusic();
    stopGameplayMusic();
}

/**
 * Helper to play a one-shot sound buffer.
 */
function playOneShot(key, volume = 0.5, playbackRate = 1.0) {
    if (!ctx || !buffers[key]) return;
    
    const src = ctx.createBufferSource();
    src.buffer = buffers[key];
    src.playbackRate.value = playbackRate;
    
    const gain = ctx.createGain();
    gain.gain.value = volume;
    
    src.connect(gain).connect(masterAudioGain);
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

    src.connect(gain).connect(masterAudioGain);
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

export function playLaserFire() {
    playOneShot('laser', 0.2);
}

export function playLaserWarning(speedMultiplier = 1.0) {
    playOneShot('warning', 0.06, speedMultiplier);
}

export function playCrash() {
    stopAllAudio();
    playOneShot('explode', 0.8);
}

export function playCollect1() {
    playOneShot('collect1', 0.4);
}

export function playCollect2() {
    playOneShot('collect2', 1);
}

export function playOutOfFuel() {
    if (!ctx || !buffers['outOfFuel']) return;
    stopOutOfFuel();

    outOfFuelSource = ctx.createBufferSource();
    outOfFuelSource.buffer = buffers['outOfFuel'];
    
    outOfFuelGain = ctx.createGain();
    outOfFuelGain.gain.value = 0.2;

    outOfFuelSource.connect(outOfFuelGain).connect(masterAudioGain);
    outOfFuelSource.start();
}

export function stopOutOfFuel() {
    if (outOfFuelSource) {
        try { outOfFuelSource.stop(); } catch(e) {}
        outOfFuelSource = null;
        outOfFuelGain = null;
    }
}

export function playFuelCollect()   {}
export function playCreditsCollect() {}
export function playShieldCollect() {}

/* ── Looping sounds ───────────────────────────────────────── */

export function startShieldHum() {
    return () => {};
}

export function startBoostHum() {
    return startLoop('boost', 0.8);
}

/**
 * Starts the low-fuel warning loop.
 */
export function startFuelLowBeep() {
    if (!ctx || !buffers['lowFuel']) return;
    
    // Stop existing
    stopFuelLowBeep();

    lowFuelSource = ctx.createBufferSource();
    lowFuelSource.buffer = buffers['lowFuel'];
    lowFuelSource.loop = true;

    lowFuelGain = ctx.createGain();
    lowFuelGain.gain.value = 0; 

    lowFuelSource.connect(lowFuelGain).connect(masterAudioGain);
    lowFuelSource.start();
}

/**
 * Updates the low-fuel warning volume.
 * @param {number} volume - Volume (0 to 1).
 */
export function setLowFuelVolume(volume) {
    if (lowFuelGain) {
        lowFuelGain.gain.setTargetAtTime(volume, ctx.currentTime, 0.1);
    }
}

/**
 * Stops the low-fuel warning.
 */
export function stopFuelLowBeep() {
    if (lowFuelSource) {
        try { lowFuelSource.stop(); } catch(e) {}
        lowFuelSource = null;
        lowFuelGain = null;
    }
}

/**
 * Starts the menu music with a fade-in.
 */
export function startMenuMusic() {
    if (!ctx || !buffers['menuMusic'] || menuMusicSource) return;

    menuMusicSource = ctx.createBufferSource();
    menuMusicSource.buffer = buffers['menuMusic'];
    menuMusicSource.loop = true;

    menuMusicGain = ctx.createGain();
    menuMusicGain.gain.value = 0.4;
    
    menuMusicSource.connect(menuMusicGain).connect(masterMusicGain);
    menuMusicSource.start();
}

/**
 * Stops the menu music with a fade-out.
 */
export function stopMenuMusic() {
    if (!menuMusicSource) return;

    const source = menuMusicSource;
    const gain = menuMusicGain;
    
    menuMusicSource = null;
    menuMusicGain = null;

    if (gain) {
        gain.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
    }
    
    setTimeout(() => {
        try { source.stop(); } catch(e) {}
    }, 1000);
}

/**
 * Crossfades to a new gameplay music theme ('world1' or 'world2').
 */
export function crossfadeMusicTheme(theme) {
    if (currentMusicTheme === theme) return;
    currentMusicTheme = theme;
    
    // fade out old
    if (gameplayMusicSource) {
        const oldGain = gameplayMusicGain;
        const oldSource = gameplayMusicSource;
        if (oldGain) {
            oldGain.gain.setTargetAtTime(0, ctx.currentTime, 1.0);
            setTimeout(() => {
                try { oldSource.stop(); } catch(e) {}
            }, 3000);
        }
    }

    if (!theme) {
        gameplayMusicSource = null;
        gameplayMusicGain = null;
        return;
    }

    const key = theme === 'world1' ? 'spaceMusic' : 'cloudMusic';
    if (!ctx || !buffers[key]) return;

    const source = ctx.createBufferSource();
    source.buffer = buffers[key];
    source.loop = false;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    const targetVol = theme === 'world2' ? 0.2 : 0.25;
    gain.gain.setTargetAtTime(targetVol, ctx.currentTime, 1.0); // fade in to targetVol

    source.connect(gain).connect(masterMusicGain);
    source.start();

    gameplayMusicSource = source;
    gameplayMusicGain = gain;
}

export function stopGameplayMusic() {
    crossfadeMusicTheme(null);
}
