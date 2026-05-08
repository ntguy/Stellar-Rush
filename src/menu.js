/* ═══════════════════════════════════════════════════════════
   MENU.JS  —  Stellar Rush Main Menu
   ═══════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { makeAircraft } from './aircraft.js';
import { buildStarField } from './stars.js';
import { inputManager } from './inputManager.js';

/* ═══════════════════════════════════════════════════════════
   SUN  (solid fire core + glowing corona)
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
        transparent: false,
        depthWrite: true,
    });
    group.add(new THREE.Mesh(new THREE.SphereGeometry(cfg.sunRadius, 48, 48), coreMat));

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
                f=pow(f, 3.0);
                float pulse=0.85+0.15*sin(uTime*1.8);
                gl_FragColor=vec4(uColor * 2.8 * pulse, f * 0.9);
            }`,
        transparent: true, blending: THREE.AdditiveBlending,
        side: THREE.FrontSide, depthWrite: false,
    });
    group.add(new THREE.Mesh(new THREE.SphereGeometry(cfg.sunRadius * cfg.sunGlowScale, 48, 48), glowMat));

    const flareGeo = new THREE.BufferGeometry();
    const flareCount = 20;
    const flarePos = new Float32Array(flareCount * 3);
    const flareData = new Float32Array(flareCount * 3);
    for(let i=0; i<flareCount; i++) {
        const u = Math.random(), v = Math.random();
        const theta = 2 * Math.PI * u, phi = Math.acos(2 * v - 1);
        flarePos[i*3] = Math.sin(phi) * Math.cos(theta) * cfg.sunRadius;
        flarePos[i*3+1] = Math.sin(phi) * Math.sin(theta) * cfg.sunRadius;
        flarePos[i*3+2] = Math.cos(phi) * cfg.sunRadius;
        flareData[i*3] = Math.random() * Math.PI * 2;
        flareData[i*3+1] = 0.5 + Math.random();
        flareData[i*3+2] = 2.0 + Math.random() * 6.0;
    }
    flareGeo.setAttribute('position', new THREE.BufferAttribute(flarePos, 3));
    flareGeo.setAttribute('aData', new THREE.BufferAttribute(flareData, 3));
    const flareMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(cfg.sunColor) } },
        vertexShader: `
            uniform float uTime;
            attribute vec3 aData;
            varying float vAlpha;
            void main() {
                vec3 n = normalize(position);
                float t = fract(uTime * 0.1 * aData.y + aData.x);
                vec3 pos = position + n * (t * aData.z);
                vAlpha = sin(t * 3.14159) * (1.0 - t);
                vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                gl_PointSize = (3500.0 / -mvPosition.z);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            varying float vAlpha;
            void main() {
                float d = length(gl_PointCoord - vec2(0.5));
                if(d > 0.5) discard;
                gl_FragColor = vec4(uColor * 2.5, (0.5 - d) * 2.0 * vAlpha);
            }
        `,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    });
    group.add(new THREE.Points(flareGeo, flareMat));

    group.add(new THREE.PointLight(cfg.sunColor, cfg.sunIntensity, 900));
    group.position.set(...cfg.sunPosition);
    return { group, glowMat, coreMat, flareMat };
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
            
            vec3 bluePulse = mix(uColor, vec3(0.5, 0.8, 1.0), sin(along * 35.0)*0.5+0.5);
            vec3 finalColor = mix(bluePulse, vec3(1.0, 1.0, 1.0), smoothstep(uDecay*0.15, 0.0, d));
            
            alpha+=smoothstep(uDecay*0.25,0.0,d)*0.5;
            gl_FragColor=vec4(finalColor,alpha);
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
   ASTEROID BELT  (One single belt, further away)
   ═══════════════════════════════════════════════════════════ */
