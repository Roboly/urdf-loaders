from flask import Flask, render_template
from flask_socketio import SocketIO, emit

app = Flask(__name__)
app.config['SECRET_KEY'] = 'mysecret'
socketio = SocketIO(app, cors_allowed_origins="*")

# Keep a global dict of all joints
global_joint_states = {}

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('joint_states')
def on_joint_states(data):
    """
    This event is for receiving the full set of joints once (e.g. after URDF is loaded),
    or when multiple joints change simultaneously on a client.
    
    We store them in global_joint_states, then re-broadcast to all clients
    so they can update their local state.
    """
    print("\n=== Received Full Joint States ===")
    print(f"Raw data: {data}")

    # Update global state
    for i, jointName in enumerate(data['name']):
        global_joint_states[jointName] = data['position'][i]

    print("Server Joint States (updated):")
    for joint, value in global_joint_states.items():
        print(f"  {joint}: {value:.4f} rad")

    # Now broadcast the full joint states to ALL clients
    # By default, broadcast=True includes the sender as well,
    # but the sender's client-side code will ignore it if transmitterId matches.
    emit('joint_states', data, broadcast=True)
    # If you do NOT want to send it back to the sender, use: broadcast=True, include_self=False

@socketio.on('update_joint')
def on_update_joint(data):
    """
    This event is for receiving a single-joint update.
    We merge it into the global state and broadcast only this one joint to all clients.
    """
    jn = data['jointName']
    angle = data['angle']
    print(f"\n[update_joint] Updating single joint: {jn} = {angle:.4f} rad")

    # Merge into global state
    global_joint_states[jn] = angle

    # Broadcast only this one joint to all clients
    # (include_self=True or False depending on your preference).
    emit('update_joint', data, broadcast=True)
    # The client that sent it will detect it's its own message if transmitterId matches
    # and ignore it to avoid loops.

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)

