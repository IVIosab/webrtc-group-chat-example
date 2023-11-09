/** CONFIG **/
var SIGNALING_SERVER = `${window.location.protocol}//${window.location.hostname}${window.location.port ? `:${window.location.port}` : '8080'}`;
var ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
var signaling_socket = null;
var local_media_stream = null;
var peers = {};
var peer_media_elements = {};

function init() {
    signaling_socket = io(SIGNALING_SERVER);

    signaling_socket.on('connect', () => {
        console.log("Connected to signaling server");
        setup_local_media(() => join_chat_channel('some-global-channel-name', {}));
    });
    signaling_socket.on('disconnect', () => {
        Object.values(peer_media_elements).forEach(media => document.body.removeChild(media));
        Object.values(peers).forEach(peer => peer.close());
        peers = {};
        peer_media_elements = {};
    });

    function join_chat_channel(channel, userdata) {
        signaling_socket.emit('join', { channel, userdata });
    }

    signaling_socket.on('addPeer', config => {
        var peer_id = config.peer_id;
        if (peer_id in peers) return;
        var peer_connection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        peers[peer_id] = peer_connection;

        peer_connection.onicecandidate = event => {
            if (event.candidate) {
                signaling_socket.emit('relayICECandidate', {
                    peer_id,
                    ice_candidate: event.candidate
                });
            }
        };

        peer_connection.ontrack = event => {
            if (peer_media_elements[peer_id]) return;
            var remote_media = document.createElement("video");
            remote_media.autoplay = true;
            remote_media.controls = true;
            remote_media.muted = false;
            document.body.appendChild(remote_media);
            attachMediaStream(remote_media, event.streams[0]);
            peer_media_elements[peer_id] = remote_media;
        };

        // TODO use addTrack instead of addStream
        peer_connection.addStream(local_media_stream);

        if (config.should_create_offer) {
            peer_connection.createOffer().then(local_description => {
                peer_connection.setLocalDescription(local_description).then(() => {
                    signaling_socket.emit('relaySessionDescription', { peer_id, session_description: local_description });
                });
            });
        }
    });

    signaling_socket.on('sessionDescription', config => {
        var peer_id = config.peer_id;
        var desc = new RTCSessionDescription(config.session_description);
        peers[peer_id].setRemoteDescription(desc).then(() => {
            if (desc.type == "offer") {
                peers[peer_id].createAnswer().then(local_description => {
                    peers[peer_id].setLocalDescription(local_description).then(() => {
                        signaling_socket.emit('relaySessionDescription', { peer_id, session_description: local_description });
                    });
                });
            }
        });
    });

    signaling_socket.on('iceCandidate', config => {
        peers[config.peer_id].addIceCandidate(new RTCIceCandidate(config.ice_candidate));
    });

    signaling_socket.on('removePeer', config => {
        var peer_id = config.peer_id;
        if (peer_media_elements[peer_id]) {
            document.body.removeChild(peer_media_elements[peer_id]);
            delete peer_media_elements[peer_id];
        }
        if (peers[peer_id]) {
            peers[peer_id].close();
            delete peers[peer_id];
        }
    });
}

function setup_local_media(callback) {
    if (local_media_stream) return callback();
    navigator.mediaDevices.getUserMedia({ audio: true, video: true })
        .then(stream => {
            local_media_stream = stream;
            var local_media = document.createElement("video");
            local_media.autoplay = true;
            local_media.muted = true;
            local_media.controls = true;
            document.body.appendChild(local_media);
            attachMediaStream(local_media, stream);
            callback();
        }).catch(() => {
            alert("Access to camera/microphone denied. Demo will not work.");
        });
}

function attachMediaStream(element, stream) {
    element.srcObject = stream;
}

init(); // Start the initialization process
