/* ═══════════════════════════════════════════════════════════
   MENU.JS  —  Stellar Rush Main Menu
   ═══════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { makeAircraft } from './aircraft.js';
import { buildStarField } from './stars.js';

function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/* ═══════════════════════════════════════════════════════════
   SPEED CURVE  (smooth sigmoid ramp, no abrupt step)
   boostStart: path-u where acceleration begins
   boostPeak:  path-u where peak speed is reached (smooth ramp between)
   boostEnd:   path-u where speed stays at peak until end
   boostAmount: peak speed multiplier (1.0 = unchanged)
   ═══════════════════════════════════════════════════════════ */
function buildSpeedCurve(boostStart, boostPeak, boostEnd, boostAmount) {
    const N = 4000;
    const cumulative = new Float32Array(N + 1);
    cumulative[0] = 0;
    for (let i = 0; i < N; i++) {
        const u = i / N;
        let speed;
        if (u <= boostStart) {
            speed = 1.0;                                        // pre-boost: normal
        } else if (u <= boostPeak) {
            // Smooth ramp-up using smoothstep
            const t = (u - boostStart) / (boostPeak - boostStart);
            const s = t * t * (3.0 - 2.0 * t);                // smoothstep [0→1]
            speed = 1.0 + (boostAmount - 1.0) * s;
        } else if (u <= boostEnd) {
            speed = boostAmount;                                // sustained peak
        } else {
            // Slight ease near the very end so freeze isn't jarring
            const t = (u - boostEnd) / (1.0 - boostEnd);
            const s = t * t * (3.0 - 2.0 * t);
            speed = boostAmount * (1.0 - s * 0.2);             // gently tapers 100%→80%
        }
        cumulative[i + 1] = cumulative[i] + speed;
    }
    const total = cumulative[N];
    for (let i = 0; i <= N; i++) cumulative[i] /= total;
    return function pathTFromElapsed(elapsed) {
        let lo = 0, hi = N;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (cumulative[mid] < elapsed) lo = mid + 1; else hi = mid; }
        const idx = Math.max(0, lo - 1);
        const frac = (elapsed - cumulative[idx]) / Math.max(1e-9, cumulative[idx + 1] - cumulative[idx]);
        return Math.min(1, (idx + frac) / N);
    };
}

/* ═══════════════════════════════════════════════════════════
   SUN  (procedural fire core + tight glowing corona)
   ═══════════════════════════════════════════════════════════ */
function createSun(cfg) {
    const group = new THREE.Group();

    const coreMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime:   { value: 0 },
            uColor1: { value: new THREE.Color(0xffffff) },
            uColor2: { value: new THREE.Color(cfg.sunColor) },
            uColor3: { value: new THREE.Color(cfg.sunEdgeColor) },
        },
        vertexShader: `
            varying vec3 vNormal, vPos, vViewDir;
            void main(){
                vNormal = normalize(normalMatrix * normal); vPos = position;
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                vViewDir = normalize(-mv.xyz); gl_Position = projectionMatrix * mv;
            }`,
        fragmentShader: `
            uniform float uTime; uniform vec3 uColor1, uColor2, uColor3;
            varying vec3 vNormal, vPos, vViewDir;
            float hash(vec3 p){ p=fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
            float noise(vec3 p){ vec3 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
                return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                    mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
            float fbm(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){v+=a*noise(p);p*=2.0;a*=0.5;} return v; }
            void main(){
                vec3 n=normalize(vNormal);
                float turb=fbm(n*4.0+uTime*vec3(0.3,0.2,0.15));
                float fresnel=1.0-abs(dot(n,normalize(vViewDir)));
                float fire=turb*0.7+fresnel*0.3;
                vec3 col=mix(uColor1, uColor2, smoothstep(0.0, 0.5, fire));
                col=mix(col, uColor3, smoothstep(0.4, 0.9, fire));
                col=mix(col, uColor1, smoothstep(0.55, 0.7, turb)*0.3);
                gl_FragColor=vec4(col,1.0);
            }`,
    });
    group.add(new THREE.Mesh(new THREE.SphereGeometry(cfg.sunRadius, 48, 48), coreMat));

    // Tight glowing corona — low opacity but bright/saturated color, steep falloff
    const glowMat = new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: new THREE.Color(cfg.sunGlowColor) },
            uTime:  { value: 0 },
        },
        vertexShader: `
            varying vec3 vNormal, vViewDir;
            void main(){
                vNormal=normalize(normalMatrix*normal);
                vec4 mv=modelViewMatrix*vec4(position,1.0);
                vViewDir=normalize(-mv.xyz); gl_Position=projectionMatrix*mv;
            }`,
        fragmentShader: `
            uniform vec3 uColor; uniform float uTime;
            varying vec3 vNormal, vViewDir;
            void main(){
                float f=1.0-abs(dot(vNormal,vViewDir));
                f=pow(f, 3.0);               // Wider glow (was 5.0)
                float pulse=0.85+0.15*sin(uTime*1.8);
                // Increased brightness and opacity for a much stronger glow
                gl_FragColor=vec4(uColor * 2.8 * pulse, f * 0.9);
            }`,
        transparent: true, blending: THREE.AdditiveBlending,
        side: THREE.FrontSide, depthWrite: false,
    });
    group.add(new THREE.Mesh(new THREE.SphereGeometry(cfg.sunRadius * cfg.sunGlowScale, 48, 48), glowMat));

    group.add(new THREE.PointLight(cfg.sunColor, cfg.sunIntensity, 900));
    group.position.set(...cfg.sunPosition);
    return { group, glowMat, coreMat };
}

