const DEFAULT_WEIGHTS = Object.freeze({
  skill: 0.5,
  experience: 0.2,
  position: 0.1,
  location: 0.1,
  salary: 0.05,
  employment: 0.05
});

function numberValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

function tokens(value) {
  return normalize(value).split(/[^a-z0-9À-ỹ]+/i).filter(Boolean);
}

function skillEntries(items = []) {
  return items.map((item) => {
    const skill = item.skill || item;
    return { id: skill.id, name: skill.name || item.name, key: normalize(skill.name || item.name), isRequired: item.isRequired !== false };
  }).filter((item) => item.key);
}

function scoreSkills(candidate, job) {
  const candidateSkills = new Set(skillEntries(candidate.skills).map((skill) => skill.id || skill.key));
  const required = skillEntries(job.skills).filter((skill) => skill.isRequired);
  const optional = skillEntries(job.skills).filter((skill) => !skill.isRequired);
  const matchedSkills = [...required, ...optional].filter((skill) => candidateSkills.has(skill.id || skill.key));
  const missingSkills = required.filter((skill) => !candidateSkills.has(skill.id || skill.key));
  if (!required.length && !optional.length) return { score: 100, matchedSkills, missingSkills };
  const requiredRate = required.length ? matchedSkills.filter((skill) => skill.isRequired).length / required.length : 1;
  const optionalRate = optional.length ? matchedSkills.filter((skill) => !skill.isRequired).length / optional.length : 1;
  return { score: 100 * (0.8 * requiredRate + 0.2 * optionalRate), matchedSkills, missingSkills };
}

function scoreExperience(candidate, job) {
  const years = numberValue(candidate.yearsExperience);
  const requiredYears = numberValue(job.requiredYearsExperience ?? job.requiredExperienceYears);
  if (requiredYears && requiredYears > 0) return years === null ? 0 : Math.min(100, 100 * years / requiredYears);
  return years === null ? 50 : 100;
}

function scorePosition(candidate, job) {
  const desired = tokens(candidate.desiredPosition);
  const title = tokens(job.title);
  if (!desired.length) return 50;
  if (!title.length) return 0;
  if (normalize(candidate.desiredPosition) === normalize(job.title)) return 100;
  return 100 * desired.filter((token) => title.includes(token)).length / desired.length;
}

function scoreLocation(candidate, job) {
  const desired = normalize(candidate.desiredLocation || candidate.location);
  const location = normalize(job.location);
  if (!desired || !location) return 50;
  if (desired === location || desired.includes(location) || location.includes(desired)) return 100;
  if (desired.includes('remote') || location.includes('remote')) return 100;
  return 0;
}

function scoreSalary(candidate, job) {
  const desired = numberValue(candidate.desiredSalary);
  const min = numberValue(job.minSalary);
  const max = numberValue(job.maxSalary);
  if (desired === null || (min === null && max === null)) return 50;
  if (min !== null && desired < min) return Math.max(0, Math.min(100, 100 * desired / min));
  return 100;
}

function scoreEmployment(candidate, job) {
  if (!candidate.desiredEmploymentType || !job.employmentType) return 50;
  return candidate.desiredEmploymentType === job.employmentType ? 100 : 0;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function calculateMatchScore(candidate = {}, job = {}, weights = DEFAULT_WEIGHTS) {
  const skill = scoreSkills(candidate, job);
  const components = {
    skillScore: skill.score,
    experienceScore: scoreExperience(candidate, job),
    positionScore: scorePosition(candidate, job),
    locationScore: scoreLocation(candidate, job),
    salaryScore: scoreSalary(candidate, job),
    employmentScore: scoreEmployment(candidate, job)
  };
  const score = Object.entries(weights).reduce((total, [key, weight]) => total + components[`${key}Score`] * weight, 0);
  return {
    score: round(Math.max(0, Math.min(100, score))),
    ...Object.fromEntries(Object.entries(components).map(([key, value]) => [key, round(Math.max(0, Math.min(100, value)))])),
    matchedSkills: skill.matchedSkills,
    missingSkills: skill.missingSkills
  };
}

function buildRuleExplanation(result) {
  const matched = result.matchedSkills.length ? `Khớp kỹ năng: ${result.matchedSkills.map((item) => item.name).join(', ')}.` : 'Chưa khớp kỹ năng nào.';
  const missing = result.missingSkills.length ? ` Cần bổ sung: ${result.missingSkills.map((item) => item.name).join(', ')}.` : ' Không thiếu kỹ năng bắt buộc.';
  return `${matched}${missing}`;
}

module.exports = { DEFAULT_WEIGHTS, calculateMatchScore, buildRuleExplanation };
