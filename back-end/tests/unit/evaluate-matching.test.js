import { describe, expect, it } from 'vitest'

const { parseCsv, rankingMetrics } = await import('../../scripts/evaluate-matching.js')

describe('matching evaluation metrics', () => {
  it('parses quoted CSV fields without splitting embedded commas', () => {
    expect(parseCsv('candidate_id,notes\n1,"Node.js, SQL"\n')).toEqual([
      ['candidate_id', 'notes'],
      ['1', 'Node.js, SQL']
    ])
  })

  it('computes macro Precision, Recall and NDCG at K per candidate query', () => {
    const rows = [
      { candidateId: 1, jobId: 1, relevance: 3, score: 0.9 },
      { candidateId: 1, jobId: 2, relevance: 0, score: 0.8 },
      { candidateId: 1, jobId: 3, relevance: 1, score: 0.7 },
      { candidateId: 2, jobId: 1, relevance: 0, score: 0.9 },
      { candidateId: 2, jobId: 2, relevance: 2, score: 0.8 }
    ]
    const result = rankingMetrics(rows, 'score', [1, 2], 1)
    expect(result.macro.precisionAt1).toBe(0.5)
    expect(result.macro.recallAt1).toBe(0.25)
    expect(result.macro.precisionAt2).toBe(0.5)
    expect(result.macro.recallAt2).toBe(0.75)
    expect(result.macro.ndcgAt1).toBe(0.5)
  })
})
