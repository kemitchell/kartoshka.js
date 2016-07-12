var LevelBatchStream = require('level-batch-stream')
var migrateVersionedLog = require('migrate-versioned-log')
var migrations = require('./migrations')
var pump = require('pump')
var through2 = require('through2')
var entryToLevelUPBatch = require('./transform')
var uuid = require('uuid').v4

var version = require('./package.json').version

module.exports = function (serverLog, level, dataLog) {
  pump(
    dataLog.readStream,
    through2.obj(function pullOutVersion (chunk, _, done) {
      var entry = chunk.entry
      var version = entry.version
      delete entry.version
      done(null, {index: chunk.index, version: version, entry: entry})
    }),
    migrateVersionedLog(migrations),
    through2.obj(function logMigrated (chunk, _, done) {
      serverLog.info({event: 'migrated'}, chunk)
      done(null, chunk.entry)
    }),
    through2.obj(entryToLevelUPBatch),
    new LevelBatchStream(level)
  )

  return function (request, response) {
    request.log = serverLog.child({request: uuid()})
    request.on('end', function () {
      request.log.info({event: 'end', status: response.statusCode})
    })
    if (request.method === 'POST') {
      var buffer = []
      request
      .on('data', function (chunk) { buffer.push(chunk) })
      .once('error', function (error) {
        request.log.error(error)
        response.destroy()
      })
      .once('end', function () {
        var body = Buffer.concat(buffer).toString()
        var entry = {version: version, key: 'x', value: body}
        dataLog.write(entry, function (error) {
          if (error) {
            response.statusCode = 500 // Internal Server Error
            response.end()
          } else {
            response.statusCode = 202 // Accepted
            response.end()
          }
        })
      })
    } else if (request.method === 'GET') {
      level.get('x', function (error, value) {
        if (error) {
          if (error.notFound) {
            response.statusCode = 404 // Not Found
            response.end()
          } else {
            response.statusCode = 500 // Internal Server Error
            response.end()
          }
        } else {
          response.statusCode = 200 // OK
          response.setHeader('Content-Type', 'application/json')
          response.end(value)
        }
      })
    } else {
      response.statusCode = 405 // Method Not Allowed
      response.end()
    }
  }
}
