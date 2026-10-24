/**
 * =============================================================================
 * MotionEyeGo - Main Application Controller
 * =============================================================================
 * Handles camera rendering, cycle/solo/grid view modes, gaze interactions,
 * and Frigate detection notifications for Oculus Go.
 */

(function () {
  'use strict';

  const state = {
    streams: [],
    viewMode: 'grid', // 'grid' | 'fullscreen' | 'cycle'
    selectedCamera: 0,
    cycleTimer: null,
    cycleInterval: 5000,
    frigateEnabled: false,
    config: null
  };

  const els = {};
  let gaze = null;
  let frigate = null;

  async function init() {
    cacheDomElements();

    try {
      const configRes = await fetch('/api/config');
      state.config = await configRes.json();

      const streamsRes = await fetch('/api/streams');
      state.streams = await streamsRes.json();

      state.frigateEnabled = Boolean(state.config?.frigate?.enabled);
    } catch (err) {
      console.error('[App] Failed to load configuration:', err);
      showError('Failed to communicate with MotionEyeGo server.');
      return;
    }

    if (!state.streams || state.streams.length === 0) {
      showError('No camera streams found. Add STREAMS in .env file.');
      return;
    }

    renderCameraGrid();
    initGaze();
    initFrigate();

    updateClock();
    setInterval(updateClock, 1000);

    updateStatus();
    hideLoading();
  }

  function cacheDomElements() {
    els.app = document.getElementById('app');
    els.loadingScreen = document.getElementById('loading-screen');
    els.loadingMsg = document.getElementById('loading-msg');
    els.cameraGrid = document.getElementById('camera-grid');
    els.detectionPanel = document.getElementById('detection-panel');
    els.detectionList = document.getElementById('detection-list');
    els.settingsModal = document.getElementById('settings-modal');
    els.clock = document.getElementById('clock');
    els.statusText = document.getElementById('status-text');
    els.cameraCount = document.getElementById('camera-count');
    els.gazeToggle = document.getElementById('gaze-toggle');
    els.cursorToggle = document.getElementById('cursor-toggle');
    els.dwellDisplay = document.getElementById('dwell-display');
    els.cycleDisplay = document.getElementById('cycle-display');
    els.btnDetections = document.getElementById('btn-detections');
  }

  function renderCameraGrid() {
    els.cameraGrid.innerHTML = '';

    state.streams.forEach((stream, index) => {
      const tile = document.createElement('div');
      tile.className = 'camera-tile gaze-target';
      tile.dataset.gazeAction = 'select-camera';
      tile.dataset.gazeDwell = '900';
      tile.dataset.cameraIndex = index.toString();

      const img = document.createElement('img');
      img.className = 'camera-stream';
      img.src = stream.url || `/api/proxy/stream/${index}`;
      img.alt = stream.name;
      img.loading = 'lazy';

      const errorDiv = document.createElement('div');
      errorDiv.className = 'camera-error';
      errorDiv.style.display = 'none';
      errorDiv.innerHTML = '<span class="error-icon">⚠</span><span>Feed Offline</span>';

      img.onerror = () => {
        img.style.display = 'none';
        errorDiv.style.display = 'flex';
      };

      const label = document.createElement('div');
      label.className = 'camera-label';

      const statusDot = document.createElement('span');
      statusDot.className = 'camera-status online';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'camera-name';
      nameSpan.textContent = stream.name;

      label.appendChild(statusDot);
      label.appendChild(nameSpan);

      tile.appendChild(img);
      tile.appendChild(errorDiv);
      tile.appendChild(label);

      tile.addEventListener('click', () => {
        selectCamera(index);
        if (state.viewMode === 'grid') {
          setViewMode('fullscreen');
        }
      });

      els.cameraGrid.appendChild(tile);
    });

    selectCamera(0);
  }

  function selectCamera(index) {
    state.selectedCamera = index;
    const tiles = document.querySelectorAll('.camera-tile');
    tiles.forEach((t, i) => {
      t.classList.toggle('selected', i === index);
    });

    if (state.viewMode === 'fullscreen' || state.viewMode === 'cycle') {
      showFullscreen(index);
    }
  }

  function setViewMode(mode) {
    if (state.cycleTimer) {
      clearInterval(state.cycleTimer);
      state.cycleTimer = null;
    }

    state.viewMode = mode;
    els.cameraGrid.className = `${mode}-view`;

    if (mode === 'grid') {
      showAllCameras();
    } else if (mode === 'fullscreen') {
      showFullscreen(state.selectedCamera);
    } else if (mode === 'cycle') {
      startCycling();
    }

    updateStatus();
  }

  function showAllCameras() {
    const tiles = document.querySelectorAll('.camera-tile');
    tiles.forEach(tile => {
      tile.style.display = '';
    });
  }

  function showFullscreen(index) {
    const tiles = document.querySelectorAll('.camera-tile');
    tiles.forEach((tile, i) => {
      tile.style.display = (i === index) ? '' : 'none';
    });
  }

  function startCycling() {
    showFullscreen(state.selectedCamera);
    state.cycleTimer = setInterval(() => {
      if (state.streams.length === 0) return;
      state.selectedCamera = (state.selectedCamera + 1) % state.streams.length;
      showFullscreen(state.selectedCamera);
      selectCamera(state.selectedCamera);
    }, state.cycleInterval);
  }

  function initGaze() {
    gaze = new GazeController({
      enabled: true,
      dwellTime: 1000,
      showCursor: true,
      onGazeAction: handleGazeAction
    });
  }

  function handleGazeAction(action, target) {
    switch (action) {
      case 'grid':
        setViewMode('grid');
        break;
      case 'fullscreen':
        setViewMode('fullscreen');
        break;
      case 'cycle':
        setViewMode('cycle');
        break;
      case 'select-camera':
        const camIdx = parseInt(target.dataset.cameraIndex, 10);
        if (!isNaN(camIdx)) {
          selectCamera(camIdx);
          if (state.viewMode === 'grid') {
            setViewMode('fullscreen');
          }
        }
        break;
      case 'toggle-detections':
        toggleDetectionPanel();
        break;
      case 'close-detections':
        hideDetectionPanel();
        break;
      case 'settings':
        showSettings();
        break;
      case 'close-settings':
        hideSettings();
        break;
      case 'toggle-gaze':
        const active = gaze.toggle();
        els.gazeToggle.textContent = active ? 'ON' : 'OFF';
        els.gazeToggle.classList.toggle('off', !active);
        break;
      case 'toggle-cursor':
        const show = !gaze.showCursor;
        gaze.setCursorVisible(show);
        els.cursorToggle.textContent = show ? 'ON' : 'OFF';
        els.cursorToggle.classList.toggle('off', !show);
        break;
      case 'dwell-decrease':
        gaze.setDwellTime(gaze.getDwellTime() - 150);
        els.dwellDisplay.textContent = (gaze.getDwellTime() / 1000).toFixed(1) + 's';
        break;
      case 'dwell-increase':
        gaze.setDwellTime(gaze.getDwellTime() + 150);
        els.dwellDisplay.textContent = (gaze.getDwellTime() / 1000).toFixed(1) + 's';
        break;
      case 'cycle-decrease':
        state.cycleInterval = Math.max(2000, state.cycleInterval - 1000);
        els.cycleDisplay.textContent = (state.cycleInterval / 1000) + 's';
        if (state.viewMode === 'cycle') startCycling();
        break;
      case 'cycle-increase':
        state.cycleInterval = Math.min(30000, state.cycleInterval + 1000);
        els.cycleDisplay.textContent = (state.cycleInterval / 1000) + 's';
        if (state.viewMode === 'cycle') startCycling();
        break;
      case 'view-detection':
        // Optional interaction on detection item click
        break;
    }
  }

  function initFrigate() {
    frigate = new FrigateClient({
      enabled: state.frigateEnabled,
      pollInterval: 5000,
      onEventsUpdate: renderDetectionEvents,
      onNewDetection: (det) => console.log('[Frigate Alert]', det),
      onError: (err) => console.warn('[Frigate]', err),
      onStatusChange: (status) => {
        if (els.btnDetections) {
          els.btnDetections.style.opacity = status === 'connected' ? '1' : '0.6';
        }
      }
    });

    if (state.frigateEnabled) {
      frigate.init();
    } else {
      if (els.btnDetections) els.btnDetections.style.opacity = '0.5';
    }
  }

  function renderDetectionEvents(events) {
    if (!els.detectionList) return;
    els.detectionList.innerHTML = '';

    if (!events || events.length === 0) {
      els.detectionList.innerHTML = '<div class="no-events">No recent detections reported by Frigate.</div>';
      return;
    }

    events.forEach(evt => {
      const item = frigate.formatEvent(evt);
      const row = document.createElement('div');
      row.className = 'detection-item gaze-target';
      row.dataset.gazeAction = 'view-detection';
      row.dataset.gazeDwell = '1000';

      row.innerHTML = `
        <img class="detection-thumb" src="${item.thumbnail}" alt="${item.label}" onerror="this.style.display='none'">
        <div class="detection-info">
          <span class="detection-label">${item.label}</span>
          <span class="detection-score">Confidence: ${item.score}</span>
          <span class="detection-camera">${item.camera}</span>
          <span class="detection-time">${item.time}</span>
        </div>
      `;

      els.detectionList.appendChild(row);
    });
  }

  function toggleDetectionPanel() {
    if (els.detectionPanel.classList.contains('panel-visible')) {
      hideDetectionPanel();
    } else {
      els.detectionPanel.classList.remove('panel-hidden');
      els.detectionPanel.classList.add('panel-visible');
    }
  }

  function hideDetectionPanel() {
    els.detectionPanel.classList.add('panel-hidden');
    els.detectionPanel.classList.remove('panel-visible');
  }

  function showSettings() {
    els.settingsModal.classList.remove('hidden');
  }

  function hideSettings() {
    els.settingsModal.classList.add('hidden');
  }

  function updateClock() {
    if (!els.clock) return;
    const now = new Date();
    els.clock.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function updateStatus() {
    if (els.statusText) {
      els.statusText.textContent = `Mode: ${state.viewMode.toUpperCase()}`;
    }
    if (els.cameraCount) {
      els.cameraCount.textContent = `${state.streams.length} stream${state.streams.length === 1 ? '' : 's'}`;
    }
  }

  function hideLoading() {
    if (!els.loadingScreen) return;
    els.loadingScreen.classList.add('fade-out');
    setTimeout(() => {
      els.loadingScreen.style.display = 'none';
      els.app.classList.remove('hidden');
    }, 400);
  }

  function showError(msg) {
    if (els.loadingMsg) {
      els.loadingMsg.textContent = msg;
    }
    const spinner = document.querySelector('.loader-spinner');
    if (spinner) {
      spinner.style.borderTopColor = '#ff3d00';
    }
  }

  // Keyboard shortcuts for development and remote testing
  document.addEventListener('keydown', (e) => {
    switch (e.key.toLowerCase()) {
      case 'g': setViewMode('grid'); break;
      case 'f': setViewMode('fullscreen'); break;
      case 'c': setViewMode('cycle'); break;
      case 'd': toggleDetectionPanel(); break;
      case 's':
        if (els.settingsModal.classList.contains('hidden')) showSettings();
        else hideSettings();
        break;
      case 'escape':
        hideSettings();
        hideDetectionPanel();
        break;
      case 'arrowright':
        if (state.streams.length > 0) {
          selectCamera((state.selectedCamera + 1) % state.streams.length);
        }
        break;
      case 'arrowleft':
        if (state.streams.length > 0) {
          selectCamera((state.selectedCamera - 1 + state.streams.length) % state.streams.length);
        }
        break;
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
