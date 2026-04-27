/* ═══════════════════════════════════════════════════════════
   MENU VARIATION 1  —  "Classic Sweep"
   ═══════════════════════════════════════════════════════════ */
export function getMenuConfig() {
    return {
        name: 'Classic Sweep',

        /* ── Camera ──────────────────────────────────────────*/
        cameraStartPos:    [-40, 30, 120],
        cameraStartLookAt: [ 100,  30, -240],
        cameraEndPos:      [  0,  3,  10],
        cameraEndLookAt:   [  0,  10, -130],

        /* ── Stars ───────────────────────────────────────────*/
        starCount: 6000,
        starMoveWithCamera: true,

        /* ── Sun ─────────────────────────────────────────────*/
        sunPosition: [0, 0, -240],
        sunRadius: 60,
        sunColor: 0xffb84d,
        sunEdgeColor: 0xcc3300,
        sunGlowColor: 0xff9933,
        sunGlowScale: 1.03,
        sunIntensity: 5,

        /* ── Plane path ──────────────────────────────────────
           User-simplified 4-point arc.                       */
        planePathPoints: [
            [-240,  100, -270],
            [ -85,   20, -255],
            [ 115, -60, -208],
            [   0,   3,   0],
        ],
        planeStartScale: 0.35,
        planeEndScale: 2,
        planeFinalRotation: null,

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
