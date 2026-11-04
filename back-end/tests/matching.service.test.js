import { describe, expect, it, vi } from 'vitest'

const { calculateMatchScore, buildRuleExplanation, DEFAULT_V2_WEIGHTS, cosineSimilarity, matchingV2Weights } = await import('../src/services/matching.service.js')

describe('calculateMatchScore', () => {
  it('keeps V1 deterministic and independent from Gemini', () => {
    const fetchMock = vi.spyOn(global, 'fetch')
    const first = calculateMatchScore({ skills: [] }, { title: 'Backend', skills: [] })
    const second = calculateMatchScore({ skills: [] }, { title: 'Backend', skills: [] })

    expect(second).toEqual(first)
    expect(Number.isFinite(first.score)).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

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

  it('scores candidate experience against a job requirement', () => {
    const result = calculateMatchScore({ yearsExperience: 3 }, {
      title: 'Backend Engineer',
      requiredYearsExperience: 5,
      skills: []
    })
    expect(result.experienceScore).toBe(60)
  })

  it('uses the neutral experience baseline when a job has no requirement', () => {
    const result = calculateMatchScore({}, { title: 'Backend Engineer', skills: [] })
    expect(result.experienceScore).toBe(50)
  })

  it('returns a full skill score when the job has no skill requirements', () => {
    expect(calculateMatchScore({}, { skills: [] }).skillScore).toBe(100)
  })

  it('provides a deterministic fallback explanation from match data', () => {
    const result = calculateMatchScore({ skills: [{ skill: { id: 1, name: 'Node.js' } }] }, {
      title: 'Backend Engineer',
      skills: [
        { skill: { id: 1, name: 'Node.js' }, isRequired: true },
        { skill: { id: 2, name: 'PostgreSQL' }, isRequired: true }
      ]
    })
    expect(buildRuleExplanation(result)).toContain('Khớp kỹ năng: Node.js.')
    expect(buildRuleExplanation(result)).toContain('Cần bổ sung: PostgreSQL.')
  })

  it('keeps weighted-v2 weights non-negative and normalized', () => {
    expect(Object.values(DEFAULT_V2_WEIGHTS).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1)
    expect(Object.values(matchingV2Weights()).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1)
  })

  it('calculates bounded cosine similarity for embeddings', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0)
  })

  it('rejects invalid and zero embeddings instead of returning a misleading zero', () => {
    expect(() => cosineSimilarity([0, 0], [1, 0])).toThrow('zero vector')
    expect(() => cosineSimilarity([1, Number.NaN], [1, 0])).toThrow('số hữu hạn')
    expect(() => cosineSimilarity([1], [1, 0])).toThrow('cùng số chiều')
  })

  it('keeps cosine similarity finite when finite vector components would overflow naive dot products', () => {
    const veryLarge = Number.MAX_VALUE / 2
    const similarity = cosineSimilarity([veryLarge, veryLarge], [veryLarge, veryLarge])

    expect(similarity).toBeCloseTo(1, 12)
    expect(Number.isFinite(similarity)).toBe(true)
  })

  it('distinguishes missing numeric data from malformed numeric data', () => {
    expect(calculateMatchScore({ yearsExperience: null }, { requiredYearsExperience: 2, skills: [] }).experienceScore).toBe(0)
    expect(() => calculateMatchScore({ yearsExperience: 'unknown' }, { requiredYearsExperience: 2, skills: [] })).toThrow('số hữu hạn')
    expect(() => calculateMatchScore({ desiredSalary: -1 }, { minSalary: 100, skills: [] })).toThrow('không âm')
  })

  it('handles zero requirements without division by zero and keeps the full breakdown finite', () => {
    const result = calculateMatchScore({ yearsExperience: 0, desiredSalary: 0, skills: null }, {
      requiredYearsExperience: 0, minSalary: 0, maxSalary: 0, skills: undefined
    })
    expect([
      result.score, result.skillScore, result.experienceScore, result.positionScore,
      result.locationScore, result.salaryScore, result.employmentScore
    ].every((value) => Number.isFinite(value) && value >= 0 && value <= 100)).toBe(true)
  })
})
