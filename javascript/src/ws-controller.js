import { io } from "socket.io-client"; // or from the CDN

export default class SocketIOController {
  constructor(serverUrl, urdfViewerElement) {
    console.log('[WS] Initializing SocketIOController with server:', serverUrl);
    this.viewer = urdfViewerElement;
    this.socket = io(serverUrl);
    this._updatingFromServer = false;

    this.socket.on('connect', () => {
      console.log("[WS] SocketIO connected! ID:", this.socket.id);
      console.log("[WS] Sending initial joint states...");
      this._publishAllJointStates();
    });

    this.socket.on('disconnect', (reason) => {
      console.log("[WS] Disconnected:", reason);
    });

    this.socket.on('joint_states', (data) => {
      console.log("[WS] Received joint_states:", data);
      if (data.name && data.position) {
        const jointVals = {};
        data.name.forEach((jn, i) => jointVals[jn] = data.position[i]);
        console.log("[WS] Parsed joint values:", jointVals);
        
        console.log("[WS] Updating viewer joints...");
        this._updatingFromServer = true;
        this.viewer.setJointValues(jointVals);
        this._updatingFromServer = false;
        console.log("[WS] Viewer joints updated");
      }
    });

    this.viewer.addEventListener('angle-change', (e) => {
      if (!this._updatingFromServer) {
        console.log(`[WS] Local joint change detected (${e.detail}), publishing...`);
        this._publishAllJointStates();
      } else {
        console.log(`[WS] Ignoring joint change (${e.detail}) from server update`);
      }
    });
  }

  _publishAllJointStates() {
    if (!this.socket.connected) {
      console.log("[WS] Cannot publish - socket not connected");
      return;
    }

    const allJoints = this.viewer.jointValues;
    console.log("[WS] Current local joint values:", allJoints);

    const names = Object.keys(allJoints);
    const positions = names.map(n => allJoints[n]);
    console.log("[WS] Preparing joint_states message with", names.length, "joints");

    const msg = {
      header: {
        stamp: { 
          secs: Math.floor(Date.now() / 1000),
          nsecs: (Date.now() % 1000) * 1e6
        },
        frame_id: ''
      },
      name: names,
      position: positions,
      velocity: [],
      effort: []
    };
    
    console.log("[WS] Emitting joint_states:", msg);
    this.socket.emit('joint_states', msg);
    console.log("[WS] joint_states emitted successfully");
  }
}

