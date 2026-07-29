const assert = require('assert')
const http = require('http')
const { isCdpAlive, findCdpEndpoint } = require('./cdp-utils')

function withServer(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        port,
        close: () => new Promise((done) => server.close(done)),
      })
    })
    server.on('error', reject)
  })
}

async function testRejectsHttp404() {
  const server = await withServer((req, res) => {
    res.statusCode = 404
    res.end('not found')
  })
  try {
    assert.strictEqual(await isCdpAlive(server.port), false)
  } finally {
    await server.close()
  }
}

async function testRequiresDebuggerUrl() {
  const server = await withServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ Browser: 'Chrome' }))
  })
  try {
    assert.strictEqual(await isCdpAlive(server.port), false)
  } finally {
    await server.close()
  }
}

async function testAcceptsDevToolsVersionResponse() {
  const server = await withServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({
      Browser: 'Chrome/126',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/test',
    }))
  })
  try {
    assert.strictEqual(await isCdpAlive(server.port), true)
    assert.strictEqual(
      await findCdpEndpoint(server.port, '127.0.0.1'),
      `http://127.0.0.1:${server.port}`
    )
  } finally {
    await server.close()
  }
}

(async () => {
  await testRejectsHttp404()
  await testRequiresDebuggerUrl()
  await testAcceptsDevToolsVersionResponse()
  console.log('cdp-utils tests passed')
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
