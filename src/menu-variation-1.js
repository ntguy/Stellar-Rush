/* ═══════════════════════════════════════════════════════════
   MENU VARIATION 1  —  "Classic Sweep"
   ═══════════════════════════════════════════════════════════ */
export function getMenuConfig() {
    return {
        name: 'Classic Sweep',

        /* ── Camera ──────────────────────────────────────────
           Very exaggerated start: camera far left, looking
           toward the right where the sun sits. Sweeps linearly
           to center so the camera keeps moving until t=1.     */
        cameraStartPos:    [-90, 38, 65],
        cameraStartLookAt: [ 55,  2, -240],   // aim toward sun on the right
        cameraEndPos:      [  0,  3,  52],
        cameraEndLookAt:   [  0,  0, -130],

        /* ── Stars — camera-synced, lots of them ─────────── */
        starCount: 5000,
        starMoveWithCamera: true,

        /* ── Sun ─────────────────────────────────────────────*/
        sunPosition: [0, 0, -240],
        sunRadius: 60,
        sunColor: 0xffb84d,
        sunEdgeColor: 0xcc3300,
        sunGlowColor: 0xff9933,
        sunGlowScale: 1.14,
        sunIntensity: 5,

        /* ── Plane path ──────────────────────────────────────
           Wide orbit, post-crest dives hard toward camera.    */
        planePathPoints: [
            [-230,  22, -270],
            [ -85,   5, -255],
            [ 105, -42, -238],
            [  62,  -4, -158],
            [  16,   2,  -40],
            [   0,   3,   38],
        ],
        planeStartScale: 0.35,
        planeEndScale: 2.8,
        planeFinalRotation: null,

        /* ── Speed curve ─────────────────────────────────────
           Smooth sigmoid ramp:
           - Normal until 0.20 (pre-crest coasting)
           - Smoothly ramps up to peak by 0.55 (cresting phase)
           - Sustained peak until 0.92
           boostAmount 1.8 = 80% faster at peak              */
        speedBoostStart:  0.20,
        speedBoostPeak:   0.55,
        speedBoostEnd:    0.92,
        speedBoostAmount: 1.8,

        /* ── Trail ───────────────────────────────────────────*/
        trailColor: 0x0088ff,
        trailGlowColor: 0x00ccff,
        trailRadius: 0.22,
        trailGlowRadius: 0.65,
        trailOpacity: 0.92,
        trailGlowOpacity: 0.25,
        trailDecay: 0.18,
        trailSegments: 320,

        /* ── Title style ─────────────────────────────────────*/
        titleFont: "'Orbitron', sans-serif",
        titleAnimation: 'slide-glow',
        stellarSize: '86px',
        rushSize: '86px',
        titleColor: '#ffffff',
        titleGlow: '0 0 40px #00aaff, 0 0 80px #0066cc, 0 0 120px #003388',
        titleLetterSpacing: '18px',

        /* ── Play button ─────────────────────────────────────*/
        playButtonAlign: 'far-left',
    };
}
