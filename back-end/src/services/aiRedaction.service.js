const MAX_AI_TEXT_LENGTH = 12000;

const REPLACEMENTS = Object.freeze([
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]'],
  [/(?:\+?84|0)(?:[\s.-]?\d){9,10}\b/g, '[SO_DIEN_THOAI]'],
  [/\b(?:\d[\s.-]?){9,12}\b/g, '[SO_DINH_DANH]'],
  [/\b(?:0?[1-9]|[12]\d|3[01])[\/.\-](?:0?[1-9]|1[0-2])[\/.\-](?:19|20)\d{2}\b/g, '[NGAY_SINH]'],
  [/\b(?:19|20)\d{2}[\/.\-](?:0?[1-9]|1[0-2])[\/.\-](?:0?[1-9]|[12]\d|3[01])\b/g, '[NGAY_SINH]'],
  [/https?:\/\/[^\s)]+|\b(?:linkedin|github|facebook)\.com\/[^\s)]+/gi, '[URL_CA_NHAN]'],
  [/^(?:địa chỉ|dia chi|address|contact|liên hệ|lien he)\s*:\s*.*$/gim, '[THONG_TIN_LIEN_HE]']
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactText(value, { knownValues = [], maxLength = MAX_AI_TEXT_LENGTH } = {}) {
  let text = String(value ?? '').normalize('NFC');
  for (const knownValue of knownValues) {
    const normalized = String(knownValue ?? '').trim();
    if (normalized.length >= 3) text = text.replace(new RegExp(escapeRegExp(normalized), 'gi'), '[DU_LIEU_CA_NHAN]');
  }
  for (const [pattern, replacement] of REPLACEMENTS) text = text.replace(pattern, replacement);
  return text.slice(0, maxLength);
}

function redactGeminiContents(contents, options = {}) {
  let remaining = options.maxLength ?? MAX_AI_TEXT_LENGTH;
  return (Array.isArray(contents) ? contents : []).map((content) => ({
    ...content,
    parts: (content.parts || []).map((part) => {
      if (typeof part.text !== 'string') return part;
      const text = redactText(part.text, { ...options, maxLength: Math.max(0, remaining) });
      remaining -= text.length;
      return { ...part, text };
    })
  }));
}

function semanticCandidateDocument(candidate = {}) {
  const skills = (candidate.skills || []).map((item) => item?.skill?.name || item?.name).filter(Boolean);
  const titles = (candidate.experiences || []).map((item) => item?.title).filter(Boolean);
  const majors = (candidate.educations || []).map((item) => item?.major).filter(Boolean);
  const technologies = (candidate.projects || []).flatMap((item) => Array.isArray(item?.technologies) ? item.technologies : []);
  return redactText([candidate.headline, candidate.desiredPosition, ...skills, ...titles, ...majors, ...technologies].filter(Boolean).join('\n'), { maxLength: 4000 });
}

function semanticJobDocument(job = {}) {
  const skills = (job.skills || []).map((item) => item?.skill?.name || item?.name).filter(Boolean);
  return redactText([job.title, job.employmentType, ...skills].filter(Boolean).join('\n'), { maxLength: 3000 });
}

function jobDescriptionInput(details = {}) {
  const allowed = ['title', 'location', 'employmentType', 'minSalary', 'maxSalary', 'requiredYearsExperience', 'requiredSkills', 'skillIds'];
  return Object.fromEntries(allowed.filter((key) => details[key] !== undefined).map((key) => [key, details[key]]));
}

module.exports = {
  MAX_AI_TEXT_LENGTH,
  jobDescriptionInput,
  redactGeminiContents,
  redactText,
  semanticCandidateDocument,
  semanticJobDocument
};
