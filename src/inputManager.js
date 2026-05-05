/* ═══════════════════════════════════════════════════════════
   INPUT MANAGER
   ═══════════════════════════════════════════════════════════ */

export class InputManager {
    constructor() {
        this.actions = {
            moveX: 0,
            moveY: 0,
            boost: false,
            escape: false
        };

        this.rawKeys = {};
        this.controlMode = 'MOUSE'; // 'MOUSE', 'KEYBOARD', 'TOUCH'
        this.joystickVec = { x: 0, y: 0 };
        this.mouseX = 0;
        this.mouseY = 0;
        
        this.isMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
        
        this.joystickPointerId = null;
        this.elJoystickZone = document.getElementById('mobile-joystick-zone');
        this.elJoystickStick = document.getElementById('mobile-joystick-stick');
        this.elJoystickBase = document.getElementById('mobile-joystick-base');
        this.elMobileBoost = document.getElementById('mobile-boost-btn');

        this.callbacks = {
            onControlModeChange: [],
            onMenuAction: [],
            onPauseAction: [],
            onAnyInput: []
        };

        this._bindEvents();
    }

    on(event, callback) {
        if (this.callbacks[event]) {
            this.callbacks[event].push(callback);
        }
    }

    _fireEvent(event, data) {
        if (this.callbacks[event]) {
            this.callbacks[event].forEach(cb => cb(data));
        }
    }

    setControlMode(mode) {
        if (this.controlMode !== mode) {
            this.controlMode = mode;
            this._fireEvent('onControlModeChange', mode);
        }
    }

    reset() {
        this.actions.moveX = 0;
        this.actions.moveY = 0;
        this.actions.boost = false;
        this.actions.escape = false;
        this.rawKeys = {};
        this._resetJoystick();
        if (this.elMobileBoost) this.elMobileBoost.classList.remove('active');
        this.setControlMode('MOUSE');
    }

    _bindEvents() {
        window.addEventListener('keydown', this._onKeyDown.bind(this));
        window.addEventListener('keyup', this._onKeyUp.bind(this));
        window.addEventListener('mousemove', this._onMouseMove.bind(this));
        window.addEventListener('mousedown', this._onMouseDown.bind(this));
        window.addEventListener('mouseup', this._onMouseUp.bind(this));
        window.addEventListener('pointerdown', this._onPointerDown.bind(this));
        window.addEventListener('pointermove', this._onPointerMove.bind(this));
        window.addEventListener('pointerup', this._onPointerUp.bind(this));
        window.addEventListener('pointercancel', this._onPointerCancel.bind(this));
        window.addEventListener('contextmenu', e => e.preventDefault());
        window.addEventListener('touchstart', () => this._fireEvent('onAnyInput'), { once: true });
    }

    _onKeyDown(e) {
        this._fireEvent('onAnyInput');
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        
        if (key === 'escape') {
            this.actions.escape = true;
            this._fireEvent('onPauseAction', 'Escape');
        }

        if (this.rawKeys.hasOwnProperty(key) === false || !this.rawKeys[key]) {
            this.rawKeys[key] = true;
            this.setControlMode('KEYBOARD');
            this._fireEvent('onMenuAction', e.key); // Pass the original key for menu handling
        }

        if (key === ' ') this.actions.boost = true;
        this._updateMoveActions();
    }

    _onKeyUp(e) {
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        if (key === 'escape') this.actions.escape = false;
        if (this.rawKeys.hasOwnProperty(key)) this.rawKeys[key] = false;
        if (key === ' ') this.actions.boost = false;
        this._updateMoveActions();
    }

    _onMouseMove(e) {
        if (this.isMobile) return;
        this.mouseX = e.clientX;
        this.mouseY = e.clientY;
    }

    _onMouseDown(e) {
        this._fireEvent('onAnyInput');
        if (this.isMobile) return;
        this.setControlMode('MOUSE');
        if (e.button === 0) this.actions.boost = true;
    }

    _onMouseUp(e) {
        if (this.isMobile) return;
        if (e.button === 0) this.actions.boost = false;
    }

    _updateJoystick(touch) {
        if (!this.elJoystickBase) return;
        const rect = this.elJoystickBase.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        let dx = touch.clientX - centerX;
        let dy = touch.clientY - centerY;
        
        const maxRadius = rect.width / 2;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist > maxRadius) {
            dx = (dx / dist) * maxRadius;
            dy = (dy / dist) * maxRadius;
        }
        
        if (this.elJoystickStick) this.elJoystickStick.style.transform = `translate(${dx}px, ${dy}px)`;
        this.joystickVec.x = dx / maxRadius;
        this.joystickVec.y = -dy / maxRadius;
        this._updateMoveActions();
    }

    _resetJoystick() {
        this.joystickVec.x = 0;
        this.joystickVec.y = 0;
        if (this.elJoystickStick) this.elJoystickStick.style.transform = `translate(0px, 0px)`;
        if (this.elJoystickZone) this.elJoystickZone.classList.remove('active');
        this.joystickPointerId = null;
        this._updateMoveActions();
    }

    _onPointerDown(e) {
        this._fireEvent('onAnyInput');
        if (!this.isMobile) return;
        
        if (e.target === this.elMobileBoost) {
            this.actions.boost = true;
            this.elMobileBoost.classList.add('active');
        } else if (this.joystickPointerId === null && this.elJoystickZone && (this.elJoystickZone.contains(e.target) || e.target === this.elJoystickZone)) {
            this.joystickPointerId = e.pointerId;
            this.elJoystickZone.classList.add('active');
            this._updateJoystick(e);
        }
    }

    _onPointerMove(e) {
        if (!this.isMobile) return;
        if (e.pointerId === this.joystickPointerId) {
            this._updateJoystick(e);
        }
    }

    _onPointerUp(e) {
        if (!this.isMobile) return;
        if (e.target === this.elMobileBoost) {
            this.actions.boost = false;
            this.elMobileBoost.classList.remove('active');
        } 
        if (e.pointerId === this.joystickPointerId) {
            this._resetJoystick();
        }
    }

    _onPointerCancel(e) {
        this._onPointerUp(e);
    }

    _updateMoveActions() {
        let x = 0;
        let y = 0;

        if (this.rawKeys['w'] || this.rawKeys['arrowup']) y += 1;
        if (this.rawKeys['s'] || this.rawKeys['arrowdown']) y -= 1;
        if (this.rawKeys['d'] || this.rawKeys['arrowright']) x += 1;
        if (this.rawKeys['a'] || this.rawKeys['arrowleft']) x -= 1;

        x += this.joystickVec.x;
        y += this.joystickVec.y;

        const mag = Math.sqrt(x * x + y * y);
        if (mag > 1) {
            x /= mag;
            y /= mag;
        }

        this.actions.moveX = x;
        this.actions.moveY = y;
    }

    getMouseNDC(gameRect) {
        if (!gameRect || (this.mouseX === 0 && this.mouseY === 0)) return { x: 0, y: 0 };
        return {
            x: ((this.mouseX - gameRect.left) / gameRect.width) * 2 - 1,
            y: -((this.mouseY - gameRect.top) / gameRect.height) * 2 + 1
        };
    }
}

export const inputManager = new InputManager();
