const crypto = require('crypto');

const RUBRIC_VERSION = 'matching-relevance-v1.1';
const EXPORTER_VERSION = 'matching-dataset-exporter-v1.1';

const REDACTION_PATTERNS = Object.freeze([
  { name: 'email', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: '[REDACTED_EMAIL]' },
  { name: 'url', pattern: /\b(?:https?:\/\/|www\.)\S+/gi, replacement: '[REDACTED_URL]' },
  { name: 'phone', pattern: /(?<!\w)(?:\+?\d[\d ().-]{7,}\d)(?!\w)/g, replacement: '[REDACTED_PHONE]' }
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function present(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function redactSensitiveText(value) {
  if (!present(value)) return value ?? null;
  return REDACTION_PATTERNS.reduce(
    (text, rule) => text.replace(rule.pattern, rule.replacement),
    String(value)
  );
}

function coarsenLocation(value) {
  if (!present(value)) return null;
  const redacted = redactSensitiveText(value).trim();
  const parts = redacted.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length > 2) return parts.slice(-2).join(', ');
  if (/\d/.test(redacted)) return '[REDACTED_PRECISE_LOCATION]';
  return redacted;
}

function findSensitiveText(value) {
  if (!present(value)) return [];
  return REDACTION_PATTERNS.filter((rule) => {
    rule.pattern.lastIndex = 0;
    return rule.pattern.test(String(value));
  }).map((rule) => rule.name);
}

function candidateSnapshot(candidate) {
  return {
    id: candidate.id,
    updatedAt: candidate.updatedAt,
    isSearchable: candidate.isSearchable,
    headline: candidate.headline,
    bio: candidate.bio,
    location: candidate.location,
    yearsExperience: candidate.yearsExperience === null ? null : Number(candidate.yearsExperience),
    desiredPosition: candidate.desiredPosition,
    desiredSalary: candidate.desiredSalary === null ? null : Number(candidate.desiredSalary),
    desiredLocation: candidate.desiredLocation,
    desiredEmploymentType: candidate.desiredEmploymentType,
    skills: (candidate.skills || []).map((item) => ({ id: item.skill.id, name: item.skill.name, level: item.level || null })).sort((a, b) => a.id - b.id),
    educations: (candidate.educations || []).map((item) => ({ degree: item.degree, major: item.major })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    experiences: (candidate.experiences || []).map((item) => ({ title: item.title, fromDate: item.fromDate, toDate: item.toDate, isCurrent: item.isCurrent })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    projects: (candidate.projects || []).map((item) => ({ technologies: Array.isArray(item.technologies) ? [...item.technologies].sort() : [] })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  };
}

function jobSnapshot(job) {
  return {
    id: job.id,
    updatedAt: job.updatedAt,
    status: job.status,
    deadline: job.deadline,
    title: job.title,
    description: job.description,
    location: job.location,
    employmentType: job.employmentType,
    minSalary: job.minSalary === null ? null : Number(job.minSalary),
    maxSalary: job.maxSalary === null ? null : Number(job.maxSalary),
    requiredYearsExperience: job.requiredYearsExperience === null ? null : Number(job.requiredYearsExperience),
    skills: (job.skills || []).map((item) => ({ id: item.skill.id, name: item.skill.name, isRequired: item.isRequired !== false })).sort((a, b) => a.id - b.id)
  };
}

function candidateFlags(candidate) {
  const semanticDetail = present(candidate.bio) || candidate.experiences.length > 0 || candidate.projects.length > 0 || candidate.educations.length > 0;
  const minimumMatchable = candidate.skills.length > 0 && present(candidate.yearsExperience) && present(candidate.desiredPosition || candidate.headline);
  return {
    searchable: Boolean(candidate.isSearchable),
    skills: candidate.skills.length > 0,
    yearsExperience: present(candidate.yearsExperience),
    desiredPosition: present(candidate.desiredPosition),
    location: present(candidate.desiredLocation || candidate.location),
    salary: present(candidate.desiredSalary),
    employmentType: present(candidate.desiredEmploymentType),
    semanticDetail,
    minimumMatchable,
    benchmarkReady: Boolean(candidate.isSearchable) && minimumMatchable && present(candidate.desiredLocation || candidate.location) && present(candidate.desiredEmploymentType) && semanticDetail
  };
}

function jobFlags(job, snapshotAt) {
  const activePublished = job.status === 'PUBLISHED' && (!job.deadline || new Date(job.deadline) >= snapshotAt);
  const minimumMatchable = activePublished && job.skills.length > 0 && present(job.title) && present(job.description);
  return {
    activePublished,
    skills: job.skills.length > 0,
    requiredYearsExperience: present(job.requiredYearsExperience),
    location: present(job.location),
    salary: present(job.minSalary) || present(job.maxSalary),
    employmentType: present(job.employmentType),
    minimumMatchable,
    benchmarkReady: minimumMatchable && present(job.requiredYearsExperience) && present(job.location) && present(job.employmentType)
  };
}

function completeness(items, flagFunction) {
  if (!items.length) return {};
  const flags = items.map(flagFunction);
  return Object.fromEntries(Object.keys(flags[0]).map((key) => {
    const count = flags.filter((item) => item[key]).length;
    return [key, { count, rate: count / items.length }];
  }));
}

function pairStratum(candidate, job) {
  const candidateSkillIds = new Set(candidate.skills.map((skill) => skill.id));
  const required = job.skills.filter((skill) => skill.isRequired);
  const targetSkills = required.length ? required : job.skills;
  const matched = targetSkills.filter((skill) => candidateSkillIds.has(skill.id)).length;
  const skillBand = !matched ? 'no-skill-overlap' : matched === targetSkills.length ? 'full-skill-overlap' : 'partial-skill-overlap';
  const ratio = job.requiredYearsExperience > 0 ? candidate.yearsExperience / job.requiredYearsExperience : 1;
  const experienceBand = ratio >= 1 ? 'meets-experience' : ratio >= 0.5 ? 'near-experience' : 'large-experience-gap';
  return `${skillBand}|${experienceBand}`;
}

function selectDiversePairs(candidates, jobs, maxJobsPerCandidate, seed) {
  const pairs = [];
  for (const candidate of candidates) {
    const groups = new Map();
    for (const job of jobs) {
      const stratum = pairStratum(candidate, job);
      if (!groups.has(stratum)) groups.set(stratum, []);
      groups.get(stratum).push({ candidate, job, stratum });
    }
    for (const items of groups.values()) {
      items.sort((left, right) => sha256(`${seed}:${candidate.id}:${left.job.id}`).localeCompare(sha256(`${seed}:${candidate.id}:${right.job.id}`)));
    }
    const strata = [...groups.keys()].sort();
    while (pairs.filter((pair) => pair.candidate.id === candidate.id).length < Math.min(maxJobsPerCandidate, jobs.length)) {
      let added = false;
      for (const stratum of strata) {
        const item = groups.get(stratum)?.shift();
        if (item) { pairs.push(item); added = true; }
        if (pairs.filter((pair) => pair.candidate.id === candidate.id).length >= Math.min(maxJobsPerCandidate, jobs.length)) break;
      }
      if (!added) break;
    }
  }
  return pairs;
}

function pseudonym(prefix, id, salt) {
  return `${prefix}-${crypto.createHmac('sha256', salt).update(String(id)).digest('hex').slice(0, 12)}`;
}

function anonymizedCandidate(candidate) {
  return {
    desiredPosition: redactSensitiveText(candidate.desiredPosition),
    yearsExperience: candidate.yearsExperience,
    desiredLocation: coarsenLocation(candidate.desiredLocation || candidate.location),
    desiredSalary: candidate.desiredSalary,
    desiredEmploymentType: candidate.desiredEmploymentType,
    skills: candidate.skills.map(({ name, level }) => ({ name: redactSensitiveText(name), level: redactSensitiveText(level) })),
    experienceTitles: candidate.experiences.map(({ title }) => redactSensitiveText(title)),
    education: candidate.educations.map(({ degree, major }) => ({
      degree: redactSensitiveText(degree), major: redactSensitiveText(major)
    })),
    projectTechnologies: candidate.projects.flatMap(({ technologies }) => technologies).map(redactSensitiveText)
  };
}

function anonymizedJob(job) {
  return {
    title: redactSensitiveText(job.title),
    description: redactSensitiveText(job.description),
    location: coarsenLocation(job.location),
    employmentType: job.employmentType,
    minSalary: job.minSalary,
    maxSalary: job.maxSalary,
    requiredYearsExperience: job.requiredYearsExperience,
    skills: job.skills.map(({ name, isRequired }) => ({ name: redactSensitiveText(name), isRequired }))
  };
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(headers, rows) {
  return `${[headers.join(','), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))].join('\n')}\n`;
}

module.exports = {
  EXPORTER_VERSION,
  RUBRIC_VERSION,
  anonymizedCandidate,
  anonymizedJob,
  candidateFlags,
  candidateSnapshot,
  completeness,
  coarsenLocation,
  findSensitiveText,
  jobFlags,
  jobSnapshot,
  present,
  pseudonym,
  redactSensitiveText,
  selectDiversePairs,
  sha256,
  toCsv
};
