require('dotenv').config();

const fs = require('fs');
const path = require('path');
const prisma = require('../src/config/prisma');
const { parseCsv } = require('./evaluate-matching');
const { candidateSnapshot, findSensitiveText, jobSnapshot, sha256, toCsv } = require('./lib/matching-evaluation-data');

function parseArgs(argv) {
  const options = { minQueries: 5, minJobsPerQuery: 10, minDistinctJobs: 10, minWeightedKappa: 0.6, relevanceThreshold: 1 };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--labels') options.labels = path.resolve(argv[++index]);
    else if (value === '--manifest') options.manifest = path.resolve(argv[++index]);
    else if (value === '--output') options.output = path.resolve(argv[++index]);
    else if (value === '--min-queries') options.minQueries = Number(argv[++index]);
    else if (value === '--min-jobs-per-query') options.minJobsPerQuery = Number(argv[++index]);
    else if (value === '--min-distinct-jobs') options.minDistinctJobs = Number(argv[++index]);
    else if (value === '--min-weighted-kappa') options.minWeightedKappa = Number(argv[++index]);
    else if (value === '--relevance-threshold') options.relevanceThreshold = Number(argv[++index]);
    else throw new Error(`Tham số không hỗ trợ: ${value}`);
  }
  if (!options.labels || !options.manifest || !options.output) throw new Error('Bắt buộc có --labels, --manifest và --output');
  if (![options.minQueries, options.minJobsPerQuery, options.minDistinctJobs].every((value) => Number.isInteger(value) && value > 0)) throw new Error('Ngưỡng query/job phải là số nguyên dương');
  if (!Number.isFinite(options.minWeightedKappa) || options.minWeightedKappa < -1 || options.minWeightedKappa > 1) throw new Error('--min-weighted-kappa phải trong [-1, 1]');
  if (!Number.isInteger(options.relevanceThreshold) || options.relevanceThreshold < 1 || options.relevanceThreshold > 3) throw new Error('--relevance-threshold phải là số nguyên trong [1, 3]');
  return options;
}

function csvObjects(filePath) {
  const parsed = parseCsv(fs.readFileSync(filePath, 'utf8'));
  if (parsed.length < 2) return [];
  const headers = parsed[0].map((value) => value.trim());
  return parsed.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, String(values[index] || '').trim()])));
}

function validTimestamp(value) {
  return Boolean(value) && Number.isFinite(Date.parse(value));
}

function validRelevance(value) {
  return /^[0-3]$/.test(value);
}

function interRaterAgreement(rows) {
  const usable = rows.filter((row) => validRelevance(row.relevance_1) && validRelevance(row.relevance_2));
  if (!usable.length) return { pairCount: 0, exactAgreement: null, meanAbsoluteDifference: null, quadraticWeightedKappa: null };
  const grades = [0, 1, 2, 3];
  const confusion = grades.map(() => grades.map(() => 0));
  for (const row of usable) confusion[Number(row.relevance_1)][Number(row.relevance_2)] += 1;
  const rowTotals = confusion.map((items) => items.reduce((sum, value) => sum + value, 0));
  const columnTotals = grades.map((grade) => confusion.reduce((sum, items) => sum + items[grade], 0));
  let observed = 0;
  let expected = 0;
  for (const left of grades) {
    for (const right of grades) {
      const weight = ((left - right) / 3) ** 2;
      observed += weight * confusion[left][right] / usable.length;
      expected += weight * rowTotals[left] * columnTotals[right] / (usable.length ** 2);
    }
  }
  const exact = usable.filter((row) => row.relevance_1 === row.relevance_2).length;
  const absoluteDifference = usable.reduce((sum, row) => sum + Math.abs(Number(row.relevance_1) - Number(row.relevance_2)), 0);
  return {
    pairCount: usable.length,
    exactAgreement: exact / usable.length,
    disagreementCount: usable.length - exact,
    meanAbsoluteDifference: absoluteDifference / usable.length,
    quadraticWeightedKappa: expected === 0 ? null : 1 - observed / expected,
    confusionMatrix: confusion
  };
}

