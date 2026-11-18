import assert from 'node:assert/strict'
import test from 'node:test'
import { getPostAuthDestination } from './authRedirect.js'

test('login without returnTo uses each role home', () => {
  assert.equal(getPostAuthDestination('CANDIDATE'), '/jobs')
  assert.equal(getPostAuthDestination('RECRUITER'), '/recruiter')
  assert.equal(getPostAuthDestination('ADMIN'), '/admin')
})

test('valid internal returnTo preserves path, query and hash', () => {
  assert.equal(getPostAuthDestination('CANDIDATE', '/jobs/42?sort=newest#details'), '/jobs/42?sort=newest#details')
  assert.equal(getPostAuthDestination('RECRUITER', '/recruiter/interviews/4'), '/recruiter/interviews/4')
  assert.equal(getPostAuthDestination('ADMIN', '/admin?section=reports'), '/admin?section=reports')
})

test('wrong role and unknown routes fall back to role home', () => {
  assert.equal(getPostAuthDestination('CANDIDATE', '/admin'), '/jobs')
  assert.equal(getPostAuthDestination('ADMIN', '/recruiter/talent'), '/admin')
  assert.equal(getPostAuthDestination('RECRUITER', '/my-jobs'), '/recruiter')
  assert.equal(getPostAuthDestination('CANDIDATE', '/missing'), '/jobs')
})

test('external and auth-loop destinations are rejected', () => {
  for (const destination of ['https://example.com', '//example.com', '/\\example.com', '/login', '/register', '/forgot-password']) {
    assert.equal(getPostAuthDestination('ADMIN', destination), '/admin')
  }
})

test('restored session uses the same destination and does not loop', () => {
  assert.equal(getPostAuthDestination('RECRUITER', '/login?returnTo=%2Flogin'), '/recruiter')
  assert.equal(getPostAuthDestination('CANDIDATE', '/applications'), '/applications')
})
