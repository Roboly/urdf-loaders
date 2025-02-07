import { io } from "socket.io-client";

export default class SocketIOController {
  constructor(serverUrl, urdfViewerElement) {
    console.log('[WS] Initializing SocketIOController with server:', serverUrl);
    this.viewer = urdfViewerElement;
    this.socket = io(serverUrl);
    this._updatingFromServer = false;

    // ---- Socket Events ----
    this.socket.on('connect', () => {
      console.log("[WS] SocketIO connected! ID:", this.socket.id);
      // Optionally publish all joints here OR wait until URDF is processed
      // this._publishAllJointStates();
    });

    this.socket.on('disconnect', (reason) => {
      console.log("[WS] Disconnected:", reason);
    });

    // Listen for full joint-states updates
    this.socket.on('joint_states', (data) => {
      console.log("[WS] Received joint_states:", data);
      if (data.name && data.position) {
        // Convert arrays to an object of {jointName: angle}
        const jointVals = {};
        data.name.forEach((jn, i) => (jointVals[jn] = data.position[i]));

        console.log("[WS] Updating viewer joints...");
        this._updatingFromServer = true;
        this.viewer.setJointValues(jointVals);
        this._updatingFromServer = false;
        console.log("[WS] Viewer joints updated");
      }
    });

    // Listen for single-joint updates
    this.socket.on('update_joint', (data) => {
      console.log("[WS] Received single joint update from server:", data);
      
      // --- If there's a transmitterId and it matches ours, ignore (it was our own update) ---
      if (data.transmitterId && data.transmitterId === this.socket.id) {
        console.log("[WS] Ignoring this single-joint update (originated from us).");
        return;
      }

      // If the message has no transmitterId or it's not ours,
      // we treat it as coming from a different source (another client or broker).
      // If you only want to apply changes with a valid transmitterId, add a check here:
      // if (!data.transmitterId) {
      //   console.warn("[WS] Received update_joint without transmitterId - ignoring or handle as needed");
      //   return;
      // }

      // Apply the update
      if (data.jointName && typeof data.angle === "number") {
        this._updatingFromServer = true;
        this.viewer.setJointValues({ [data.jointName]: data.angle });
        this._updatingFromServer = false;
        console.log("[WS] Viewer updated with single joint from server");
      }
    });

    // ---- URDF-specific events ----
    // When the URDF is fully processed, do one bulk publish of ALL joints.
    this.viewer.addEventListener('urdf-processed', () => {
      console.log("[WS] URDF processed - sending initial states...");
      this._publishAllJointStates();
    });

    // For every local angle-change event (i.e. user manipulates a joint),
    // publish only the changed joint. This helps avoid large data traffic.
    this.viewer.addEventListener('angle-change', (e) => {
      if (!this._updatingFromServer) {
        console.log(`[WS] Local joint change detected (${e.detail}), publishing single joint...`);
        this._publishSingleJointState(e.detail);
      } else {
        console.log(`[WS] Ignoring joint change (${e.detail}) from server update`);
      }
    });
  }

  /**
   * Publish the entire set of joint states (names + positions).
   * Call this only once after URDF is fully loaded (or whenever you need a full sync).
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
   * We include 'transmitterId' so we can detect if we are receiving our own update back.
   */
  _publishSingleJointState(jointName) {
    if (!this.socket.connected) {
      console.log("[WS] Cannot publish single joint - socket not connected");
      return;
    }

    const angle = this.viewer.jointValues[jointName];
    const msg = {
      transmitterId: this.socket.id,   // so we know it's from us
      jointName: jointName,
      angle: angle,
    };

    console.log("[WS] Publishing single joint:", msg);
    this.socket.emit('update_joint', msg);
  }
}