/* ═══════════════════════════════════════════════════════════
   TRAIL  (tube with decay window)
   ═══════════════════════════════════════════════════════════ */
function createTrail(path, cfg) {
    const vert = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
    const frag = `
        uniform float uProgress,uDecay,uOpacity; uniform vec3 uColor;
        varying vec2 vUv;
        void main(){
            float along=vUv.x; if(along>uProgress) discard;
            float d=uProgress-along; if(d>uDecay) discard;
            float alpha=pow(1.0-d/uDecay,0.7)*uOpacity;
            alpha+=smoothstep(uDecay*0.25,0.0,d)*0.3;
            gl_FragColor=vec4(uColor,alpha);
        }`;
    const makeTube = (radius, color, opacity) => {
        const geo = new THREE.TubeGeometry(path, cfg.trailSegments, radius, 8, false);
        const mat = new THREE.ShaderMaterial({
            uniforms: { uProgress:{value:0}, uDecay:{value:cfg.trailDecay}, uColor:{value:new THREE.Color(color)}, uOpacity:{value:opacity} },
            vertexShader:vert, fragmentShader:frag,
            transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide,
        });
        return new THREE.Mesh(geo, mat);
    };
    const tube = makeTube(cfg.trailRadius, cfg.trailColor, cfg.trailOpacity);
    const glow = makeTube(cfg.trailGlowRadius, cfg.trailGlowColor, cfg.trailGlowOpacity);
    return { tube, glow, setProgress(t){ tube.material.uniforms.uProgress.value=t; glow.material.uniforms.uProgress.value=t; } };
}

/* ═══════════════════════════════════════════════════════════
   ASTEROID BELT  (small rocks crossing the top of the sun)
   ═══════════════════════════════════════════════════════════ */
function createAsteroidBelt(scene, sunPos, sunRadius) {
    const meshes = [];
    const count = 100;
    // Belt arc: sweeping across the top-ish of the sun, in front of it (slightly less negative Z)
    const beltZ = sunPos[2] + sunRadius * 0.5;   // in front of the sun sphere

    for (let i = 0; i < count; i++) {
        const angle = (Math.random() - 0.5) * Math.PI * 0.9;  // spread across ~160° arc
        const dist  = sunRadius * (0.85 + Math.random() * 0.5); // ring radius relative to sun

        // Belt in the X-Y plane around the sun center, focused near the top
        const beltAngleOffset = Math.PI * 0.5;  // offset to aim at top of sun
        const a = angle + beltAngleOffset;

        const x = sunPos[0] + Math.cos(a) * dist;
        const y = sunPos[1] + Math.sin(a) * dist * 0.4;  // flatten vertically
        const z = beltZ + (Math.random() - 0.5) * sunRadius * 0.4;

        // Small rocks: radius 0.5–3 world units
        const r = 0.5 + Math.random() * 2.5;
        const geo = new THREE.IcosahedronGeometry(r, 0);
        const mat = new THREE.MeshPhongMaterial({
            color: 0x776655, flatShading: true,
            transparent: true, opacity: 0.55 + Math.random() * 0.35,
        });
        const m = new THREE.Mesh(geo, mat);
        m.scale.set(
            0.5 + Math.random() * 0.8,
            0.5 + Math.random() * 0.8,
            0.5 + Math.random() * 0.8,
        );
        m.position.set(x, y, z);
        m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        scene.add(m);
        meshes.push(m);
    }
    return meshes;
}

