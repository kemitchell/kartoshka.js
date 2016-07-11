#!/usr/bin/env node
var TCPLogClient = require('tcp-log-client')
var httpHandlerFactory = require('./')
var leveldown = require('leveldown')
var levelup = require('levelup')
var name = require('./package.json').name
var pino = require('pino')

var LOG_HOST = process.env.TCP_LOG_HOST || 'localhost'
var LOG_PORT = Number(process.env.TCP_LOG_PORT) || 8089
var LEVELDB = process.env.LEVELDB || (name + '.leveldb')

var serverLog = pino()
var logClient = new TCPLogClient({
  server: {host: LOG_HOST, port: LOG_PORT}
})
var level = levelup(LEVELDB, {db: leveldown})
var handler = httpHandlerFactory(serverLog, level, logClient)
var server = require('http').createServer(handler)
logClient.connect().once('current', function () {
  serverLog.info({event: 'current'})
  server.listen(process.env.PORT || 0, function () {
    serverLog.info({event: 'listening', port: this.address().port})
  })
})
