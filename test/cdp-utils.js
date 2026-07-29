const http = require('http')

function formatCdpHost(host) {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}

function isCdpAlive(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const req = http.get(`http://${formatCdpHost(host)}:${port}/json/version`, (res) => {
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

async function findCdpEndpoint(port, preferredHost) {
  const hosts = [...new Set([preferredHost, '::1', '127.0.0.1'].filter(Boolean))]
  for (const host of hosts) {
    if (await isCdpAlive(port, host)) {
      return `http://${formatCdpHost(host)}:${port}`
    }
  }
  return null
}

module.exports = { isCdpAlive, findCdpEndpoint }
