/** CONFIG **/
var SIGNALING_SERVER = window.location.protocol + "://" + window.location.hostname + (window.location.port ? ":" + window.location.port : "");
var USE_AUDIO = true;
var USE_VIDEO = true;
var DEFAULT_CHANNEL = 'some-global-channel-name';
var MUTE_AUDIO_BY_DEFAULT = false;

var ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" }
];
var signaling_socket = null;   /* our socket.io connection to our webserver */
var local_media_stream = null; /* our own microphone / webcam */
var peers = {};                /* keep track of our peer connections, indexed by peer_id (aka socket.io id) */
var peer_media_elements = {};  /* keep track of our <video>/<audio> tags, indexed by peer_id */

function init() {
    console.log("Connecting to signaling server");
    signaling_socket = io(SIGNALING_SERVER);
    signaling_socket = io();

    signaling_socket.on('connect', function () {
        console.log("Connected to signaling server");
        setup_local_media(function () {
            join_chat_channel(DEFAULT_CHANNEL, { 'whatever-you-want-here': 'stuff' });
        });
    });
    signaling_socket.on('disconnect', function () {
        console.log("Disconnected from signaling server");
        for (var peer_id in peer_media_elements) {
            document.body.removeChild(peer_media_elements[peer_id]);
        }
        for (var peer_id in peers) {
            peers[peer_id].close();
        }

        peers = {};
        peer_media_elements = {};
    });
    function join_chat_channel(channel, userdata) {
        signaling_socket.emit('join', { "channel": channel, "userdata": userdata });
    }
    function part_chat_channel(channel) {
        signaling_socket.emit('part', channel);
    }

    signaling_socket.on('addPeer', function (config) {
        console.log('Signaling server said to add peer:', config);
        var peer_id = config.peer_id;
        if (peer_id in peers) {
            console.log("Already connected to peer ", peer_id);
            return;
        }
        var peer_connection = new RTCPeerConnection({ "iceServers": ICE_SERVERS });
        peers[peer_id] = peer_connection;

        peer_connection.onicecandidate = function (event) {
            if (event.candidate) {
                signaling_socket.emit('relayICECandidate', {
                    'peer_id': peer_id,
                    'ice_candidate': {
                        'sdpMLineIndex': event.candidate.sdpMLineIndex,
                        'candidate': event.candidate.candidate
                    }
                });
            }
        }
        let isTrackEventHandled = false;

        peer_connection.ontrack = function (event) {
            if (isTrackEventHandled) {
                return;
            }
            console.log("ontrack", event);
            var remote_media = USE_VIDEO ? document.createElement("video") : document.createElement("audio");
            remote_media.autoplay = true;
            if (MUTE_AUDIO_BY_DEFAULT) {
                remote_media.muted = true;
            }
            remote_media.controls = true;
            peer_media_elements[peer_id] = remote_media;
            document.body.appendChild(remote_media);
            attachMediaStream(remote_media, event.streams[0]);

            isTrackEventHandled = true;
        }

        peer_connection.addStream(local_media_stream);

        if (config.should_create_offer) {
            console.log("Creating RTC offer to ", peer_id);
            peer_connection.createOffer().then(function (local_description) {
                console.log("Local offer description is: ", local_description);
                peer_connection.setLocalDescription(local_description).then(function () {
                    signaling_socket.emit('relaySessionDescription', { 'peer_id': peer_id, 'session_description': local_description });
                    console.log("Offer setLocalDescription succeeded");
                }).catch(function () { alert("Offer setLocalDescription failed!"); });
            }).catch(function (error) {
                console.log("Error sending offer: ", error);
            });
        }
    });

    signaling_socket.on('sessionDescription', function (config) {
        console.log('Remote description received: ', config);
        var peer_id = config.peer_id;
        var peer = peers[peer_id];
        var remote_description = config.session_description;
        console.log(config.session_description);

        var desc = new RTCSessionDescription(remote_description);
        peer.setRemoteDescription(desc).then(function () {
            console.log("setRemoteDescription succeeded");
            if (remote_description.type == "offer") {
                console.log("Creating answer");
                peer.createAnswer().then(function (local_description) {
                    console.log("Answer description is: ", local_description);
                    peer.setLocalDescription(local_description).then(function () {
                        signaling_socket.emit('relaySessionDescription', { 'peer_id': peer_id, 'session_description': local_description });
                        console.log("Answer setLocalDescription succeeded");
                    }).catch(function () { alert("Answer setLocalDescription failed!"); });
                }).catch(function (error) {
                    console.log("Error creating answer: ", error);
                });
            }
        }).catch(function (error) {
            console.log("setRemoteDescription error: ", error);
        });
    });

    signaling_socket.on('iceCandidate', function (config) {
        var peer = peers[config.peer_id];
        var ice_candidate = config.ice_candidate;
        peer.addIceCandidate(new RTCIceCandidate(ice_candidate));
    });

    signaling_socket.on('removePeer', function (config) {
        console.log('Signaling server said to remove peer:', config);
        var peer_id = config.peer_id;
        if (peer_id in peer_media_elements) {
            document.body.removeChild(peer_media_elements[peer_id]);
        }
        if (peer_id in peers) {
            peers[peer_id].close();
        }

        delete peers[peer_id];
        delete peer_media_elements[config.peer_id];
    });
}

function setup_local_media(callback, errorback) {
    if (local_media_stream != null) {
        if (callback) callback();
        return;
    }
    console.log("Requesting access to local audio / video inputs");

    navigator.mediaDevices.getUserMedia({ "audio": USE_AUDIO, "video": USE_VIDEO })
        .then(function (stream) {
            console.log("Access granted to audio/video");
            local_media_stream = stream;
            var local_media = USE_VIDEO ? document.createElement("video") : document.createElement("audio");
            local_media.autoplay = true;
            local_media.muted = true; // always mute ourselves by default
            local_media.controls = true;
            document.body.appendChild(local_media);
            attachMediaStream(local_media, stream);

            if (callback) callback();
        }).catch(function () {
            console.log("Access denied for audio/video");
            alert("You chose not to provide access to the camera/microphone, demo will not work.");
            if (errorback) errorback();
        });
}

function attachMediaStream(element, stream) {
    element.srcObject = stream;
}
