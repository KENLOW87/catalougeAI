import assert from 'node:assert/strict'
// Compatibility fixtures for already-validated local operations. This mock
// exercises UI execution, not model understanding; opt-in live checks test that.
export async function mockKnownCommandInterpret(request) {
  if (!/\/api\/(?:interpret|ai\/status)$/.test(request.url())) return false
  const headers = { 'Access-Control-Allow-Origin': 'http://localhost:5173', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-Activity-Job-ID,X-Activity-Origin' }
  if (request.method() === 'OPTIONS') { await request.respond({ status: 204, headers }); return true }
  if (/\/ai\/status$/.test(request.url())) {
    await request.respond({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ ready: true, openai: true }) }); return true
  }
  const payload = JSON.parse(request.postData())
  assert.ok(!request.postData().includes('data:image'), 'Text interpretation must not receive image data')
  await request.respond({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ kind: 'command', text: payload.text }) })
  return true
}
