/**
 * Created by ExiRouS on 5/1/2014.
 */

var extend = require('util')._extend;
/*, mongoose = require('mongoose');*/


var TeamSpeakClient = require("node-teamspeak"),
    util = require("util");
var teamSpeakClient = new TeamSpeakClient("127.0.0.1");
var TsKeepAliveTimer;


var TSClients = {};
var reloadInterval;

function refreshClientList() {
    teamSpeakClient.send("clientlist", {
        _uid: true,
        _groups: true,
        _voice: true,
        _away: true
    }, function (err, response, rawResponse) {
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
            TSClients[client.clid] = client;

            teamSpeakClient.send("clientpoke", {clid: client.clid, msg: "Test"});
        }
    });
}


teamSpeakClient.send("login", {
    client_login_name: "serveradmin",
    client_login_password: "5329"
}, function (err, response, rawResponse) {
    teamSpeakClient.send("use", {sid: 1}, function (err, response, rawResponse) {
        refreshClientList();
    })
});
