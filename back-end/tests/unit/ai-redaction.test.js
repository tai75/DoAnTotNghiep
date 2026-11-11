import { describe, expect, it, vi } from 'vitest';
const { jobDescriptionInput, redactGeminiContents, redactText, semanticCandidateDocument } = require('../../src/services/aiRedaction.service');
const config = require('../../src/config/env');
const { callGemini } = require('../../src/services/llm.service');
const { runWithAiPermit } = require('../helpers/aiPermitFake');

describe('AI data minimization and redaction', () => {
  it('redacts Vietnamese CV contact and identity data in free text', () => {
    const input = 'Liên hệ: Nguyễn Văn A\nEmail: an.nguyen@example.com\nSĐT: 0901 234 567\nCCCD 079203001234\nNgày sinh 12/05/1998\nĐịa chỉ: 12 Nguyễn Huệ\nhttps://linkedin.com/in/an-nguyen';
    const output = redactText(input, { knownValues: ['Nguyễn Văn A', '12 Nguyễn Huệ'] });
    expect(output).not.toContain('an.nguyen@example.com');
    expect(output).not.toContain('0901 234 567');
    expect(output).not.toContain('079203001234');
    expect(output).not.toContain('12/05/1998');
    expect(output).not.toContain('linkedin.com');
    expect(output).not.toContain('Nguyễn Văn A');
  });

  it('redacts English CV contact details and limits total Gemini text', () => {
    const contents = redactGeminiContents([{ role: 'user', parts: [{ text: `Contact: jane@example.org +84901234567 Address: 1 Main Street ${'x'.repeat(20000)}` }] }]);
    const text = contents[0].parts[0].text;
    expect(text).not.toContain('jane@example.org');
    expect(text).not.toContain('+84901234567');
    expect(text.length).toBeLessThanOrEqual(12000);
  });

  it('allowlists semantic and job-description fields', () => {
    const candidateText = semanticCandidateDocument({
      headline: 'Backend Engineer', bio: 'email secret@example.com', location: 'Private address',
      skills: [{ skill: { name: 'Node.js' } }], experiences: [{ title: 'Developer', company: 'Private Co', description: 'private' }],
      educations: [{ school: 'Private School', major: 'Computer Science' }], projects: [{ technologies: ['PostgreSQL'] }]
    });
    expect(candidateText).toContain('Node.js');
    expect(candidateText).toContain('Computer Science');
    expect(candidateText).not.toContain('secret@example.com');
    expect(candidateText).not.toContain('Private address');
    expect(candidateText).not.toContain('Private Co');

    const job = jobDescriptionInput({ title: 'Engineer', location: 'HCM', idealAnswer: 'secret', screeningQuestions: [{ idealAnswer: 'secret' }], candidateId: 99 });
    expect(job).toEqual({ title: 'Engineer', location: 'HCM' });
  });

  it('redacts the actual mocked Gemini payload before fetch', async () => {
    config.geminiApiKey = 'mock-only-key';
    const fetchImpl = vi.fn(async (_url, options) => {
      const payload = JSON.parse(options.body);
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain('candidate@example.com');
      expect(serialized).not.toContain('0901234567');
      expect(serialized).toContain('[EMAIL]');
      return { ok: true, json: async () => ({ candidates: [] }) };
    });
    await runWithAiPermit('AI_CHAT', () => callGemini([{ role: 'user', parts: [{ text: 'Email candidate@example.com, số điện thoại 0901234567' }] }], [], { fetchImpl, timeoutMs: 100 }));
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
