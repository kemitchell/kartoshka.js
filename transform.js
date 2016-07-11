module.exports = function (entry, _, done) {
  if ('key' in entry && 'value' in entry) {
    this.push({type: 'put', key: entry.key, value: entry.value})
  }
  done()
}
