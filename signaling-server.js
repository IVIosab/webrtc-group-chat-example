/**************/
/*** CONFIG ***/
/**************/
const PORT = 8080;


/*************/
/*** SETUP ***/
/*************/
const fs = require("fs");
const express = require('express');
//var http = require('http');
const https = require("https");
const bodyParser = require('body-parser');
const { type } = require("os");
const main = express()
main.use(express.static(__dirname));
//const server = http.createServer(main)


let privateKey, certificate;

privateKey = fs.readFileSync("ssl/server-key.pem", "utf8");
certificate = fs.readFileSync("ssl/server-cert.pem", "utf8");
const credentials = { key: privateKey, cert: certificate };
const server = https.createServer(credentials, main);

const io = require('socket.io').listen(server);
//io.set('log level', 2);

server.listen(PORT, null, function () {
    console.log("Listening on port " + PORT);
});
//main.use(express.bodyParser());

// main.get('/', function (req, res) {res.sendFile(__dirname + '/client.html'); });
// main.get('/index.html', function(req, res){ res.sendfile('newclient.html'); });
// main.get('/client.html', function(req, res){ res.sendfile('newclient.html'); });

/*************************/
/*** INTERESTING STUFF ***/
/*************************/
var channels = {};
var sockets = {};
var IPtoDevices = {};
var IPtoLeader = {};
var DevicetoIP = {};

/**
 * Users will connect to the signaling server, after which they'll issue a "join"
 * to join a particular channel. The signaling server keeps track of all sockets
 * who are in a channel, and on join will send out 'addPeer' events to each pair
 * of users in a channel. When clients receive the 'addPeer' event they'll begin
 * setting up an RTCPeerConnection with one another. During this process they'll
 * need to relay ICECandidate information to one another, as well as SessionDescription
 * information. After all of that happens, they'll finally be able to complete
 * the peer connection and will be streaming audio/video between eachother.
 */
io.sockets.on('connection', function (socket) {
    socket.channels = {};
    sockets[socket.id] = socket;

    console.log("[" + socket.id + "] connection accepted");
    socket.on('disconnect', function () {
        for (var channel in socket.channels) {
            part(channel);
        }
        console.log("[" + socket.id + "] disconnected");
        delete sockets[socket.id];
    });


    socket.on('join', function (config) {
        console.log("[" + socket.id + "] join ", config);
        var channel = config.channel;
        var userdata = config.userdata;

        if (channel in socket.channels) {
            console.log("[" + socket.id + "] ERROR: already joined ", channel);
            return;
        }

        if (!(channel in channels)) {
            channels[channel] = {};
        }

        for (id in channels[channel]) {
            channels[channel][id].emit('addPeer', { 'peer_id': socket.id, 'should_create_offer': false });
            socket.emit('addPeer', { 'peer_id': id, 'should_create_offer': true });
        }

        channels[channel][socket.id] = socket;
        socket.channels[channel] = channel;
    });

    function part(channel) {
        console.log("[" + socket.id + "] part ");

        if (!(channel in socket.channels)) {
            console.log("[" + socket.id + "] ERROR: not in ", channel);
            return;
        }

        delete socket.channels[channel];
        delete channels[channel][socket.id];

        // delete the id from IPtoDevices
        if (DevicetoIP[socket.id] in IPtoDevices) {
            var index = IPtoDevices[DevicetoIP[socket.id]].indexOf(socket.id);
            if (index > -1) {
                IPtoDevices[DevicetoIP[socket.id]].splice(index, 1);
            }
        }

        // delete the IP from IPtoDevices if no device is connected, otherwise check if the leader left and set a new leader
        if (IPtoDevices[DevicetoIP[socket.id]].length === 0) {
            delete IPtoLeader[DevicetoIP[socket.id]];
            delete IPtoDevices[DevicetoIP[socket.id]];
        }
        else {
            if (IPtoLeader[DevicetoIP[socket.id]] === socket.id) {
                IPtoLeader[DevicetoIP[socket.id]] = IPtoDevices[DevicetoIP[socket.id]][0];
            }
        }

        // delete the IP from DevicetoIP
        delete DevicetoIP[socket.id];

        for (id in channels[channel]) {
            channels[channel][id].emit('removePeer', { 'peer_id': socket.id });
            socket.emit('removePeer', { 'peer_id': id });
        }
    }
    socket.on('part', part);

    socket.on('relayICECandidate', function (config) {
        var peer_id = config.peer_id;
        var ice_candidate = config.ice_candidate;
        // console.log("[" + socket.id + "] relaying ICE candidate to [" + peer_id + "] ", ice_candidate);

        var ips = ice_candidate.candidate.match(/([0-9]{1,3}(\.[0-9]{1,3}){3})/g);
        if (ips) {
            if (ips.length > 1) {
                DevicetoIP[socket.id] = ips[0];
                if (ips[0] in IPtoDevices) {
                    if (!IPtoDevices[ips[0]].includes(socket.id)) {
                        IPtoDevices[ips[0]].push(socket.id);
                    }
                } else {
                    IPtoDevices[ips[0]] = [socket.id];
                    IPtoLeader[ips[0]] = [socket.id];
                }
            }
        }
        console.log("IP to Devices:", IPtoDevices);
        console.log("IP to Leader:", IPtoLeader);
        console.log("Device to IP:", DevicetoIP);
        if (peer_id in sockets) {
            sockets[peer_id].emit('iceCandidate', { 'peer_id': socket.id, 'ice_candidate': ice_candidate });
        }
    });

    socket.on('relaySessionDescription', function (config) {
        var peer_id = config.peer_id;
        var session_description = config.session_description;
        // console.log("[" + socket.id + "] relaying session description to [" + peer_id + "] ", session_description);
        if (peer_id in sockets) {
            sockets[peer_id].emit('sessionDescription', { 'peer_id': socket.id, 'session_description': session_description });
        }
    });
});