/* ═══════════════════════════════════════════════════════════
   JET AUDIO  (starts 4s in, fades in, fades out at freeze)
   ═══════════════════════════════════════════════════════════ */
let _menuAudioCtx = null;
let _menuJetSource = null;
let _menuJetGain = null;
let _jetBuf = null;          // cached decoded buffer
let _jetScheduled = false;

async function loadJetBuffer() {
    try {
        if (!_menuAudioCtx) _menuAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (_jetBuf) return _jetBuf;
        const res = await fetch('/src/audio/fighter-jet-taking-off-trimmed.mp3');
        const raw = await res.arrayBuffer();
        _jetBuf = await _menuAudioCtx.decodeAudioData(raw);
        return _jetBuf;
    } catch (e) { console.warn('Jet buffer load failed:', e); return null; }
}

async function scheduleMenuJet(startDelay, fadeDuration) {
    // Pre-load the buffer as soon as possible
    await loadJetBuffer();
}

function playMenuJet(fadeDuration) {
    if (!_menuAudioCtx || !_jetBuf || _menuJetSource) return;
    try {
        if (_menuAudioCtx.state === 'suspended') _menuAudioCtx.resume();

        _menuJetSource = _menuAudioCtx.createBufferSource();
        _menuJetSource.buffer = _jetBuf;
        _menuJetSource.loop = true;
        _menuJetSource.playbackRate.value = 0.85;

        _menuJetGain = _menuAudioCtx.createGain();
        _menuJetGain.gain.value = 0;
        // Fade in over fadeDuration seconds (ramps up to 0.35)
        _menuJetGain.gain.linearRampToValueAtTime(0.35, _menuAudioCtx.currentTime + fadeDuration);

        _menuJetSource.connect(_menuJetGain).connect(_menuAudioCtx.destination);
        _menuJetSource.start();
    } catch (e) { console.warn('Menu jet play failed:', e); }
}

function fadeOutMenuJet(duration = 0.6) {
    if (_menuJetGain && _menuAudioCtx) {
        _menuJetGain.gain.setTargetAtTime(0, _menuAudioCtx.currentTime, duration * 0.4);
    }
    setTimeout(() => {
        try { _menuJetSource?.stop(); } catch (_) {}
        _menuJetSource = null; _menuJetGain = null;
    }, duration * 1000 + 200);
}

function stopMenuJet() {
    try { _menuJetSource?.stop(); } catch (_) {}
    _menuJetSource = null; _menuJetGain = null; _jetScheduled = false;
}

/* ═══════════════════════════════════════════════════════════
   TITLE STYLE
   ═══════════════════════════════════════════════════════════ */
function applyTitleStyle(cfg) {
    const stellar = document.getElementById('title-stellar');
    const rush    = document.getElementById('title-rush');
    if (!stellar || !rush) return;
    const s = { fontFamily: cfg.titleFont, color: cfg.titleColor, textShadow: cfg.titleGlow, letterSpacing: cfg.titleLetterSpacing };
    Object.assign(stellar.style, s); stellar.style.fontSize = cfg.stellarSize;
    Object.assign(rush.style,    s); rush.style.fontSize    = cfg.rushSize;
}

/* ═══════════════════════════════════════════════════════════
   MENU CONTROLLER
   ═══════════════════════════════════════════════════════════ */
const ANIM_DURATION = 10;
const JET_START_DELAY = 1.5;    // seconds after animation start
const JET_FADE_IN  = 7.0;       // fade in over the remaining animation time
const JET_FADE_OUT = 0.0;       // 0 = hard stop

