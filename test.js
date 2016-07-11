var AbstractBlobStore = require('abstract-blob-store')
var EventEmitter = require('events').EventEmitter
var TCPLogClient = require('tcp-log-client')
var devNull = require('dev-null')
var http = require('http')
var httpHandlerFactory = require('./')
var levelLogs = require('level-logs')
var levelup = require('levelup')
var memdown = require('memdown')
var net = require('net')
var pino = require('pino')
var sha256 = require('sha256')
var tape = require('tape')
var tcpLogServer = require('tcp-log-server')

function setupServers (callback) {
  // Clear LevelUP in-memory storage back-end for each test.
  memdown.clearGlobalStore()
  // Start a tcp-log-server.
  setupLogServer(function (logServer) {
    var port = logServer.address().port
    // Start an HTTP server connected to the log server.
    setupHTTPServer(port, function (httpServer) {
      // Provide the server objects to the test.
      callback(logServer, httpServer)
    })
  })
}

function setupLogServer (callback) {
  // Use an in-memory LevelUP storage back-end.
  var level = levelup('log', {db: memdown})
  var logs = levelLogs(level, {valueEncoding: 'json'})
  // Use an in-memory blob store.
  var blobs = new AbstractBlobStore()
  // Pipe log messages to nowhere.
  var log = pino({}, devNull())
  var emitter = new EventEmitter()
  var handler = tcpLogServer(log, logs, blobs, emitter, sha256)
  // Starts the TCP server.
  net.createServer(handler)
  .once('close', function () { level.close() })
  .listen(0, function () { callback(this) })
}

function setupHTTPServer (logServerPort, callback) {
  // Use an in-memory LevelUP storage back-end.
  var level = levelup('server', {db: memdown})
  //  Pipe log messages to nowhere.
  var log = pino({}, devNull())
  var server
  // Create a client for the tcp-log-server.
  var logClient = new TCPLogClient({server: {port: logServerPort}})
  // Start the HTTP server when the log client catches up with the log.
  .once('current', function () {
    server.listen(0, function () { callback(this) })
  })
  // Created the HTTP server.
  var handler = httpHandlerFactory(log, level, logClient)
  server = http.createServer(handler)
  .once('close', function () {
    level.close()
    logClient.destroy()
  })
  // Connect the log client.
  logClient.connect()
}

tape('POST and GET', function (test) {
  setupServers(function postValue (logServer, httpServer) {
    http.request({
      method: 'POST',
      port: httpServer.address().port
    }, function (response) {
      test.equal(response.statusCode, 202, '202')
      setTimeout(function requestTheSameValue () {
        http.request({
          port: httpServer.address().port
        }, function testResponse (response) {
          test.equal(response.statusCode, 200, '200')
          var chunks = []
          response
          .on('data', function (chunk) { chunks.push(chunk) })
          .once('error', function (error) {
            test.ifError(error, 'no error')
          })
          .once('end', function testBody () {
            var body = Buffer.concat(chunks)
            test.equal(body.toString(), 'apple', 'serves value')
            httpServer.close()
            logServer.close()
            test.end()
          })
        })
        .end()
      }, 100)
    })
    .end('apple')
  })
})

tape('entry', function (test) {
  setupServers(function (logServer, httpServer) {
    // Raw log entry to write with a separate client.
    var entry = {version: '0.0.0', key: 'x', value: 'apple'}
    var client = new TCPLogClient({
      server: {port: logServer.address().port}
    })
    .connect()
    .once('ready', function writeEntryToLog () {
      // Write the entry to the log directly.
      client.write(entry, function cleanUp (error) {
        test.ifError(error, 'no error')
        client.destroy()
        setTimeout(function fetchFromHTTPServer () {
          http.request({
            port: httpServer.address().port
          }, function testResponse (response) {
            test.equal(response.statusCode, 200, '200')
            var chunks = []
            response
            .on('data', function (chunk) { chunks.push(chunk) })
            .once('error', function (error) {
              test.ifError(error, 'no error')
            })
            .once('end', function testBody () {
              var body = Buffer.concat(chunks)
              test.equal(body.toString(), 'apple', 'serves value')
              httpServer.close()
              logServer.close()
              test.end()
            })
          })
          .end()
        }, 100)
      })
    })
  })
})

tape('shared log', function (test) {
  setupServers(function (logServer, firstHTTPServer) {
    var tcpPort = logServer.address().port
    setupHTTPServer(tcpPort, function (secondHTTPServer) {
      http.request({
        method: 'POST',
        port: firstHTTPServer.address().port
      }, function testPOSTResponse (response) {
        test.equal(response.statusCode, 202, '202')
        setTimeout(function requestTheSameValue () {
          http.request({
            port: secondHTTPServer.address().port
          }, function testResponse (response) {
            test.equal(response.statusCode, 200, '200')
            var chunks = []
            response
            .on('data', function (chunk) { chunks.push(chunk) })
            .once('error', function (error) {
              test.ifError(error, 'no error')
            })
            .once('end', function testBody () {
              var body = Buffer.concat(chunks)
              test.equal(body.toString(), 'apple', 'serves value')
              firstHTTPServer.close()
              secondHTTPServer.close()
              logServer.close()
              test.end()
            })
          })
          .end()
        }, 100)
      })
      .end('apple')
    })
  })
})
