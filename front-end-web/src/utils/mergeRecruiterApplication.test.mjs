import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeRecruiterApplication } from './mergeRecruiterApplication.js'

const current = {
  id: 1,
  status: 'APPLIED',
  candidate: {
    headline: 'Kỹ sư phần mềm',
    skills: [{ skill: { id: 7, name: 'React' } }],
    user: { id: 1, fullName: 'Ứng viên', email: 'candidate@example.invalid' }
  }
}

test('keeps loaded candidate details when a status response is partial', () => {
  const updated = mergeRecruiterApplication(current, {
    id: 1,
    status: 'REVIEWING',
    candidate: { user: { id: 1, email: 'candidate@example.invalid' } }
  })

  assert.equal(updated.status, 'REVIEWING')
  assert.equal(updated.candidate.user.fullName, 'Ứng viên')
  assert.deepEqual(updated.candidate.skills, current.candidate.skills)
  assert.equal(updated.candidate.headline, current.candidate.headline)
})

test('accepts a complete replacement skill list and handles absent skills', () => {
  const nextSkills = [{ skill: { id: 8, name: 'Node.js' } }]
  assert.deepEqual(mergeRecruiterApplication(current, { candidate: { skills: nextSkills } }).candidate.skills, nextSkills)
  assert.deepEqual(mergeRecruiterApplication({ ...current, candidate: { user: current.candidate.user } }, { candidate: { skills: null } }).candidate.skills, [])
})