export function createMenu(scene, camera, cfg) {
    const tracked = [];
    const track = obj => { tracked.push(obj); return obj; };

    /* Lights */
    scene.add(track(new THREE.AmbientLight(0x182848, 1.2)));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8); dir.position.set(5, 15, 10); scene.add(track(dir));

    /* Stars — synced to camera each frame to eliminate parallax */
    const { mesh: starMesh, material: starMat, syncToCamera } = buildStarField(
        cfg.starCount, undefined, cfg.starMoveWithCamera ?? false
    );
    scene.add(track(starMesh));
    // Sync position immediately so stars are visible from frame 1
    if (cfg.starMoveWithCamera) syncToCamera(camera);

    /* Sun */
    const sun = createSun(cfg); scene.add(track(sun.group));

    /* Asteroid belt across the top of the sun — denser */
    const beltMeshes = createAsteroidBelt(scene, cfg.sunPosition, cfg.sunRadius * 1.15);
    beltMeshes.forEach(m => tracked.push(m));

    /* Aircraft */
    const plane = makeAircraft();
    plane.scale.setScalar(cfg.planeStartScale);
    scene.add(track(plane));

    /* Path */
    const pathPts = cfg.planePathPoints.map(p => new THREE.Vector3(...p));
    const path = new THREE.CatmullRomCurve3(pathPts, false, 'catmullrom', 0.5);

    /* Speed curve */
    const getPathT = buildSpeedCurve(
        cfg.speedBoostStart  ?? 0.25,
        cfg.speedBoostPeak   ?? 0.55,
        cfg.speedBoostEnd    ?? 0.90,
        cfg.speedBoostAmount ?? 1.6,
    );

    /* Trail */
    const trail = createTrail(path, cfg);
    scene.add(track(trail.tube)); scene.add(track(trail.glow));

    /* Background asteroids — 28, varied sizes, deep field */
    const astGeo = new THREE.IcosahedronGeometry(1, 0);
    for (let i = 0; i < 28; i++) {
        const r = 3 + Math.random() * 18;
        const mat = new THREE.MeshPhongMaterial({ color: 0x554433, flatShading: true, transparent: true, opacity: 0.28 + Math.random() * 0.3 });
        const m = new THREE.Mesh(astGeo, mat);
        m.scale.set(
            r * (0.6 + Math.random() * 0.8),
            r * (0.6 + Math.random() * 0.8),
            r * (0.6 + Math.random() * 0.8),
        );
        m.position.set((Math.random() - 0.5) * 550, (Math.random() - 0.5) * 280, -160 - Math.random() * 380);
        m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        scene.add(track(m));
    }

    /* Foreground asteroids — smaller, closer to camera, scattered widely */
    for (let i = 0; i < 35; i++) {
        const r = 0.3 + Math.random() * 1.8;   // tiny rocks
        const mat = new THREE.MeshPhongMaterial({ color: 0x665544, flatShading: true, transparent: true, opacity: 0.4 + Math.random() * 0.4 });
        const m = new THREE.Mesh(astGeo, mat);
        m.scale.set(
            r * (0.5 + Math.random() * 1.0),
            r * (0.5 + Math.random() * 1.0),
            r * (0.5 + Math.random() * 1.0),
        );
        // Spread across the view, z between -50 and -150 (closer to camera)
        m.position.set(
            (Math.random() - 0.5) * 200,
            (Math.random() - 0.5) * 120,
            -50 - Math.random() * 100,
        );
        m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        scene.add(track(m));
    }

    applyTitleStyle(cfg);
    const playBtn = document.getElementById('play-btn');
    const menuEl  = document.getElementById('main-menu');
    if (playBtn) { playBtn.className = 'menu-btn-base'; playBtn.classList.add('align-' + cfg.playButtonAlign); }

    /* Camera */
    const camStart  = new THREE.Vector3(...cfg.cameraStartPos);
    const camEnd    = new THREE.Vector3(...cfg.cameraEndPos);
    const lookStart = new THREE.Vector3(...cfg.cameraStartLookAt);
    const lookEnd   = new THREE.Vector3(...cfg.cameraEndLookAt);
    camera.position.copy(camStart);
    camera.lookAt(lookStart);

    /* Distance-based scale reference points */
    const camEndVec = new THREE.Vector3(...cfg.cameraEndPos);

    // Compute path total length to determine start/end distances
    const pathStart3D = new THREE.Vector3(...cfg.planePathPoints[0]);
    const pathEnd3D   = new THREE.Vector3(...cfg.planePathPoints[cfg.planePathPoints.length - 1]);
    const distAtStart = pathStart3D.distanceTo(camEndVec);
    const distAtEnd   = pathEnd3D.distanceTo(camEndVec);   // ≈ 0 at camera

    let elapsed = 0, animDone = false, onPlayCb = null;
    let jetStarted = false;
    const tmpLook = new THREE.Vector3();

    /* Freeze state */
    const frozenPos  = new THREE.Vector3();
    const frozenQuat = new THREE.Quaternion();
    let frozenScale  = 1;

    function showUI() { if (menuEl) menuEl.style.display = 'flex'; }
    function hideUI() {
        if (menuEl) menuEl.style.display = 'none';
        const tc = document.getElementById('title-container');
        if (tc) tc.classList.remove('visible','anim-slide-glow','anim-glitch','anim-typewriter');
        if (playBtn) playBtn.classList.remove('visible');
    }

    function _onPlayClick() { if (onPlayCb) onPlayCb(); }
    if (playBtn) playBtn.addEventListener('click', _onPlayClick);

    // Pre-load jet buffer immediately (no autoplay yet)
    const onInteractLoad = () => {
        loadJetBuffer();
        window.removeEventListener('mousedown', onInteractLoad);
        window.removeEventListener('keydown', onInteractLoad);
    };
    loadJetBuffer(); // attempt immediately; browser may allow it
    window.addEventListener('mousedown', onInteractLoad, { once: true });
    window.addEventListener('keydown', onInteractLoad, { once: true });

    function update(dt) {
        elapsed += dt;
        const rawElapsed = Math.min(elapsed / ANIM_DURATION, 1);

        /* ── Jet audio: starts at JET_START_DELAY, fades in ─── */
        if (!jetStarted && elapsed >= JET_START_DELAY) {
            jetStarted = true;
            playMenuJet(JET_FADE_IN);
        }

        /* ── Camera: linear sweep so it keeps moving until t=1 ── */
        // Using rawElapsed directly (no ease-out) so the camera
        // never appears to stop before the animation ends.
        camera.position.lerpVectors(camStart, camEnd, rawElapsed);
        tmpLook.lerpVectors(lookStart, lookEnd, rawElapsed);
        camera.lookAt(tmpLook);

        /* ── Plane: non-uniform speed, distance-based scale ─ */
        if (!animDone) {
            const pathT    = getPathT(rawElapsed);
            const clampedT = Math.min(pathT, 0.9999);

            const pos = path.getPointAt(clampedT);
            const tan = path.getTangentAt(clampedT);

            plane.position.copy(pos);
            plane.lookAt(pos.clone().sub(tan.clone().multiplyScalar(3)));

            // Perspective scale: 1/5 at far end → full size at camera.
            const curDist   = pos.distanceTo(camera.position);
            const dMin = Math.max(distAtEnd, 5);
            const dMax = distAtStart;
            const dFrac = THREE.MathUtils.clamp((curDist - dMin) / (dMax - dMin), 0, 1);
            // dFrac=1 when far (1/5 size), dFrac=0 when close (full size)
            const perspScale = THREE.MathUtils.lerp(cfg.planeEndScale, cfg.planeEndScale / 5.0, dFrac);
            plane.scale.setScalar(perspScale);

            if (plane.userData.glow) plane.userData.glow.scale.setScalar(1.2 + Math.sin(elapsed * 8) * 0.3);

            trail.setProgress(clampedT);

            frozenPos.copy(plane.position);
            frozenQuat.copy(plane.quaternion);
            frozenScale = plane.scale.x;
        } else {
            plane.position.copy(frozenPos);
            plane.quaternion.copy(frozenQuat);
            plane.scale.setScalar(frozenScale);
        }

        sun.coreMat.uniforms.uTime.value = elapsed;
        sun.glowMat.uniforms.uTime.value = elapsed;
        starMat.uniforms.uTime.value = elapsed;
        if (cfg.starMoveWithCamera) syncToCamera(camera);

        /* ── Animation complete ──────────────────────────── */
        if (rawElapsed >= 1 && !animDone) {
            animDone = true;
            // Hard stop: cut jet immediately
            if (JET_FADE_OUT === 0) {
                stopMenuJet();
            } else {
                fadeOutMenuJet(JET_FADE_OUT);
            }
            const tc = document.getElementById('title-container');
            if (tc) { tc.classList.add('visible'); tc.classList.add('anim-' + cfg.titleAnimation); }
            setTimeout(() => { if (playBtn) playBtn.classList.add('visible'); }, 600);
        }
    }

    function dispose() {
        if (playBtn) playBtn.removeEventListener('click', _onPlayClick);
        hideUI();
        stopMenuJet();
        for (const obj of tracked) {
            scene.remove(obj);
            if (obj.traverse) obj.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material?.dispose) c.material.dispose(); });
            else { if (obj.geometry) obj.geometry.dispose(); if (obj.material?.dispose) obj.material.dispose(); }
        }
        tracked.length = 0;
    }

    showUI();
    return {
        update,
        dispose,
        onPlay(cb) { onPlayCb = cb; },
    };
}
