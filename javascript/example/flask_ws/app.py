# app.py
from flask import Flask, render_template
from flask_socketio import SocketIO, emit

app = Flask(__name__)
app.config['SECRET_KEY'] = 'mysecret'
socketio = SocketIO(app, cors_allowed_origins="*")  # Keep CORS enabled

global_joint_states = {}

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('joint_states')
def on_joint_states(data):
    print("\n=== Received Joint States ===")
    print(f"Raw data: {data}")
    
    # Update global state
    for i, jointName in enumerate(data['name']):
        global_joint_states[jointName] = data['position'][i]
    
    print("Current Server Joint States:")
    for joint, value in global_joint_states.items():
        print(f"  {joint}: {value:.4f} rad")
    
    # Broadcast to all clients including debug info
    emit('joint_states', data, broadcast=True)
    emit('server_joints_update', global_joint_states, broadcast=True)

@socketio.on('update_joint')
def on_update_joint(data):
    print(f"\nUpdating single joint: {data['jointName']} = {data['angle']}")
    jn = data['jointName']
    global_joint_states[jn] = data['angle']
    
    updated_msg = {
        "header": {"stamp": {"secs": 0, "nsecs": 0}, "frame_id": ""},
        "name": list(global_joint_states.keys()),
        "position": list(global_joint_states.values()),
        "velocity": [],
        "effort": []
    }
    
    emit('joint_states', updated_msg, broadcast=True)
    emit('server_joints_update', global_joint_states, broadcast=True)

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
