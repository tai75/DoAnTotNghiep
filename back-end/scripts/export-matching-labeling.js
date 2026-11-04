require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const prisma = require('../src/config/prisma');
const {
  EXPORTER_VERSION, RUBRIC_VERSION, anonymizedCandidate, anonymizedJob,
  candidateFlags, candidateSnapshot, completeness, jobFlags, jobSnapshot,
  findSensitiveText, pseudonym, selectDiversePairs, sha256, toCsv
} = require('./lib/matching-evaluation-data');

function parseArgs(argv) {
  const options = { outputRoot: path.join(__dirname, '../data/evaluation-snapshots'), maxJobsPerCandidate: 20 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--output-root') options.outputRoot = path.resolve(argv[++index]);
    else if (argv[index] === '--max-jobs-per-candidate') options.maxJobsPerCandidate = Number(argv[++index]);
    else throw new Error(`Tham số không hỗ trợ: ${argv[index]}`);
  }
  if (!Number.isInteger(options.maxJobsPerCandidate) || options.maxJobsPerCandidate < 1) throw new Error('--max-jobs-per-candidate phải là số nguyên dương');
  return options;
}

async function loadSourceData() {
  return Promise.all([
    prisma.candidate.findMany({
      include: { skills: { include: { skill: true } }, educations: true, experiences: true, projects: true },
      orderBy: { id: 'asc' }
    }),
    prisma.job.findMany({ include: { skills: { include: { skill: true } } }, orderBy: { id: 'asc' } })
  ]);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const snapshotAt = new Date();
  const [candidateRecords, jobRecords] = await loadSourceData();
  const candidates = candidateRecords.map(candidateSnapshot);
  const jobs = jobRecords.map(jobSnapshot);
  const databaseSnapshotSha256 = sha256(JSON.stringify({ candidates, jobs }));
  const snapshotId = `matching-${snapshotAt.toISOString().replace(/[-:.]/g, '').replace('Z', 'Z')}-${databaseSnapshotSha256.slice(0, 10)}`;
  const salt = crypto.randomBytes(32).toString('hex');
  const eligibleCandidates = candidates.filter((candidate) => candidateFlags(candidate).benchmarkReady);
  const eligibleJobs = jobs.filter((job) => jobFlags(job, snapshotAt).benchmarkReady);
  const pairs = selectDiversePairs(eligibleCandidates, eligibleJobs, options.maxJobsPerCandidate, snapshotId);
  const candidateRefs = new Map(eligibleCandidates.map((candidate) => [candidate.id, pseudonym('C', candidate.id, salt)]));
  const jobRefs = new Map(eligibleJobs.map((job) => [job.id, pseudonym('J', job.id, salt)]));
  const pairRows = pairs.map(({ candidate, job }, index) => {
    const candidateProfile = JSON.stringify(anonymizedCandidate(candidate));
    const jobProfile = JSON.stringify(anonymizedJob(job));
    const residualSensitiveTypes = [...new Set([
      ...findSensitiveText(candidateProfile), ...findSensitiveText(jobProfile)
    ])];
    if (residualSensitiveTypes.length) {
      throw new Error(`Bộ lọc riêng tư không loại bỏ được: ${residualSensitiveTypes.join(', ')}`);
    }
    return {
      snapshot_id: snapshotId,
      pair_id: `P-${String(index + 1).padStart(5, '0')}`,
      candidate_ref: candidateRefs.get(candidate.id),
      job_ref: jobRefs.get(job.id),
      candidate_profile: candidateProfile,
      job_profile: jobProfile,
      evaluator_1_id: '', relevance_1: '', labeled_at_1: '',
      evaluator_2_id: '', relevance_2: '', labeled_at_2: '',
      adjudicator_id: '', final_relevance: '', adjudicated_at: '',
      rubric_version: RUBRIC_VERSION, notes: ''
    };
  });
  const stratumCounts = Object.fromEntries([...new Set(pairs.map((pair) => pair.stratum))].map((stratum) => [stratum, pairs.filter((pair) => pair.stratum === stratum).length]));
  const status = eligibleCandidates.length >= 5 && eligibleJobs.length >= 10 && pairs.length >= 50 ? 'ready-for-labeling' : 'insufficient-data';
  const summary = {
    status, snapshotId, snapshotAt: snapshotAt.toISOString(), exporterVersion: EXPORTER_VERSION,
    rubricVersion: RUBRIC_VERSION, databaseSnapshotSha256,
    privacy: {
      directDatabaseIdsInLabelingFile: false,
      candidateFreeTextIncluded: false,
      contactPatternsRedacted: ['email', 'phone', 'url'],
      preciseLocationsCoarsened: true
    },
    source: {
      candidateCount: candidates.length,
      jobCount: jobs.length,
      candidateCompleteness: completeness(candidates, candidateFlags),
      jobCompleteness: completeness(jobs, (job) => jobFlags(job, snapshotAt))
    },
    eligible: { candidateCount: eligibleCandidates.length, jobCount: eligibleJobs.length, pairCount: pairs.length, maxJobsPerCandidate: options.maxJobsPerCandidate, samplingStrata: stratumCounts },
    warnings: status === 'insufficient-data' ? ['Chưa đủ tối thiểu 5 candidate benchmark-ready, 10 job benchmark-ready và 50 pair để bắt đầu gán nhãn.'] : []
  };
  const manifest = {
    ...summary,
    manifestClassification: 'PRIVATE: chứa database IDs và salt; không gửi cho evaluator.',
    pseudonymSalt: salt,
    candidates: eligibleCandidates.map((candidate) => ({ candidateId: candidate.id, candidateRef: candidateRefs.get(candidate.id), featureSha256: sha256(JSON.stringify(candidate)) })),
    jobs: eligibleJobs.map((job) => ({ jobId: job.id, jobRef: jobRefs.get(job.id), featureSha256: sha256(JSON.stringify(job)) })),
    pairs: pairRows.map((row, index) => ({
      pairId: row.pair_id,
      candidateId: pairs[index].candidate.id,
      jobId: pairs[index].job.id,
      candidateRef: row.candidate_ref,
      jobRef: row.job_ref,
      candidateProfileSha256: sha256(row.candidate_profile),
      jobProfileSha256: sha256(row.job_profile),
      samplingStratum: pairs[index].stratum
    }))
  };
  const outputDirectory = path.join(options.outputRoot, snapshotId);
  fs.mkdirSync(outputDirectory, { recursive: true });
  const headers = ['snapshot_id', 'pair_id', 'candidate_ref', 'job_ref', 'candidate_profile', 'job_profile', 'evaluator_1_id', 'relevance_1', 'labeled_at_1', 'evaluator_2_id', 'relevance_2', 'labeled_at_2', 'adjudicator_id', 'final_relevance', 'adjudicated_at', 'rubric_version', 'notes'];
  fs.writeFileSync(path.join(outputDirectory, 'labeling-pairs.csv'), toCsv(headers, pairRows), 'utf8');
  fs.writeFileSync(path.join(outputDirectory, 'snapshot-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(outputDirectory, 'private-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ status, outputDirectory, snapshotId, candidates: eligibleCandidates.length, jobs: eligibleJobs.length, pairs: pairs.length }, null, 2));
}

if (require.main === module) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
}

module.exports = { loadSourceData, parseArgs };
