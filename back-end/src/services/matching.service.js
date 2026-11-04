const crypto = require('crypto');
const config = require('../config/env');
const { embeddingForV3, embeddingV3Config } = require('./embedding.service');

const DEFAULT_WEIGHTS = Object.freeze({
  skill: 0.5,
  experience: 0.2,
  position: 0.1,
  location: 0.1,
  salary: 0.05,
  employment: 0.05
});
const DEFAULT_V2_WEIGHTS = Object.freeze({
  skill: 0.4,
  experience: 0.15,
  position: 0.1,
  location: 0.05,
  salary: 0.05,
  employment: 0.05,
  semantic: 0.2
});
const ALGORITHM_V2 = 'weighted-v2';
const ALGORITHM_V3 = 'weighted-v3-ge2-768-sts-prefix-v1';
const V1_COMPONENTS = Object.freeze(['skill', 'experience', 'position', 'location', 'salary', 'employment']);
const V2_COMPONENTS = Object.freeze([...V1_COMPONENTS, 'semantic']);

class MatchingVersionDisabledError extends Error {
  constructor(version) {
    super(`Matching ${version.toUpperCase()} is disabled`);
    this.name = 'MatchingVersionDisabledError';
    this.code = 'matching_version_disabled';
    this.statusCode = 410;
    this.version = version;
  }
}

function matchingVersionEnabled(version) {
  if (version === 'v1') return true;
  if (version === 'v2') return config.matchingV2Enabled === true;
  if (version === 'v3') return config.matchingV3Enabled === true;
  return false;
}

function assertMatchingVersionEnabled(version, enabledOverride) {
  const enabled = enabledOverride === undefined ? matchingVersionEnabled(version) : enabledOverride === true;
  if (!enabled) throw new MatchingVersionDisabledError(version);
}

function validateWeights(weights, components, label) {
  if (!weights || typeof weights !== 'object' || Array.isArray(weights)) throw new Error(`${label} phải là object`);
  const unknown = Object.keys(weights).filter((key) => !components.includes(key));
  const missing = components.filter((key) => !(key in weights));
  if (unknown.length || missing.length) {
    throw new Error(`${label} không đúng thành phần (thừa: ${unknown.join(', ') || 'không'}; thiếu: ${missing.join(', ') || 'không'})`);
  }
  const normalized = Object.fromEntries(components.map((key) => [key, Number(weights[key])]));
  const total = Object.values(normalized).reduce((sum, value) => sum + value, 0);
  if (Object.values(normalized).some((value) => !Number.isFinite(value) || value < 0) || Math.abs(total - 1) > 0.0001) {
    throw new Error(`${label} phải không âm và có tổng bằng 1`);
  }
  return normalized;
}

function matchingV2Weights() {
  let weights = DEFAULT_V2_WEIGHTS;
  if (config.matchingV2Weights) {
    try { weights = { ...DEFAULT_V2_WEIGHTS, ...JSON.parse(config.matchingV2Weights) }; } catch (error) {
      throw new Error('MATCHING_V2_WEIGHTS phải là JSON hợp lệ');
    }
  }
  return validateWeights(weights, V2_COMPONENTS, 'Trọng số matching-v2');
}

function numberValue(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean' || Array.isArray(value)) throw new Error(`${fieldName} không phải số hợp lệ`);
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${fieldName} phải là số hữu hạn không âm`);
  return number;
}

function arrayValue(value, fieldName) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${fieldName} phải là mảng`);
  return value;
}

function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

function tokens(value) {
  return normalize(value).split(/[^a-z0-9À-ỹ]+/i).filter(Boolean);
}

