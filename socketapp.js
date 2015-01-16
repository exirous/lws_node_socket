/**
 * Created by ExiRouS on 5/1/2014.
 */


var http = require('http');
var app = http.createServer(handler);
var io = require('socket.io').listen(app, {log: false});
var extend = require('util')._extend;

/*, mongoose = require('mongoose');*/

console.log("Server starting...");

app.on('listening', function () {
    console.log('ok, server listening');
});

app.listen(3000);

var TeamSpeakClient = require("node-teamspeak"),
    util = require("util");
var teamSpeakClient = new TeamSpeakClient("127.0.0.1");
var TsKeepAliveTimer;


function handler(req, res) {
    if (req.headers.host == '127.0.0.1:3000') {
        req.on('readable', function () {
            var fullData = "";
            var chunk;
            while (null !== (chunk = req.read())) {
                fullData += (chunk.toString());
            }
            var message = JSON.parse(fullData);

            if (message.isInternal) {
                switch (message.event) {
                    case 'RELOAD_USER_LIST':
                        clearInterval(reloadInterval);
                        refreshClientList();
                        reloadInterval = setInterval(refreshClientList, 60 * 60 * 1000);
                        break;
                    case 'NOTIFY_USER':
                        var clid = findIdFromUID(message.data.reciever);
                        if (clid)
                          teamSpeakClient.send("sendtextmessage", {targetmode:1, target: clid, msg: message.data.msg});
                        break;
                }
            }
            else {
                if (message.room) {
                    io.sockets.in(message.room).emit(message.event, message.data);
                }
                else
                    io.sockets.emit(message.event, message.data);
            }
        });
        res.end('OK');
    }
}


function findIdFromUID(uid) {
    for (var i in TSClients)
        if (TSClients[i].uid == uid)
            return TSClients[i].clid;
        return false;
}

function flatten() {
    var clients = {};
    for (var i in TSClients) {
        var id = TSClients[i].channelId;
        if (!clients.hasOwnProperty(id))
            clients[id] = [];
        clients[id].push(TSClients[i]);
    }
    return clients;
}


function getClients() {
    var flatClients = flatten();
    var clients = getClientsRecursive(TSChannelTree, flatClients);
    return clients.length ? clients : {empty:true};
}

function getClientsRecursive(channels, clients) {
    var outChannels = [];
    for (var i in channels) {
        var channel = extend({}, channels[i]);
        var subCh = getClientsRecursive(channel.channels, clients);
        if (subCh.length || clients.hasOwnProperty(channel.id)) {
            channel.clients = clients.hasOwnProperty(channel.id) ? clients[channel.id] : [];
            channel.channels = subCh;
            outChannels.push(channel);
        }
    }
    return outChannels;
}


io.sockets.on('connection', function (socket) {
    socket.emit('ts_clients', getClients());
    socket.on('register', function (data) {
        socket.join(data.token);
        checkClientMessages({token: data.token, uid: data.uid});
    });
    socket.emit('ready',{});
});

var TSChannelTree = {};
var TSClients = {};
var reloadInterval;

function refreshClientList(firstTime) {
    teamSpeakClient.send("clientlist", {
        _uid: true,
        _groups: true,
        _voice: true,
        _away: true
    }, function (err, response, rawResponse) {
        TSClients = {};
        for (var i in response) {
            var client = response[i];
            if (client.client_type)
                continue;
            client = {
                clid: client.clid,
                name: client.client_nickname,
                uid: client.client_unique_identifier,
                groups: (client.client_servergroups + "").split(','),
                channelId: client.cid
            };
            if (firstTime)
                checkClientMessages(client);
            TSClients[client.clid] = client;
        }
    });
}

function checkClientMessages(client) {
    if (!client.uid || typeof client.uid == 'undefined')
      return;
    var options = {
        host: 'lws.exirous.com',
        path: '/user/unreadMessages?ts_id='+encodeURIComponent(client.uid)
    };
    console.log ('/user/unreadMessages?ts_id='+encodeURIComponent(client.uid));
    var callback = function(response) {
        var str = '';
        //another chunk of data has been recieved, so append it to `str`
        response.on('data', function (chunk) {
            str += chunk;
        });

        response.on('end', function () {
            try {
                var data = JSON.parse(str);
            }
            catch (e)
            {
                console.error(e, "Received string:" + str);
            }
            var count = 0;
            if (data && data.data && data.data.length)
                count = data.data.length;

            if (count > 0 && client.clid)
                teamSpeakClient.send("clientpoke", {clid: client.clid, msg: "У вас "+count+" не прочитанных сообщения. \n [url]http://lws.exirous.com/#/messenger[/url]"});

            if (count > 0 && client.token)
            {
                for (var j in data.data)
                {
                    io.sockets.in(client.token).emit('new_message', data.data[j]);
                }
            }
        });

    };
    http.request(options, callback).end();
}


teamSpeakClient.send("login", {
    client_login_name: "serveradmin",
    client_login_password: "5329"
}, function (err, response, rawResponse) {


    teamSpeakClient.send("use", {sid: 1}, function (err, response, rawResponse) {
        teamSpeakClient.send("channellist", function (err, response, rawResponse) {

            function fillRecursive(list, parentId) {
                var objectList = [];
                for (var i in list) {
                    var channel = list[i];
                    if (i == 0 || parentId != channel.pid)
                        continue;
                    objectList.push({
                        id: channel.cid,
                        name: channel.channel_name,
                        order: channel.channel_order,
                        parent_id: channel.pid,
                        channels: fillRecursive(list, channel.cid)
                    });
                }
                return objectList;
            }

            TSChannelTree = fillRecursive(response, '0');

            refreshClientList(true);
            clearInterval(reloadInterval);
            reloadInterval = setInterval(refreshClientList, 60 * 60 * 1000);
        });

        teamSpeakClient.send("clientupdate", {client_nickname: 'lws'});
        TsKeepAliveTimer = setInterval(function () {
            teamSpeakClient.send('version');
        }, 10000);

        teamSpeakClient.send("servernotifyregister", {event: 'server'});
        teamSpeakClient.send("servernotifyregister", {event: 'channel', id: '0'});

        var lastMovedEvent = null;
        teamSpeakClient.on('clientmoved', function (message) {
            if (lastMovedEvent == message)
                return;
            lastMovedEvent = message;
            TSClients[message.clid].channelId = message.ctid;

            io.sockets.emit('ts_clients', getClients());
        });

        var lastEnterEvent = null;
        teamSpeakClient.on('cliententerview', function (client) {
            if (lastEnterEvent == client)
                return;
            lastEnterEvent = client;

            if (client.client_type == 1)
                return;

            client = {
                clid: client.clid,
                name: client.client_nickname,
                uid: client.client_unique_identifier,
                groups: (client.client_servergroups + "").split(','),
                channelId: client.cid ? client.cid : client.ctid
            };
            TSClients[client.clid] = client;
            io.sockets.emit('ts_clients', getClients());
            checkClientMessages(client);
        });

        var lastLeaveEvent = null;
        teamSpeakClient.on('clientleftview', function (message) {
            if (lastLeaveEvent == message)
                return;
            lastLeaveEvent = message;
            if (message.client_type == 1)
                return;
            delete TSClients[message.clid];
            io.sockets.emit('ts_clients', getClients());
        });
    });
});
