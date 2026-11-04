import { describe, expect, it } from 'vitest'

const {
  anonymizedCandidate, anonymizedJob, candidateFlags, jobFlags, selectDiversePairs, sha256
} = await import('../../scripts/lib/matching-evaluation-data.js')
const { interRaterAgreement, validRelevance } = await import('../../scripts/prepare-matching-benchmark.js')

function candidate(overrides = {}) {
  return {
    id: 1, isSearchable: true, headline: null, bio: 'Backend profile', location: 'HCM',
    yearsExperience: 3, desiredPosition: 'Backend Engineer', desiredSalary: null,
    desiredLocation: 'HCM', desiredEmploymentType: 'FULL_TIME',
    skills: [{ id: 1, name: 'Node.js', level: null }], educations: [],
    experiences: [{ title: 'Developer', fromDate: null, toDate: null, isCurrent: true }],
    projects: [], ...overrides
  }
}

function job(id, skillIds, overrides = {}) {
  return {
    id, status: 'PUBLISHED', deadline: null, title: 'Engineer', description: 'A sufficiently detailed job description',
    location: 'HCM', employmentType: 'FULL_TIME', minSalary: null, maxSalary: null,
    requiredYearsExperience: 2,
    skills: skillIds.map((skillId) => ({ id: skillId, name: `Skill ${skillId}`, isRequired: true })),
    ...overrides
  }
}

describe('matching evaluation dataset utilities', () => {
  it('separates minimum matchability from benchmark readiness', () => {
    expect(candidateFlags(candidate()).benchmarkReady).toBe(true)
    expect(candidateFlags(candidate({ desiredEmploymentType: null })).minimumMatchable).toBe(true)
    expect(candidateFlags(candidate({ desiredEmploymentType: null })).benchmarkReady).toBe(false)
    expect(jobFlags(job(1, [1]), new Date()).benchmarkReady).toBe(true)
    expect(jobFlags(job(1, [1], { requiredYearsExperience: null }), new Date()).minimumMatchable).toBe(true)
    expect(jobFlags(job(1, [1], { requiredYearsExperience: null }), new Date()).benchmarkReady).toBe(false)
  })

  it('creates diverse pairs without consuming model scores', () => {
    const sourceCandidate = candidate({ skills: [{ id: 1, name: 'Node.js' }, { id: 2, name: 'SQL' }] })
    const jobs = [job(1, [9]), job(2, [1, 9]), job(3, [1, 2])]
    const pairs = selectDiversePairs([sourceCandidate], jobs, 3, 'snapshot-seed')

    expect(pairs.map((pair) => pair.stratum).sort()).toEqual([
      'full-skill-overlap|meets-experience', 'no-skill-overlap|meets-experience', 'partial-skill-overlap|meets-experience'
    ])
    expect(pairs.every((pair) => !('score' in pair))).toBe(true)
  })

  it('uses optional skills for sampling when a job has no required skill', () => {
    const sourceCandidate = candidate({ skills: [{ id: 1, name: 'Node.js' }] })
    const optionalOnly = job(1, [1], { skills: [{ id: 1, name: 'Node.js', isRequired: false }] })

    expect(selectDiversePairs([sourceCandidate], [optionalOnly], 1, 'seed')[0].stratum)
      .toBe('full-skill-overlap|meets-experience')
  })

  it('removes direct identifiers and sensitive free text from evaluator profile', () => {
    const output = anonymizedCandidate(candidate({
      id: 99, bio: 'Name and email', projects: [{ name: 'Secret', link: 'https://private', technologies: ['Node.js'] }]
    }))
    const serialized = JSON.stringify(output)

    expect(serialized).not.toContain('Name and email')
    expect(serialized).not.toContain('https://private')
    expect(output).not.toHaveProperty('id')
    expect(output.projectTechnologies).toEqual(['Node.js'])
    expect(sha256(serialized)).toHaveLength(64)
  })

  it('redacts contact details and precise locations from evaluator-visible fields', () => {
    const candidateOutput = anonymizedCandidate(candidate({ desiredLocation: '12 Nguyen Hue, District 1, HCM' }))
    const jobOutput = anonymizedJob(job(1, [1], {
      description: 'Contact recruiter@example.com, +84 912 345 678 or https://example.com/apply',
      location: '100 Main Street, District 3, HCM'
    }))
    const serialized = JSON.stringify({ candidateOutput, jobOutput })

    expect(candidateOutput.desiredLocation).toBe('District 1, HCM')
    expect(jobOutput.location).toBe('District 3, HCM')
    expect(serialized).not.toContain('recruiter@example.com')
    expect(serialized).not.toContain('+84 912 345 678')
    expect(serialized).not.toContain('https://example.com/apply')
  })

  it('does not coerce an empty human label into relevance zero', () => {
    expect(validRelevance('')).toBe(false)
    expect(validRelevance('0')).toBe(true)
    expect(validRelevance('3')).toBe(true)
    expect(validRelevance('4')).toBe(false)
  })

  it('computes perfect and imperfect inter-rater agreement from human labels', () => {
    const perfect = interRaterAgreement([0, 1, 2, 3].map((grade) => ({ relevance_1: String(grade), relevance_2: String(grade) })))
    const imperfect = interRaterAgreement([
      { relevance_1: '0', relevance_2: '1' }, { relevance_1: '1', relevance_2: '1' },
      { relevance_1: '2', relevance_2: '3' }, { relevance_1: '3', relevance_2: '2' }
    ])

    expect(perfect.quadraticWeightedKappa).toBe(1)
    expect(perfect.exactAgreement).toBe(1)
    expect(imperfect.quadraticWeightedKappa).toBeLessThan(1)
    expect(imperfect.disagreementCount).toBe(3)
  })
})