function createAsteroidBelt(scene, sunPos, sunRadius) {
    const meshes = [];
    const count = 150;
    // Belt is further away from the sun surface
    const beltZ = sunPos[2] + sunRadius * 1.6;

    for (let i = 0; i < count; i++) {
        const angle = (Math.random() - 0.25) * Math.PI * 1.4;
        const dist  = sunRadius * (1.6 + Math.random() * 1.1);
        const a = angle + Math.PI * 0.5;
        const x = sunPos[0] + Math.cos(a) * dist;
        const y = sunPos[1] + Math.sin(a) * dist * 0.7; // Increased Y-spacing by 40%
        const z = beltZ + (Math.random() - 0.5) * sunRadius * 1.4;
        const r = 1 + Math.random() * 3;
        const geo = new THREE.IcosahedronGeometry(r, 0);
        const mat = new THREE.MeshPhongMaterial({ color: 0x554433, flatShading: true });
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        scene.add(m);
        meshes.push(m);
    }
    return meshes;
}

/* ═══════════════════════════════════════════════════════════
   JET AUDIO
   ═══════════════════════════════════════════════════════════ */
let _menuAudioCtx = null, _menuJetSource = null, _menuJetGain = null, _jetBuf = null;

async function loadJetBuffer() {
    if (_jetBuf) return _jetBuf;
    if (!_menuAudioCtx) {
        _menuAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        // Resume on interaction
        inputManager.on('onAnyInput', () => { 
            if (_menuAudioCtx && _menuAudioCtx.state === 'suspended') {
                _menuAudioCtx.resume(); 
            }
        });
    }
    const res = await fetch('src/audio/fighter-jet-taking-off-trimmed.mp3');
    const raw = await res.arrayBuffer();
    _jetBuf = await _menuAudioCtx.decodeAudioData(raw);
    return _jetBuf;
}

function playMenuJet(fadeDuration) {
    if (!_menuAudioCtx || !_jetBuf || _menuJetSource) return;
    if (_menuAudioCtx.state === 'suspended') _menuAudioCtx.resume();
    _menuJetSource = _menuAudioCtx.createBufferSource();
    _menuJetSource.buffer = _jetBuf;
    _menuJetSource.loop = true;
    _menuJetSource.playbackRate.value = 0.85;
    _menuJetGain = _menuAudioCtx.createGain();
    _menuJetGain.gain.value = 0.0001;
    _menuJetGain.gain.exponentialRampToValueAtTime(0.95, _menuAudioCtx.currentTime + fadeDuration);
    _menuJetSource.connect(_menuJetGain).connect(_menuAudioCtx.destination);
    _menuJetSource.start();
}

function stopMenuJet() {
    try { _menuJetSource?.stop(); } catch (_) {}
    _menuJetSource = null; _menuJetGain = null;
}

/* ═══════════════════════════════════════════════════════════
   TITLE STYLE
   ═══════════════════════════════════════════════════════════ */
function applyTitleStyle(cfg) {
    const stellar = document.getElementById('title-stellar');
    const rush    = document.getElementById('title-rush');
    if (!stellar || !rush) return;
    const s = { 
        fontFamily: cfg.titleFont || "'Orbitron', sans-serif", 
        color: cfg.titleColor || '#ffffff', 
        textShadow: cfg.titleGlow || 'none', 
        letterSpacing: cfg.titleLetterSpacing || 'normal' 
    };
    Object.assign(stellar.style, s); stellar.style.fontSize = cfg.stellarSize || '5.42vw';
    Object.assign(rush.style,    s); rush.style.fontSize    = cfg.rushSize || '5.42vw';
}

/* ═══════════════════════════════════════════════════════════
   MENU CONTROLLER
   ═══════════════════════════════════════════════════════════ */
const ANIM_DURATION = 7.5;
const JET_START_DELAY = 3.5;

