import { io } from "socket.io-client";

export default class SocketIOController {
  constructor(serverUrl, urdfViewerElement, DEBOUNCE_MS, THROTTLE_ALL_JOINTS_MS) {
    console.log('[WS] Initializing SocketIOController with server:', serverUrl);
    this.viewer = urdfViewerElement;
    this.socket = io(serverUrl);
    this._updatingFromServer = false;

    // ---- Added for "multiple simultaneous changes" logic ----
    this._pendingJointChanges = new Set();
    this._pendingJointTimeout = null;
    const DEBOUNCE_MS = DEBOUNCE_MS;
    this.THROTTLE_ALL_JOINTS_MS = THROTTLE_ALL_JOINTS_MS;
    this.lastAllJointUpdateTime = 0;

    // ---- Socket Events ----
    this.socket.on('connect', () => {
      console.log("[WS] SocketIO connected! ID:", this.socket.id);
      // Optionally publish all joints here OR wait until URDF is processed
      // this._publishAllJointStates();
    });

    this.socket.on('disconnect', (reason) => {
      console.log("[WS] Disconnected:", reason);
    });

    // -------------------------------------------------------------------------
    // Listen for *full* joint-states updates from the server
    // -------------------------------------------------------------------------
    this.socket.on('joint_states', (data) => {
      // 1) If the update is from *ourselves*, skip it to avoid loops
      if (data.header?.transmitterId === this.socket.id) {
        console.log("[WS] Ignoring full-joint update from ourselves.");
        return;
      }

      console.log("[WS] Received joint_states from server:", data);

      // 2) Apply the update if it has valid name/position arrays
      if (Array.isArray(data.name) && Array.isArray(data.position)) {
        // Convert arrays to an object of { jointName: angle }
        const jointVals = {};
        data.name.forEach((jn, i) => (jointVals[jn] = data.position[i]));

        console.log("[WS] Updating viewer joints...");
        this._updatingFromServer = true;   // so local angle-change won't re-send
        this.viewer.setJointValues(jointVals);
        this._updatingFromServer = false;
        console.log("[WS] Viewer joints updated (from full-joint message)");
      }
    });

    // -------------------------------------------------------------------------
    // Listen for *single-joint* updates from the server
    // -------------------------------------------------------------------------
    this.socket.on('update_joint', (data) => {
      // 1) If it's our own update, skip it to avoid loops
      if (data.header?.transmitterId === this.socket.id) {
        console.log("[WS] Ignoring single-joint update (originated from us).");
        return;
      }

      console.log("[WS] Received single joint update from server:", data);

      // 2) Apply the update if valid
      if (data.jointName && typeof data.angle === "number") {
        this._updatingFromServer = true;   // stops local re-send
        this.viewer.setJointValues({ [data.jointName]: data.angle });
        this._updatingFromServer = false;
        console.log("[WS] Viewer updated with single joint from server");
      }
    });

    // -------------------------------------------------------------------------
    // URDF-specific event — after URDF is loaded, do one full publish
    // -------------------------------------------------------------------------
    this.viewer.addEventListener('urdf-processed', () => {
      console.log("[WS] URDF processed - sending initial states...");
      this._publishAllJointStates();
    });

    // -------------------------------------------------------------------------
    // Local angle-change (user manipulates a joint)
    // -------------------------------------------------------------------------
    this.viewer.addEventListener('angle-change', (e) => {
      // If this change came from the server, skip re-publishing to avoid loops
      if (this._updatingFromServer) {
        console.log(`[WS] Ignoring joint change (${e.detail}) from server update`);
        return;
      }

      // Collect changes in a Set so multiple near-simultaneous changes are batched
      this._pendingJointChanges.add(e.detail);

      // If we already have a pending timeout, do nothing. If not, create one.
      if (!this._pendingJointTimeout) {
        this._pendingJointTimeout = setTimeout(() => {
          this._flushPendingJointChanges();
        }, DEBOUNCE_MS);
      }
    });
  }

  /**
   * "Flush" any joint changes accumulated during the short debounce window.
   */
  _flushPendingJointChanges() {
    clearTimeout(this._pendingJointTimeout);
    this._pendingJointTimeout = null;

    const numChanges = this._pendingJointChanges.size;

    if (numChanges === 0) {
      return; // No changes, nothing to do
    }

    if (numChanges === 1) {
      // If exactly one joint changed, send single-joint
      const [jointName] = this._pendingJointChanges;
      console.log(`[WS] Local joint change detected for 1 joint (${jointName}), publishing single joint...`);
      this._publishSingleJointState(jointName);

    } else {
      // If multiple joints changed, send all_joints. Throttle to 30 Hz max.
      const now = Date.now();
      const elapsed = now - this.lastAllJointUpdateTime;
      if (elapsed >= this.THROTTLE_ALL_JOINTS_MS) {
        console.log(`[WS] Local joint changes for multiple joints: ${[...this._pendingJointChanges]}`);
        console.log(`[WS] Publishing ALL joints...`);
        this._publishAllJointStates();
        this.lastAllJointUpdateTime = now;
      } else {
        // Too soon since last all_joints update -> skip or queue it
        console.log("[WS] Skipping all_joints publish: still within throttle window.");
      }
    }

    // Clear the set for future changes
    this._pendingJointChanges.clear();
  }

  /**
   * Publish the entire set of joint states (names + positions).
   */
  _publishAllJointStates() {
    if (!this.socket.connected) {
      console.log("[WS] Cannot publish - socket not connected");
      return;
    }

    const allJoints = this.viewer.jointValues; // e.g. {joint1: val, joint2: val, ...}
    console.log("[WS] Current local joint values:", allJoints);

    const names = Object.keys(allJoints);
    const positions = names.map((n) => allJoints[n]);

    const msg = {
      header: {
        stamp: {
          secs: Math.floor(Date.now() / 1000),
          nsecs: (Date.now() % 1000) * 1e6,
        },
        frame_id: "",
        transmitterId: this.socket.id,   // so we know it's from us
      },
      name: names,
      position: positions,
      velocity: [],
      effort: [],
    };

    console.log("[WS] Emitting joint_states:", msg);
    this.socket.emit('joint_states', msg);
  }

  /**
   * Publish only a single joint update to the server.
   */
  _publishSingleJointState(jointName) {
    if (!this.socket.connected) {
      console.log("[WS] Cannot publish single joint - socket not connected");
      return;
    }

    const angle = this.viewer.jointValues[jointName];
    const msg = {
      header: {
        stamp: {
          secs: Math.floor(Date.now() / 1000),
          nsecs: (Date.now() % 1000) * 1e6,
        },
        frame_id: "",
        transmitterId: this.socket.id,   // so we know it's from us
      },
      jointName: jointName,
      angle: angle,
    };

    console.log("[WS] Publishing single joint:", msg);
    this.socket.emit('update_joint', msg);
  }
}

