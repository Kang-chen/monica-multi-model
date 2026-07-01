const http = require('http')

function isCdpAlive(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
      let body = ''
      res.on('data', (chunk) => {
        body += chunk
      })
      res.on('end', () => {
        if (res.statusCode !== 200) {
          resolve(false)
          return
        }

        try {
          const payload = JSON.parse(body)
          resolve(typeof payload.webSocketDebuggerUrl === 'string' && payload.webSocketDebuggerUrl.length > 0)
        } catch (err) {
          resolve(false)
        }
      })
    })
    req.on('error', () => resolve(false))
    req.setTimeout(2000, () => {
      req.destroy()
      resolve(false)
    })
  })
}

module.exports = { isCdpAlive }