export function createMenu(scene, camera, cfg, skipIntro = false) {
    const tracked = [];
    const track = obj => { tracked.push(obj); return obj; };

    // scene.add(track(new THREE.AmbientLight(0x334466, 1.5)));
    const dir = new THREE.DirectionalLight(0xffb84d, 200); dir.position.set(5, 15, -80); scene.add(track(dir));
    const point = new THREE.PointLight(0xffb84d, 9000.0, 500); point.position.set(5, 10, -100); scene.add(track(point));
    const spot = new THREE.SpotLight(0xffb84d, 50.0, 50); spot.position.set(5, 10, 0); scene.add(track(spot));

    const { mesh: starMesh, material: starMat, syncToCamera } = buildStarField(cfg.starCount, undefined, true);
    scene.add(track(starMesh));

    const sun = createSun(cfg); scene.add(track(sun.group));
    const belt = createAsteroidBelt(scene, cfg.sunPosition, cfg.sunRadius);
    belt.forEach(m => tracked.push(m));

    const plane = makeAircraft();
    scene.add(track(plane));

    // Splash Logo setup
    const loader = new THREE.TextureLoader();
    const splashTex = loader.load('src/images/splashLogo.png', (tex) => {
        const aspect = tex.image.width / tex.image.height;
        // Fix stretching by adjusting width based on aspect ratio
        splashSprite.scale.set(cfg.sunRadius * aspect * 1.2, cfg.sunRadius * 1.2, 1);
    });
    const splashMat = new THREE.SpriteMaterial({ map: splashTex, transparent: true, opacity: 0, depthWrite: false });
    const splashSprite = new THREE.Sprite(splashMat);
    // Position it in front of the sun
    splashSprite.position.set(cfg.sunPosition[0] - 5, cfg.sunPosition[1], cfg.sunPosition[2] + cfg.sunRadius + 5);
    splashSprite.scale.set(cfg.sunRadius * 2.0, cfg.sunRadius * 2.0, 1); // Initial square scale
    scene.add(track(splashSprite));

    const pathPts = cfg.planePathPoints.map(p => new THREE.Vector3(...p));
    const path = new THREE.CatmullRomCurve3(pathPts, false, 'catmullrom', 0.5);
    const trail = createTrail(path, cfg);
    scene.add(track(trail.tube)); scene.add(track(trail.glow));

    applyTitleStyle(cfg);

    const playBtn = document.getElementById('play-btn');
    const upgradesMenuBtn = document.getElementById('upgrades-menu-btn');
    const menuEl  = document.getElementById('main-menu');
    const menuActions = document.getElementById('menu-actions');
    const skipBtn = document.getElementById('skip-intro');

    if (menuActions) { menuActions.className = 'align-' + cfg.playButtonAlign; }
    if (skipBtn) { 
        skipBtn.style.display = 'block'; 
        skipBtn.style.pointerEvents = 'auto'; 
    }
    if (menuEl) {
        menuEl.style.pointerEvents = 'auto'; // Capture clicks across the whole screen for skip
    }

    const camStart  = new THREE.Vector3(...cfg.cameraStartPos);
    const camEnd    = new THREE.Vector3(...cfg.cameraEndPos);
    const lookStart = new THREE.Vector3(...cfg.cameraStartLookAt);
    const lookEnd   = new THREE.Vector3(...cfg.cameraEndLookAt);

    const pathStart3D = new THREE.Vector3(...cfg.planePathPoints[0]);
    const distAtStart = pathStart3D.distanceTo(camEnd);

    let elapsed = 0, animDone = false, jetStarted = false, onPlayCb = null, onReadyCb = null;
    const frozenPos = new THREE.Vector3(), frozenQuat = new THREE.Quaternion();
    let frozenScale = 1;

    const _onPlayClick = () => { if (onPlayCb) onPlayCb(); };
    if (playBtn) playBtn.addEventListener('click', _onPlayClick);

    const _onSkipAction = (e) => {
        if (e && (e.type === 'keydown' && e.key !== ' ')) return; // Only Space for keydown
        if (e) e.stopPropagation();
        if (elapsed < ANIM_DURATION) {
            elapsed = ANIM_DURATION;
            if (skipBtn) skipBtn.style.display = 'none';
            if (menuEl) menuEl.style.pointerEvents = 'none'; // Revert to let buttons handle themselves
            window.removeEventListener('keydown', _onSkipAction);
            menuEl.removeEventListener('click', _onSkipAction);
        }
    };

    if (skipBtn) {
        window.addEventListener('keydown', _onSkipAction);
        menuEl.addEventListener('click', _onSkipAction);
    }

    loadJetBuffer();

    if (skipIntro) {
        elapsed = ANIM_DURATION;
        jetStarted = true;
    }

    function update(dt) {
        elapsed += dt;
        const rawT = Math.min(elapsed / ANIM_DURATION, 1.0);

        if (!jetStarted && elapsed >= JET_START_DELAY) { jetStarted = true; playMenuJet(4.0); }

        camera.position.lerpVectors(camStart, camEnd, rawT);
        const tmpLook = new THREE.Vector3();
        tmpLook.lerpVectors(lookStart, lookEnd, rawT);
        camera.lookAt(tmpLook);

        if (!animDone) {
            // Linear motion
            const pathT = rawT;
            const clampedPathT = Math.min(pathT, 0.9999);
            const pos = path.getPointAt(clampedPathT);
            const tan = path.getTangentAt(clampedPathT);

            plane.position.copy(pos);
            plane.lookAt(pos.clone().sub(tan.clone().multiplyScalar(3)));

            const curDist = pos.distanceTo(camera.position);
            const dFrac = THREE.MathUtils.clamp((curDist - 5) / (distAtStart - 5), 0, 1);
            const scale = THREE.MathUtils.lerp(cfg.planeEndScale, cfg.planeEndScale / 5, dFrac);
            plane.scale.setScalar(scale);

            // Offset the trail rendering slightly behind the plane's actual position
            trail.setProgress(Math.max(0, pathT - 0.004));
            frozenPos.copy(plane.position); frozenQuat.copy(plane.quaternion); frozenScale = plane.scale.x;
        } else {
            plane.position.copy(frozenPos); plane.quaternion.copy(frozenQuat); plane.scale.setScalar(frozenScale);
        }

        sun.coreMat.uniforms.uTime.value = elapsed;
        sun.glowMat.uniforms.uTime.value = elapsed;
        if (sun.flareMat) sun.flareMat.uniforms.uTime.value = elapsed;
        starMat.uniforms.uTime.value = elapsed;
        syncToCamera(camera);

        // Splash Logo Animation
        // Delay: 1s, Fade In: 1s, Hold: 2s, Fade Out: 1s
        const splashDelay = 1.5;
        const splashFadeIn = 1.5;
        const splashHold = 1.5;
        const splashFadeOut = 1.5;

        if (elapsed < splashDelay) {
            splashMat.opacity = 0;
        } else if (elapsed < splashDelay + splashFadeIn) {
            splashMat.opacity = (elapsed - splashDelay) / splashFadeIn;
        } else if (elapsed < splashDelay + splashFadeIn + splashHold) {
            splashMat.opacity = 1.0;
        } else if (elapsed < splashDelay + splashFadeIn + splashHold + splashFadeOut) {
            splashMat.opacity = 1.0 - (elapsed - (splashDelay + splashFadeIn + splashHold)) / splashFadeOut;
        } else {
            splashMat.opacity = 0;
            if (splashSprite.parent) scene.remove(splashSprite);
        }

        if (rawT >= 1.0 && !animDone) {
            animDone = true;
            stopMenuJet();
            if (onReadyCb) onReadyCb();
            if (skipBtn) skipBtn.style.display = 'none';
            if (menuEl) menuEl.style.pointerEvents = 'none';
            window.removeEventListener('keydown', _onSkipAction);
            menuEl.removeEventListener('click', _onSkipAction);
            const tc = document.getElementById('title-container');
            if (tc) { tc.classList.add('visible', 'anim-' + cfg.titleAnimation); }
            setTimeout(() => { 
                if (menuActions) menuActions.classList.add('visible'); 
            }, 100);
        }
    }

    function dispose() {
        if (playBtn) playBtn.removeEventListener('click', _onPlayClick);
        window.removeEventListener('keydown', _onSkipAction);
        if (menuEl) menuEl.removeEventListener('click', _onSkipAction);
        if (menuEl) menuEl.style.display = 'none';
        stopMenuJet();
        tracked.forEach(obj => {
            scene.remove(obj);
            obj.traverse?.(c => { c.geometry?.dispose(); c.material?.dispose?.(); });
        });
        tracked.length = 0;
    }

    if (menuEl) menuEl.style.display = 'flex';
    return { update, dispose, onPlay(cb) { onPlayCb = cb; }, onReady(cb) { onReadyCb = cb; } };
}