async function currentFeatureHashes(manifest) {
  const candidateIds = manifest.candidates.map((item) => item.candidateId);
  const jobIds = manifest.jobs.map((item) => item.jobId);
  const [candidates, jobs] = await Promise.all([
    prisma.candidate.findMany({ where: { id: { in: candidateIds } }, include: { skills: { include: { skill: true } }, educations: true, experiences: true, projects: true } }),
    prisma.job.findMany({ where: { id: { in: jobIds } }, include: { skills: { include: { skill: true } } } })
  ]);
  return {
    candidates: new Map(candidates.map((item) => [item.id, sha256(JSON.stringify(candidateSnapshot(item)))])),
    jobs: new Map(jobs.map((item) => [item.id, sha256(JSON.stringify(jobSnapshot(item)))]))
  };
}

async function validateAndPrepare(labels, manifest, options) {
  const errors = [];
  const warnings = [];
  if (!validTimestamp(manifest.snapshotAt)) errors.push('Manifest thiếu snapshotAt hợp lệ');
  if (manifest.status !== 'ready-for-labeling') errors.push(`Snapshot status là ${manifest.status}, chưa đủ điều kiện gán nhãn`);
  const pairMap = new Map(manifest.pairs.map((pair) => [pair.pairId, pair]));
  if (labels.length !== manifest.pairs.length) errors.push(`Số label rows (${labels.length}) khác số snapshot pairs (${manifest.pairs.length})`);
  const seen = new Set();
  const seenDatabasePairs = new Set();
  const benchmarkRows = [];
  const snapshotAt = Date.parse(manifest.snapshotAt);
  const validationNow = Date.now() + 5 * 60 * 1000;
  for (const [index, row] of labels.entries()) {
    const line = index + 2;
    const pair = pairMap.get(row.pair_id);
    if (!pair) { errors.push(`Dòng ${line}: pair_id không thuộc snapshot`); continue; }
    if (seen.has(row.pair_id)) { errors.push(`Dòng ${line}: pair_id bị trùng`); continue; }
    seen.add(row.pair_id);
    if (row.snapshot_id !== manifest.snapshotId) errors.push(`Dòng ${line}: snapshot_id không khớp`);
    if (row.candidate_ref !== pair.candidateRef || row.job_ref !== pair.jobRef) errors.push(`Dòng ${line}: pseudonym không khớp manifest`);
    if (sha256(row.candidate_profile) !== pair.candidateProfileSha256 || sha256(row.job_profile) !== pair.jobProfileSha256) errors.push(`Dòng ${line}: profile ẩn danh đã bị thay đổi`);
    if (row.rubric_version !== manifest.rubricVersion) errors.push(`Dòng ${line}: rubric_version không khớp`);
    const relevanceFieldsValid = [row.relevance_1, row.relevance_2, row.final_relevance].every(validRelevance);
    const relevance1 = relevanceFieldsValid ? Number(row.relevance_1) : Number.NaN;
    const relevance2 = relevanceFieldsValid ? Number(row.relevance_2) : Number.NaN;
    const finalRelevance = relevanceFieldsValid ? Number(row.final_relevance) : Number.NaN;
    if (!row.evaluator_1_id || !row.evaluator_2_id || row.evaluator_1_id === row.evaluator_2_id) errors.push(`Dòng ${line}: cần hai evaluator độc lập`);
    const provenanceSensitiveTypes = [...new Set(findSensitiveText([
      row.evaluator_1_id, row.evaluator_2_id, row.adjudicator_id, row.notes
    ].filter(Boolean).join(' ')))];
    if (provenanceSensitiveTypes.length) errors.push(`Dòng ${line}: evaluator/adjudication metadata chứa thông tin nhạy cảm (${provenanceSensitiveTypes.join(', ')})`);
    if (!relevanceFieldsValid) errors.push(`Dòng ${line}: relevance phải là số nguyên 0–3 và không được để trống`);
    if (!validTimestamp(row.labeled_at_1) || !validTimestamp(row.labeled_at_2)) errors.push(`Dòng ${line}: thiếu timestamp gán nhãn hợp lệ`);
    if (validTimestamp(row.labeled_at_1) && (Date.parse(row.labeled_at_1) < snapshotAt || Date.parse(row.labeled_at_1) > validationNow)) errors.push(`Dòng ${line}: labeled_at_1 phải sau snapshot và không ở tương lai`);
    if (validTimestamp(row.labeled_at_2) && (Date.parse(row.labeled_at_2) < snapshotAt || Date.parse(row.labeled_at_2) > validationNow)) errors.push(`Dòng ${line}: labeled_at_2 phải sau snapshot và không ở tương lai`);
    if (relevance1 !== relevance2 && (!row.adjudicator_id || [row.evaluator_1_id, row.evaluator_2_id].includes(row.adjudicator_id) || !validTimestamp(row.adjudicated_at))) errors.push(`Dòng ${line}: bất đồng cần adjudicator độc lập và timestamp`);
    if (relevance1 !== relevance2 && !row.notes) errors.push(`Dòng ${line}: bất đồng cần notes giải thích quyết định adjudication`);
    if (relevance1 !== relevance2 && validTimestamp(row.adjudicated_at) && Date.parse(row.adjudicated_at) < Math.max(Date.parse(row.labeled_at_1), Date.parse(row.labeled_at_2))) errors.push(`Dòng ${line}: adjudicated_at phải sau hai lần gán nhãn`);
    if (validTimestamp(row.adjudicated_at) && Date.parse(row.adjudicated_at) > validationNow) errors.push(`Dòng ${line}: adjudicated_at không được ở tương lai`);
    if (relevance1 === relevance2 && finalRelevance !== relevance1) errors.push(`Dòng ${line}: final relevance phải bằng nhãn đồng thuận`);
    const databasePair = `${pair.candidateId}:${pair.jobId}`;
    if (seenDatabasePairs.has(databasePair)) errors.push(`Dòng ${line}: trùng cặp candidate/job trong manifest`);
    seenDatabasePairs.add(databasePair);
    benchmarkRows.push({
      candidate_id: pair.candidateId,
      job_id: pair.jobId,
      relevance: finalRelevance,
      annotator: [row.evaluator_1_id, row.evaluator_2_id].join('|'),
      labeled_at: row.adjudicated_at || row.labeled_at_2,
      guidelines_version: row.rubric_version,
      annotator_2: row.evaluator_2_id,
      relevance_2: relevance2,
      adjudicator: row.adjudicator_id,
      snapshot_id: manifest.snapshotId,
      pair_id: pair.pairId,
      notes: row.notes
    });
  }
  for (const pair of manifest.pairs) if (!seen.has(pair.pairId)) errors.push(`Thiếu label cho ${pair.pairId}`);
  const hashes = await currentFeatureHashes(manifest);
  for (const candidate of manifest.candidates) {
    if (!hashes.candidates.has(candidate.candidateId)) errors.push(`Candidate ${candidate.candidateId} không còn tồn tại`);
    else if (hashes.candidates.get(candidate.candidateId) !== candidate.featureSha256) errors.push(`Candidate ${candidate.candidateId} đã thay đổi sau snapshot`);
  }
  for (const job of manifest.jobs) {
    if (!hashes.jobs.has(job.jobId)) errors.push(`Job ${job.jobId} không còn tồn tại`);
    else if (hashes.jobs.get(job.jobId) !== job.featureSha256) errors.push(`Job ${job.jobId} đã thay đổi sau snapshot`);
  }
  const groups = new Map();
  for (const row of benchmarkRows) {
    if (!groups.has(row.candidate_id)) groups.set(row.candidate_id, []);
    groups.get(row.candidate_id).push(row);
  }
  if (groups.size < options.minQueries) errors.push(`Chỉ có ${groups.size} query, cần ít nhất ${options.minQueries}`);
  const distinctJobCount = new Set(benchmarkRows.map((row) => row.job_id)).size;
  if (distinctJobCount < options.minDistinctJobs) errors.push(`Chỉ có ${distinctJobCount} job khác nhau, cần ít nhất ${options.minDistinctJobs}`);
  for (const [candidateId, rows] of groups) {
    if (rows.length < options.minJobsPerQuery) errors.push(`Candidate ${candidateId} chỉ có ${rows.length} job, cần ít nhất ${options.minJobsPerQuery}`);
    const relevant = rows.filter((row) => row.relevance >= options.relevanceThreshold).length;
    if (!relevant) errors.push(`Candidate ${candidateId} không có relevant item`);
    if (relevant === rows.length) errors.push(`Candidate ${candidateId} không có non-relevant item`);
  }
  const distribution = Object.fromEntries([0, 1, 2, 3].map((grade) => [grade, benchmarkRows.filter((row) => row.relevance === grade).length]));
  const missingGrades = Object.entries(distribution).filter(([, count]) => count === 0).map(([grade]) => grade);
  if (missingGrades.length) errors.push(`Dataset phải phủ đủ relevance 0–3; đang thiếu mức ${missingGrades.join(', ')}`);
  const agreement = interRaterAgreement(labels);
  if (agreement.quadraticWeightedKappa === null) errors.push('Không tính được quadratic weighted kappa; cần nhãn đa dạng từ hai evaluator');
  else if (agreement.quadraticWeightedKappa < options.minWeightedKappa) errors.push(`Quadratic weighted kappa ${agreement.quadraticWeightedKappa.toFixed(3)} thấp hơn ngưỡng ${options.minWeightedKappa}`);
  return { errors, warnings, benchmarkRows, distribution, agreement, queryCount: groups.size, distinctJobCount };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const labelsText = fs.readFileSync(options.labels, 'utf8');
  const manifestText = fs.readFileSync(options.manifest, 'utf8');
  const manifest = JSON.parse(manifestText);
  const labels = csvObjects(options.labels);
  const result = await validateAndPrepare(labels, manifest, options);
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  const validationPath = `${options.output}.validation.json`;
  const validation = {
    status: result.errors.length ? 'invalid' : 'benchmark-ready',
    validatedAt: new Date().toISOString(), snapshotId: manifest.snapshotId,
    labelsSha256: sha256(labelsText), manifestSha256: sha256(manifestText), databaseSnapshotSha256: manifest.databaseSnapshotSha256,
    queryCount: result.queryCount, distinctJobCount: result.distinctJobCount, pairCount: result.benchmarkRows.length,
    relevanceDistribution: result.distribution,
    interRaterAgreement: result.agreement,
    requirements: { minQueries: options.minQueries, minJobsPerQuery: options.minJobsPerQuery, minDistinctJobs: options.minDistinctJobs, minWeightedKappa: options.minWeightedKappa, requiredRelevanceGrades: [0, 1, 2, 3], relevanceThreshold: options.relevanceThreshold },
    errors: result.errors, warnings: result.warnings
  };
  fs.writeFileSync(validationPath, `${JSON.stringify(validation, null, 2)}\n`, 'utf8');
  if (result.errors.length) throw new Error(`Dataset không hợp lệ (${result.errors.length} lỗi). Xem ${validationPath}`);
  const headers = ['candidate_id', 'job_id', 'relevance', 'annotator', 'labeled_at', 'guidelines_version', 'annotator_2', 'relevance_2', 'adjudicator', 'snapshot_id', 'pair_id', 'notes'];
  const csv = toCsv(headers, result.benchmarkRows);
  fs.writeFileSync(options.output, csv, 'utf8');
  const metadata = {
    ...validation,
    datasetSha256: sha256(csv),
    rubricVersion: manifest.rubricVersion,
    exporterVersion: manifest.exporterVersion,
    featureHashes: {
      candidates: manifest.candidates.map(({ candidateId, featureSha256 }) => ({ candidateId, featureSha256 })),
      jobs: manifest.jobs.map(({ jobId, featureSha256 }) => ({ jobId, featureSha256 }))
    }
  };
  fs.writeFileSync(`${options.output}.metadata.json`, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ status: 'benchmark-ready', output: options.output, metadata: `${options.output}.metadata.json`, pairs: result.benchmarkRows.length }, null, 2));
}

if (require.main === module) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
}

module.exports = { csvObjects, interRaterAgreement, validRelevance, validTimestamp, validateAndPrepare };