function skillEntries(items, fieldName = 'skills') {
  return arrayValue(items, fieldName).map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${fieldName}[${index}] không hợp lệ`);
    const skill = item.skill ?? item;
    if (!skill || typeof skill !== 'object' || Array.isArray(skill)) throw new Error(`${fieldName}[${index}].skill không hợp lệ`);
    const name = skill.name || item.name;
    const key = normalize(name);
    if (!key) throw new Error(`${fieldName}[${index}] thiếu tên kỹ năng`);
    return { id: skill.id, name, key, isRequired: item.isRequired !== false };
  });
}

function scoreSkills(candidate, job) {
  const candidateSkills = new Set(skillEntries(candidate.skills, 'candidate.skills').map((skill) => skill.id || skill.key));
  const required = skillEntries(job.skills, 'job.skills').filter((skill) => skill.isRequired);
  const optional = skillEntries(job.skills, 'job.skills').filter((skill) => !skill.isRequired);
  const matchedSkills = [...required, ...optional].filter((skill) => candidateSkills.has(skill.id || skill.key));
  const missingSkills = required.filter((skill) => !candidateSkills.has(skill.id || skill.key));
  if (!required.length && !optional.length) return { score: 100, matchedSkills, missingSkills };
  const requiredRate = required.length ? matchedSkills.filter((skill) => skill.isRequired).length / required.length : 1;
  const optionalRate = optional.length ? matchedSkills.filter((skill) => !skill.isRequired).length / optional.length : 1;
  return { score: 100 * (0.8 * requiredRate + 0.2 * optionalRate), matchedSkills, missingSkills };
}

function scoreExperience(candidate, job) {
  const years = numberValue(candidate.yearsExperience, 'candidate.yearsExperience');
  const requiredYears = numberValue(job.requiredYearsExperience ?? job.requiredExperienceYears, 'job.requiredYearsExperience');
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
  const desired = numberValue(candidate.desiredSalary, 'candidate.desiredSalary');
  const min = numberValue(job.minSalary, 'job.minSalary');
  const max = numberValue(job.maxSalary, 'job.maxSalary');
  if (desired === null || (min === null && max === null)) return 50;
  if (min !== null && desired < min) return Math.max(0, Math.min(100, 100 * desired / min));
  return 100;
}

function scoreEmployment(candidate, job) {
  if (!candidate.desiredEmploymentType || !job.employmentType) return 50;
  return candidate.desiredEmploymentType === job.employmentType ? 100 : 0;
}

function round(value, fieldName = 'score') {
  if (!Number.isFinite(value)) throw new Error(`${fieldName} phải là số hữu hạn`);
  return Math.round(value * 100) / 100;
}

function boundedScore(value, fieldName) {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(`${fieldName} phải là số hữu hạn trong miền [0, 100]`);
  return round(value, fieldName);
}

function weightedScore(scores, weights, components, label) {
  const normalizedWeights = validateWeights(weights, components, `${label} weights`);
  const total = components.reduce((sum, component) => {
    const fieldName = `${component}Score`;
    return sum + boundedScore(scores[fieldName], fieldName) * normalizedWeights[component];
  }, 0);
  return boundedScore(total, `${label} score`);
}

function calculateMatchScore(candidate = {}, job = {}, weights = DEFAULT_WEIGHTS) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('candidate phải là object');
  if (!job || typeof job !== 'object' || Array.isArray(job)) throw new Error('job phải là object');
  const skill = scoreSkills(candidate, job);
  const components = {
    skillScore: skill.score,
    experienceScore: scoreExperience(candidate, job),
    positionScore: scorePosition(candidate, job),
    locationScore: scoreLocation(candidate, job),
    salaryScore: scoreSalary(candidate, job),
    employmentScore: scoreEmployment(candidate, job)
  };
  const normalizedComponents = Object.fromEntries(Object.entries(components).map(([key, value]) => [key, boundedScore(value, key)]));
  const score = weightedScore(normalizedComponents, weights, V1_COMPONENTS, 'matching-v1');
  return {
    score,
    ...normalizedComponents,
    matchedSkills: skill.matchedSkills,
    missingSkills: skill.missingSkills
  };
}

function buildRuleExplanation(result) {
  const matched = result.matchedSkills.length ? `Khớp kỹ năng: ${result.matchedSkills.map((item) => item.name).join(', ')}.` : 'Chưa khớp kỹ năng nào.';
  const missing = result.missingSkills.length ? ` Cần bổ sung: ${result.missingSkills.map((item) => item.name).join(', ')}.` : ' Không thiếu kỹ năng bắt buộc.';
  return `${matched}${missing}`;
}

function profileText(candidate = {}) {
  const skills = skillEntries(candidate.skills, 'candidate.skills').map((skill) => skill.name).join(', ');
  const education = arrayValue(candidate.educations, 'candidate.educations').map((item) => `${item.school} ${item.major || ''} ${item.degree || ''}`).join('; ');
  const experience = arrayValue(candidate.experiences, 'candidate.experiences').map((item) => `${item.title} ${item.company} ${item.description || ''}`).join('; ');
  const projects = arrayValue(candidate.projects, 'candidate.projects').map((item, index) => `${item.name} ${item.description || ''} ${arrayValue(item.technologies, `candidate.projects[${index}].technologies`).join(' ')}`).join('; ');
  return [candidate.headline, candidate.bio, candidate.desiredPosition, skills, education, experience, projects].filter(Boolean).join('\n');
}

function jobText(job = {}) {
  return [job.title, job.description, job.location, skillEntries(job.skills, 'job.skills').map((skill) => skill.name).join(', ')].filter(Boolean).join('\n');
}

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || !left.length || !right.length) throw new Error('Embedding phải là mảng không rỗng');
  if (left.length !== right.length) throw new Error('Hai embedding phải có cùng số chiều');
  if ([...left, ...right].some((value) => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Embedding phải chỉ chứa số hữu hạn');
  const size = left.length;
  let leftScale = 0;
  let rightScale = 0;
  for (let index = 0; index < size; index += 1) {
    leftScale = Math.max(leftScale, Math.abs(left[index]));
    rightScale = Math.max(rightScale, Math.abs(right[index]));
  }
  if (!leftScale || !rightScale) throw new Error('Không thể tính cosine similarity cho zero vector');
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < size; index += 1) {
    const scaledLeft = left[index] / leftScale;
    const scaledRight = right[index] / rightScale;
    dot += scaledLeft * scaledRight;
    leftNorm += scaledLeft ** 2;
    rightNorm += scaledRight ** 2;
  }
  const similarity = dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
  if (!Number.isFinite(similarity)) throw new Error('Cosine similarity không hữu hạn');
  return Math.max(0, Math.min(1, similarity));
}

function validateEmbedding(vector) {
  if (!Array.isArray(vector) || !vector.length || vector.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error('Gemini embedding phải là mảng số hữu hạn không rỗng');
  }
  if (vector.every((value) => value === 0)) throw new Error('Gemini embedding không được là zero vector');
  return vector;
}

async function embeddingFor(text, prismaClient) {
  if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY chưa được cấu hình cho matching-v2');
  const contentHash = crypto.createHash('sha256').update(`${config.geminiEmbeddingModel}\n${text}`).digest('hex');
  const cached = await prismaClient.embeddingCache.findUnique({ where: { contentHash } });
  if (cached) {
    if (cached.model && cached.model !== config.geminiEmbeddingModel) throw new Error('Embedding cache không khớp model hiện hành');
    return validateEmbedding(cached.vector);
  }
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.geminiEmbeddingModel}:embedContent?key=${encodeURIComponent(config.geminiApiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: `models/${config.geminiEmbeddingModel}`, content: { parts: [{ text }] } })
  });
  if (!response.ok) throw new Error(`Gemini embedding request failed: ${response.status}`);
  const payload = await response.json();
  const vector = validateEmbedding(payload?.embedding?.values);
  await prismaClient.embeddingCache.upsert({
    where: { contentHash },
    create: { contentHash, vector, model: config.geminiEmbeddingModel },
    update: { vector, model: config.geminiEmbeddingModel }
  });
  return vector;
}

async function calculateWeightedV2(candidate, job, prismaClient, dependencies = {}) {
  assertMatchingVersionEnabled('v2', dependencies.versionEnabled);
  const weights = matchingV2Weights();
  const v1 = calculateMatchScore(candidate, job);
  const [candidateVector, jobVector] = await Promise.all([
    embeddingFor(profileText(candidate), prismaClient),
    embeddingFor(jobText(job), prismaClient)
  ]);
  const semanticScore = boundedScore(cosineSimilarity(candidateVector, jobVector) * 100, 'semanticScore');
  const score = weightedScore({
    skillScore: v1.skillScore,
    experienceScore: v1.experienceScore,
    positionScore: v1.positionScore,
    locationScore: v1.locationScore,
    salaryScore: v1.salaryScore,
    employmentScore: v1.employmentScore,
    semanticScore
  }, weights, V2_COMPONENTS, 'matching-v2');
  return {
    ...v1,
    semanticScore,
    score,
    algorithmVersion: ALGORITHM_V2,
    weights
  };
}

function matchingV3AlgorithmVersion(embeddingConfig, weights) {
  const usesDefaultContract = embeddingConfig.model === 'gemini-embedding-2'
    && embeddingConfig.modelVersion === 'gemini-embedding-2'
    && embeddingConfig.taskInstruction === 'task: sentence similarity | query: '
    && embeddingConfig.outputDimensionality === 768
    && embeddingConfig.autoTruncate === false
    && V2_COMPONENTS.every((component) => weights[component] === DEFAULT_V2_WEIGHTS[component]);
  if (usesDefaultContract) return ALGORITHM_V3;
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    model: embeddingConfig.model,
    modelVersion: embeddingConfig.modelVersion,
    taskInstruction: embeddingConfig.taskInstruction,
    outputDimensionality: embeddingConfig.outputDimensionality,
    autoTruncate: embeddingConfig.autoTruncate,
    weights
  })).digest('hex').slice(0, 12);
  return `weighted-v3-custom-${fingerprint}`;
}

async function calculateWeightedV3(candidate, job, prismaClient, dependencies = {}) {
  const v1 = calculateMatchScore(candidate, job);
  const weights = matchingV2Weights();
  const v3Enabled = dependencies.versionEnabled === undefined
    ? matchingVersionEnabled('v3')
    : dependencies.versionEnabled === true;
  if (!v3Enabled) {
    return {
      ...v1,
      semanticScore: null,
      algorithmVersion: 'weighted-v1',
      requestedAlgorithmVersion: ALGORITHM_V3,
      weights: DEFAULT_WEIGHTS,
      degraded: true,
      fallback: {
        reason: 'version_disabled',
        status: null,
        retryable: false,
        message: 'Matching V3 is disabled'
      },
      embedding: null
    };
  }
  let v3Config;
  let requestedAlgorithmVersion = ALGORITHM_V3;
  try {
    v3Config = dependencies.embeddingConfig || embeddingV3Config();
    requestedAlgorithmVersion = matchingV3AlgorithmVersion(v3Config, weights);
    const [candidateEmbedding, jobEmbedding] = await Promise.all([
      embeddingForV3(profileText(candidate), 'candidate-profile', prismaClient, { ...dependencies, embeddingConfig: v3Config }),
      embeddingForV3(jobText(job), 'job-document', prismaClient, { ...dependencies, embeddingConfig: v3Config })
    ]);
    const semanticScore = boundedScore(cosineSimilarity(candidateEmbedding.vector, jobEmbedding.vector) * 100, 'semanticScore');
    const score = weightedScore({
      skillScore: v1.skillScore,
      experienceScore: v1.experienceScore,
      positionScore: v1.positionScore,
      locationScore: v1.locationScore,
      salaryScore: v1.salaryScore,
      employmentScore: v1.employmentScore,
      semanticScore
    }, weights, V2_COMPONENTS, 'matching-v3');
    return {
      ...v1,
      semanticScore,
      score,
      algorithmVersion: requestedAlgorithmVersion,
      requestedAlgorithmVersion,
      weights,
      degraded: false,
      fallback: null,
      embedding: {
        model: v3Config.model,
        modelVersion: v3Config.modelVersion,
        taskInstruction: v3Config.taskInstruction,
        outputDimensionality: v3Config.outputDimensionality,
        candidateCacheHit: candidateEmbedding.cacheHit,
        jobCacheHit: jobEmbedding.cacheHit,
        candidateInputFingerprint: candidateEmbedding.inputFingerprint,
        jobInputFingerprint: jobEmbedding.inputFingerprint
      }
    };
  } catch (error) {
    return {
      ...v1,
      semanticScore: null,
      algorithmVersion: 'weighted-v1',
      requestedAlgorithmVersion,
      weights: DEFAULT_WEIGHTS,
      degraded: true,
      fallback: {
        reason: error?.code || 'embedding_error',
        status: error?.status || null,
        retryable: Boolean(error?.retryable),
        message: error?.message || 'Không thể tính embedding V3'
      },
      embedding: v3Config ? {
        model: v3Config.model,
        modelVersion: v3Config.modelVersion,
        taskInstruction: v3Config.taskInstruction,
        outputDimensionality: v3Config.outputDimensionality
      } : null
    };
  }
}

module.exports = {
  DEFAULT_WEIGHTS,
  DEFAULT_V2_WEIGHTS,
  ALGORITHM_V2,
  ALGORITHM_V3,
  MatchingVersionDisabledError,
  assertMatchingVersionEnabled,
  calculateMatchScore,
  calculateWeightedV2,
  calculateWeightedV3,
  matchingV2Weights,
  matchingV3AlgorithmVersion,
  matchingVersionEnabled,
  buildRuleExplanation,
  cosineSimilarity
};
