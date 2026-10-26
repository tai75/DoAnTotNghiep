const { z } = require('zod');
const prisma = require('../config/prisma');
const ApiError = require('../utils/apiError');
const asyncHandler = require('../utils/asyncHandler');
const { authenticate, authorize } = require('../middleware/auth');
const { calculateMatchScore, buildRuleExplanation } = require('../services/matching.service');
const { explainMatch, chat } = require('../services/llm.service');

const router = require('express').Router();
const idSchema = z.coerce.number().int().positive();
const candidateQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) });
const recruiterQuery = z.object({
  requiredSkillIds: z.string().optional(),
  minExperience: z.coerce.number().min(0).optional(),
  location: z.string().max(150).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

async function getCandidate(userId) {
  const candidate = await prisma.candidate.findUnique({ where: { userId }, include: { skills: { include: { skill: true } } } });
  if (!candidate) throw new ApiError(404, 'Không tìm thấy hồ sơ ứng viên');
  return candidate;
}

async function saveScore(candidate, job, application, result, userId) {
  const explanation = buildRuleExplanation(result);
  const llmExplanation = await explainMatch(result, userId);
  const finalExplanation = llmExplanation || explanation;
  const data = {
    candidateId: candidate.id, jobId: job.id, applicationId: application?.id || null, score: result.score,
    skillScore: result.skillScore, experienceScore: result.experienceScore, positionScore: result.positionScore,
    locationScore: result.locationScore, salaryScore: result.salaryScore, employmentScore: result.employmentScore,
    matchedSkills: result.matchedSkills, missingSkills: result.missingSkills, explanation: finalExplanation,
    computedAt: new Date(), algorithmVersion: 'weighted-v1'
  };
  const score = await prisma.matchScore.upsert({ where: { candidateId_jobId: { candidateId: candidate.id, jobId: job.id } }, create: data, update: data });
  await prisma.recommendation.upsert({
    where: { candidateId_jobId: { candidateId: candidate.id, jobId: job.id } },
    create: { candidateId: candidate.id, jobId: job.id, score: result.score, reason: finalExplanation },
    update: { score: result.score, reason: finalExplanation }
  });
  return { ...result, explanation: finalExplanation, matchScoreId: score.id };
}

router.get('/jobs', authenticate, authorize('CANDIDATE'), asyncHandler(async (req, res) => {
  const { limit } = candidateQuery.parse(req.query);
  const candidate = await getCandidate(req.user.id);
  const jobs = await prisma.job.findMany({ where: { status: 'PUBLISHED' }, include: { company: true, skills: { include: { skill: true } } }, orderBy: { createdAt: 'desc' } });
  const applications = await prisma.application.findMany({ where: { candidateId: candidate.id }, select: { id: true, jobId: true } });
  const applied = new Map(applications.map((item) => [item.jobId, item]));
  const scored = [];
  for (const job of jobs) {
    const result = await saveScore(candidate, job, applied.get(job.id), calculateMatchScore(candidate, job), req.user.id);
    scored.push({ ...job, match: result });
  }
  scored.sort((a, b) => b.match.score - a.match.score);
  res.json({ success: true, data: scored.slice(0, limit) });
}));

router.get('/jobs/:jobId/candidates', authenticate, authorize('RECRUITER'), asyncHandler(async (req, res) => {
  const jobId = idSchema.parse(req.params.jobId);
  const filters = recruiterQuery.parse(req.query);
  const recruiter = await prisma.recruiter.findUnique({ where: { userId: req.user.id } });
  if (!recruiter) throw new ApiError(403, 'Tài khoản chưa được liên kết với nhà tuyển dụng');
  const job = await prisma.job.findFirst({ where: { id: jobId, companyId: recruiter.companyId }, include: { skills: { include: { skill: true } }, company: true } });
  if (!job) throw new ApiError(404, 'Không tìm thấy việc làm thuộc công ty của bạn');
  const candidates = await prisma.candidate.findMany({
    where: { OR: [{ isSearchable: true }, { applications: { some: { jobId } } }] },
    include: { skills: { include: { skill: true } }, user: { select: { fullName: true, email: true, phone: true } }, applications: { where: { jobId }, select: { id: true } } }
  });
  const requiredIds = filters.requiredSkillIds ? filters.requiredSkillIds.split(',').map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0) : [];
  const scoringJob = requiredIds.length ? { ...job, skills: job.skills.map((item) => ({ ...item, isRequired: requiredIds.includes(item.skillId) })) } : job;
  const results = [];
  for (const candidate of candidates) {
    if (filters.minExperience !== undefined && (Number(candidate.yearsExperience) || 0) < filters.minExperience) continue;
    if (filters.location && !`${candidate.location || ''} ${candidate.desiredLocation || ''}`.toLocaleLowerCase().includes(filters.location.toLocaleLowerCase())) continue;
    const result = await saveScore(candidate, job, candidate.applications[0], calculateMatchScore(candidate, scoringJob), req.user.id);
    const applied = Boolean(candidate.applications[0]);
    results.push({ candidateId: candidate.id, fullName: candidate.user.fullName, headline: candidate.headline, yearsExperience: candidate.yearsExperience, skills: candidate.skills, match: result, applied, contact: applied ? { email: candidate.user.email, phone: candidate.user.phone } : null });
  }
  results.sort((a, b) => b.match.score - a.match.score);
  res.json({ success: true, data: { job, items: results.slice(0, filters.limit) } });
}));

router.post('/chat', authenticate, asyncHandler(async (req, res) => {
  const message = z.string().min(1).max(2000).parse(req.body.message);
  const candidate = req.user.role === 'CANDIDATE' ? await getCandidate(req.user.id) : null;
  const recruiter = req.user.role === 'RECRUITER' ? await prisma.recruiter.findUnique({ where: { userId: req.user.id } }) : null;
  if (req.user.role === 'RECRUITER' && !recruiter) throw new ApiError(403, 'Tài khoản chưa được liên kết với nhà tuyển dụng');
  const tools = req.user.role === 'CANDIDATE' ? [
    { name: 'searchJobs', description: 'Tìm tin tuyển dụng đã được đăng', parameters: { type: 'OBJECT', properties: { query: { type: 'STRING' } } }, execute: async ({ query = '' }) => prisma.job.findMany({ where: { status: 'PUBLISHED', OR: [{ title: { contains: query } }, { description: { contains: query } }] }, select: { id: true, title: true, location: true, company: { select: { name: true } } }, take: 10 }) },
    { name: 'getRecommendations', description: 'Lấy việc làm phù hợp cho ứng viên hiện tại', parameters: { type: 'OBJECT', properties: {} }, execute: async () => { const jobs = await prisma.job.findMany({ where: { status: 'PUBLISHED' }, include: { skills: { include: { skill: true } } }, take: 50 }); return jobs.map((job) => ({ id: job.id, title: job.title, score: calculateMatchScore(candidate, job).score })).sort((a, b) => b.score - a.score).slice(0, 10); } }
  ] : [
    { name: 'searchCandidates', description: 'Tìm ứng viên searchable hoặc đã ứng tuyển vào công ty hiện tại', parameters: { type: 'OBJECT', properties: { query: { type: 'STRING' } } }, execute: async ({ query = '' }) => prisma.candidate.findMany({ where: { AND: [{ OR: [{ isSearchable: true }, { applications: { some: { job: { companyId: recruiter.companyId } } } }] }, ...(query ? [{ OR: [{ headline: { contains: query } }, { desiredPosition: { contains: query } }] }] : [])] }, select: { id: true, headline: true, desiredPosition: true, yearsExperience: true }, take: 10 }) }
  ];
  try {
    res.json({ success: true, data: { message: await chat({ userId: req.user.id, role: req.user.role, message, tools }) } });
  } catch (error) {
    if (error.statusCode) throw new ApiError(error.statusCode, error.message);
    throw new ApiError(503, 'Không thể kết nối dịch vụ AI lúc này');
  }
}));

module.exports = router;
module.exports.saveScore = saveScore;
