const assert = require('assert')
const http = require('http')
const { isCdpAlive, findCdpEndpoint } = require('./cdp-utils')

function withServer(handler, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler)
    server.listen(0, host, () => {
      const { port } = server.address()
      resolve({
        port,
        close: () => new Promise((done) => server.close(done)),
      })
    })
    server.on('error', reject)
  })
}

function devToolsVersionResponse(req, res) {
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({
    Browser: 'Chrome/126',
    webSocketDebuggerUrl: 'ws://localhost/devtools/browser/test',
  }))
}

async function reserveUnusedPort() {
  const server = await withServer((req, res) => res.end('reserved'))
  const { port } = server
  await server.close()
  return port
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
  const server = await withServer(devToolsVersionResponse)
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

async function testFindsIpv6Endpoint() {
  let server
  try {
    server = await withServer(devToolsVersionResponse, '::1')
  } catch (error) {
    if (error?.code === 'EAFNOSUPPORT' || error?.code === 'EADDRNOTAVAIL') {
      console.log('IPv6 loopback unavailable; skipping IPv6 CDP assertion')
      return
    }
    throw error
  }

  try {
    assert.strictEqual(await isCdpAlive(server.port, '::1'), true)
    assert.strictEqual(
      await findCdpEndpoint(server.port, '::1'),
      `http://[::1]:${server.port}`,
    )
  } finally {
    await server.close()
  }
}

async function testReturnsNullWhenCdpIsUnavailable() {
  const unusedPort = await reserveUnusedPort()
  assert.strictEqual(await isCdpAlive(unusedPort), false)
  assert.strictEqual(await findCdpEndpoint(unusedPort, '::1'), null)
}

(async () => {
  await testRejectsHttp404()
  await testRequiresDebuggerUrl()
  await testAcceptsDevToolsVersionResponse()
  await testFindsIpv6Endpoint()
  await testReturnsNullWhenCdpIsUnavailable()
  console.log('cdp-utils tests passed')
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
