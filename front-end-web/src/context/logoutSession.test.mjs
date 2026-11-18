import assert from 'node:assert/strict'
import test from 'node:test'
import { endCurrentSession } from './logoutSession.js'

test('clears local authentication only after server-confirmed logout', async () => {
  let cleared = false
  const result = await endCurrentSession({
    hasSession: true,
    logoutRequest: async () => {},
    clearSession: () => { cleared = true }
  })
  assert.deepEqual(result, { ok: true, kind: 'server' })
  assert.equal(cleared, true)
})

test('keeps local authentication and identifies network logout failures', async () => {
  let cleared = false
  const error = Object.assign(new Error('offline'), { isNetworkError: true })
  const result = await endCurrentSession({
    hasSession: true,
    logoutRequest: async () => { throw error },
    clearSession: () => { cleared = true }
  })
  assert.equal(result.ok, false)
  assert.equal(result.kind, 'network')
  assert.equal(result.error, error)
  assert.equal(cleared, false)
})

test('keeps local authentication and identifies server logout failures', async () => {
  let cleared = false
  const error = Object.assign(new Error('server error'), { status: 500 })
  const result = await endCurrentSession({
    hasSession: true,
    logoutRequest: async () => { throw error },
    clearSession: () => { cleared = true }
  })
  assert.equal(result.ok, false)
  assert.equal(result.kind, 'server')
  assert.equal(cleared, false)
})
