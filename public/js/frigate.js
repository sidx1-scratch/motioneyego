/**
 * =============================================================================
 * FrigateClient - Integration with Frigate NVR Object Detection
 * =============================================================================
 * Handles fetching live detection events, thumbnails, snapshots, and camera
 * telemetry via MotionEyeGo's server-side reverse proxy (/api/frigate/).
 */

class FrigateClient {
  constructor(options = {}) {
    this.enabled = options.enabled || false;
    this.pollInterval = options.pollInterval || 5000;
    this.maxEvents = options.maxEvents || 50;
    this.pollTimer = null;
    this.events = [];
    this.cameras = {};

    this.onEventsUpdate = options.onEventsUpdate || (() => {});
    this.onNewDetection = options.onNewDetection || (() => {});
    this.onError = options.onError || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});

    this.lastEventId = null;
  }

  async init() {
    if (!this.enabled) return false;
    try {
      const stats = await this._fetch('/api/frigate/stats');
      if (stats) {
        this.cameras = stats.cameras || {};
        this.onStatusChange('connected', stats);
        this.startPolling();
        return true;
      }
    } catch (err) {
      this.onError('Unable to reach Frigate NVR via proxy.');
      this.onStatusChange('disconnected', null);
      return false;
    }
  }

  startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this.fetchEvents(), this.pollInterval);
    this.fetchEvents();
  }

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async fetchEvents() {
    if (!this.enabled) return;
    try {
      const query = new URLSearchParams({
        limit: this.maxEvents.toString(),
        has_snapshot: '1'
      });
      const data = await this._fetch(`/api/frigate/events?${query.toString()}`);
      if (!Array.isArray(data)) return;

      if (data.length > 0 && data[0].id !== this.lastEventId) {
        const newDetections = this.lastEventId
          ? data.filter(e => e.id !== this.lastEventId)
          : data.slice(0, 3);

        newDetections.forEach(event => this.onNewDetection(event));
        this.lastEventId = data[0].id;
      }

      this.events = data;
      this.onEventsUpdate(data);
    } catch (err) {
      this.onError(err.message);
    }
  }

  getSnapshotUrl(eventId) {
    return `/api/frigate/events/${eventId}/snapshot.jpg`;
  }

  getThumbnailUrl(eventId) {
    return `/api/frigate/events/${eventId}/thumbnail.jpg`;
  }

  formatEvent(event) {
    const timestamp = event.start_time ? new Date(event.start_time * 1000) : new Date();
    return {
      id: event.id,
      camera: event.camera || 'Camera',
      label: event.label || 'Motion/Object',
      score: event.top_score ? Math.round(event.top_score * 100) + '%' : 'Detected',
      time: timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      thumbnail: this.getThumbnailUrl(event.id),
      snapshot: this.getSnapshotUrl(event.id)
    };
  }

  async _fetch(endpoint) {
    const res = await fetch(endpoint);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) {
      this.init();
    } else {
      this.stopPolling();
      this.onStatusChange('disabled', null);
    }
    return this.enabled;
  }

  destroy() {
    this.stopPolling();
  }
}

window.FrigateClient = FrigateClient;
