import { describe, expect, it } from 'vitest'

const { calculateMatchScore } = await import('../src/services/matching.service.js')

describe('calculateMatchScore', () => {
  it('does not fail when the candidate profile is missing', () => {
    const result = calculateMatchScore({}, { title: 'Backend', skills: [] })
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.missingSkills).toEqual([])
  })

  it('reports missing required skills and gives an empty skill profile a non-zero baseline', () => {
    const result = calculateMatchScore({ skills: [] }, {
      title: 'Backend Engineer',
      skills: [{ skill: { id: 1, name: 'Node.js' }, isRequired: true }]
    })
    expect(result.missingSkills[0].name).toBe('Node.js')
    expect(result.skillScore).toBe(20)
  })

  it('treats a job without salary as negotiable instead of rejecting it', () => {
    const result = calculateMatchScore({ desiredSalary: 5000 }, { title: 'Designer', skills: [] })
    expect(result.salaryScore).toBe(50)
  })

  it('returns a full skill score when the job has no skill requirements', () => {
    expect(calculateMatchScore({}, { skills: [] }).skillScore).toBe(100)
  })
})
