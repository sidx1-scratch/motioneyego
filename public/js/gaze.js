/**
 * =============================================================================
 * GazeController - Hands-Free Gaze Navigation for Oculus Go Browser
 * =============================================================================
 * In the Oculus Go browser, head motion steers the ray/cursor in 3DoF.
 * GazeController enables selection by lingering ("dwelling") over any element
 * marked with class `.gaze-target`.
 *
 * It renders an interactive SVG ring progress reticle and handles mouse/pointer/touch
 * events as well as direct viewport center raycasting for immersive VR usage.
 */

class GazeController {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.defaultDwellTime = options.dwellTime || 1000; // ms
    this.cursorElement = document.getElementById('gaze-cursor');
    this.progressRing = document.querySelector('.gaze-ring-progress');
    this.showCursor = options.showCursor !== false;
    
    // Internal state
    this.currentTarget = null;
    this.dwellTimer = null;
    this.dwellStartTime = 0;
    this.animationFrame = null;
    this.isActive = false;
    
    // SVG reticle calculation: radius 42 -> 2 * PI * 42 ~= 263.89
    this.radius = 42;
    this.circumference = 2 * Math.PI * this.radius;
    
    // Action callback
    this.onGazeAction = options.onGazeAction || (() => {});
    
    // Bound handlers
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerOver = this._onPointerOver.bind(this);
    this._onPointerOut = this._onPointerOut.bind(this);
    this._updateProgress = this._updateProgress.bind(this);
    this._checkCenterGaze = this._checkCenterGaze.bind(this);
    
    this._init();
  }

  _init() {
    if (this.progressRing) {
      this.progressRing.style.strokeDasharray = `${this.circumference}`;
      this.progressRing.style.strokeDashoffset = `${this.circumference}`;
    }
    
    this._updateCursorVisibility();
    this._attachListeners();

    // Secondary VR center raycaster polling (when pointer events aren't actively sent by head orientation)
    this._centerCheckInterval = setInterval(this._checkCenterGaze, 100);
  }

  _attachListeners() {
    document.addEventListener('pointermove', this._onPointerMove, { passive: true });
    document.addEventListener('pointerover', this._onPointerOver, { passive: true });
    document.addEventListener('pointerout', this._onPointerOut, { passive: true });
    
    // Direct click/touch support
    document.addEventListener('click', (e) => {
      const target = e.target.closest('.gaze-target');
      if (target && target.dataset.gazeAction) {
        this._triggerAction(target);
      }
    });
  }

  _onPointerMove(e) {
    if (!this.enabled) return;
    // On Oculus Go, the mouse/pointer follows head orientation.
  }

  _onPointerOver(e) {
    if (!this.enabled) return;
    const target = e.target.closest('.gaze-target');
    if (!target) return;
    this._startDwell(target);
  }

  _onPointerOut(e) {
    if (!this.enabled) return;
    const target = e.target.closest('.gaze-target');
    if (!target) return;
    
    const related = e.relatedTarget;
    if (related && target.contains(related)) return;
    
    if (this.currentTarget === target) {
      this._cancelDwell();
    }
  }

  _checkCenterGaze() {
    if (!this.enabled) return;
    
    // Center point of Oculus Go view
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const elem = document.elementFromPoint(cx, cy);
    if (!elem) {
      if (this.currentTarget) this._cancelDwell();
      return;
    }
    
    const target = elem.closest('.gaze-target');
    if (target) {
      if (this.currentTarget !== target) {
        this._startDwell(target);
      }
    } else {
      if (this.currentTarget) {
        this._cancelDwell();
      }
    }
  }

  _startDwell(target) {
    if (this.currentTarget === target) return;
    this._cancelDwell();
    
    this.currentTarget = target;
    this.isActive = true;
    target.classList.add('gaze-hover');
    
    const dwellTime = parseInt(target.dataset.gazeDwell, 10) || this.defaultDwellTime;
    this.dwellStartTime = performance.now();
    
    this._updateProgress();
    
    this.dwellTimer = setTimeout(() => {
      this._triggerAction(target);
    }, dwellTime);
  }

  _cancelDwell() {
    if (this.currentTarget) {
      this.currentTarget.classList.remove('gaze-hover');
    }
    this.currentTarget = null;
    this.isActive = false;
    
    if (this.dwellTimer) {
      clearTimeout(this.dwellTimer);
      this.dwellTimer = null;
    }
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    this._setProgress(0);
  }

  _updateProgress() {
    if (!this.isActive || !this.currentTarget) return;
    
    const dwellTime = parseInt(this.currentTarget.dataset.gazeDwell, 10) || this.defaultDwellTime;
    const elapsed = performance.now() - this.dwellStartTime;
    const progress = Math.min(elapsed / dwellTime, 1);
    
    this._setProgress(progress);
    
    if (progress < 1) {
      this.animationFrame = requestAnimationFrame(this._updateProgress);
    }
  }

  _setProgress(progress) {
    if (!this.progressRing) return;
    const offset = this.circumference * (1 - progress);
    this.progressRing.style.strokeDashoffset = offset;
  }

  _triggerAction(target) {
    const action = target.dataset.gazeAction;
    if (!action) return;
    
    target.classList.add('gaze-activated');
    setTimeout(() => {
      if (target) target.classList.remove('gaze-activated');
    }, 300);
    
    this._cancelDwell();
    this.onGazeAction(action, target);
  }

  enable() {
    this.enabled = true;
    this._updateCursorVisibility();
  }

  disable() {
    this.enabled = false;
    this._cancelDwell();
    this._updateCursorVisibility();
  }

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
    return this.enabled;
  }

  setDwellTime(ms) {
    this.defaultDwellTime = Math.max(300, Math.min(3000, ms));
  }

  getDwellTime() {
    return this.defaultDwellTime;
  }

  setCursorVisible(visible) {
    this.showCursor = visible;
    this._updateCursorVisibility();
  }

  _updateCursorVisibility() {
    if (!this.cursorElement) return;
    if (this.enabled && this.showCursor) {
      this.cursorElement.classList.remove('gaze-cursor-hidden');
    } else {
      this.cursorElement.classList.add('gaze-cursor-hidden');
    }
  }

  destroy() {
    this._cancelDwell();
    if (this._centerCheckInterval) clearInterval(this._centerCheckInterval);
    document.removeEventListener('pointermove', this._onPointerMove);
    document.removeEventListener('pointerover', this._onPointerOver);
    document.removeEventListener('pointerout', this._onPointerOut);
  }
}

window.GazeController = GazeController;
