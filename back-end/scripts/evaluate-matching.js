require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const prisma = require('../src/config/prisma');
const config = require('../src/config/env');
const { candidateSnapshot, jobSnapshot } = require('./lib/matching-evaluation-data');
const {
  ALGORITHM_V2, ALGORITHM_V3, DEFAULT_WEIGHTS, calculateMatchScore, calculateWeightedV2,
  calculateWeightedV3, matchingV2Weights
} = require('../src/services/matching.service');

function parseArgs(argv) {
  const options = {
    input: path.join(__dirname, '../data/matching-eval.csv'),
    outputDir: path.join(__dirname, '../data/evaluation-results'),
    ks: [1, 3, 5, 10], relevanceThreshold: 1, skipV2: true, includeV3: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--input') options.input = path.resolve(argv[++index]);
    else if (value === '--metadata') options.metadata = path.resolve(argv[++index]);
    else if (value === '--output-dir') options.outputDir = path.resolve(argv[++index]);
    else if (value === '--k') options.ks = argv[++index].split(',').map(Number);
    else if (value === '--relevance-threshold') options.relevanceThreshold = Number(argv[++index]);
    else if (value === '--include-v2') options.skipV2 = false;
    else if (value === '--skip-v2') options.skipV2 = true;
    else if (value === '--include-v3') options.includeV3 = true;
    else if (value === '--help') {
      console.log('Usage: node scripts/evaluate-matching.js [--input file.csv] [--metadata file.json] [--output-dir dir] [--k 1,3,5,10] [--relevance-threshold 1] [--include-v2] [--skip-v2] [--include-v3]');
      process.exit(0);
    } else throw new Error(`Tham số không được hỗ trợ: ${value}`);
  }
  if (!options.ks.length || options.ks.some((k) => !Number.isInteger(k) || k < 1)) throw new Error('--k phải là danh sách số nguyên dương');
  if (!Number.isFinite(options.relevanceThreshold)) throw new Error('--relevance-threshold phải là một số');
  return options;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(field); field = ''; }
    else if (character === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (character !== '\r') field += character;
  }
  if (quoted) throw new Error('CSV có dấu nháy kép chưa đóng');
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((item) => item.some((value) => value.trim() !== ''));
}

function readLabels(filePath) {
  const parsed = parseCsv(fs.readFileSync(filePath, 'utf8'));
  if (parsed.length < 2) throw new Error('Dataset phải có header và ít nhất một dòng dữ liệu');
  const headers = parsed[0].map((value) => value.trim().toLowerCase());
  const indexOf = (...names) => names.map((name) => headers.indexOf(name)).find((index) => index >= 0) ?? -1;
  const indexes = {
    candidateId: indexOf('candidate_id'), jobId: indexOf('job_id'), relevance: indexOf('relevance', 'label'),
    annotator: indexOf('annotator'), labeledAt: indexOf('labeled_at'),
    guidelinesVersion: indexOf('guidelines_version'), notes: indexOf('notes'),
    annotator2: indexOf('annotator_2'), relevance2: indexOf('relevance_2'), adjudicator: indexOf('adjudicator'),
    snapshotId: indexOf('snapshot_id'), pairId: indexOf('pair_id')
  };
  if (indexes.candidateId < 0 || indexes.jobId < 0 || indexes.relevance < 0) throw new Error('CSV bắt buộc có candidate_id, job_id và relevance (hoặc label)');
  const seen = new Set();
  const rows = parsed.slice(1).map((values, rowIndex) => {
    const candidateId = Number(values[indexes.candidateId]);
    const jobId = Number(values[indexes.jobId]);
    const relevance = Number(values[indexes.relevance]);
    if (!Number.isInteger(candidateId) || candidateId < 1 || !Number.isInteger(jobId) || jobId < 1 || !Number.isInteger(relevance) || relevance < 0 || relevance > 3) {
      throw new Error(`Dòng ${rowIndex + 2}: ID phải là số nguyên dương và relevance phải là số nguyên 0–3`);
    }
    const key = `${candidateId}:${jobId}`;
    if (seen.has(key)) throw new Error(`Dòng ${rowIndex + 2}: trùng cặp candidate/job ${key}`);
    seen.add(key);
    const optional = (index) => index >= 0 ? String(values[index] || '').trim() : '';
    return {
      candidateId, jobId, relevance, annotator: optional(indexes.annotator),
      labeledAt: optional(indexes.labeledAt), guidelinesVersion: optional(indexes.guidelinesVersion), notes: optional(indexes.notes),
      annotator2: optional(indexes.annotator2), relevance2: optional(indexes.relevance2), adjudicator: optional(indexes.adjudicator),
      snapshotId: optional(indexes.snapshotId), pairId: optional(indexes.pairId)
    };
  });
  const verified = indexes.annotator >= 0 && indexes.labeledAt >= 0 && indexes.guidelinesVersion >= 0
    && indexes.annotator2 >= 0 && indexes.relevance2 >= 0 && indexes.snapshotId >= 0 && indexes.pairId >= 0
    && rows.every((row) => row.annotator && row.annotator2 && row.labeledAt && Number.isFinite(Date.parse(row.labeledAt))
      && row.guidelinesVersion && row.snapshotId && row.pairId && /^[0-3]$/.test(row.relevance2));
  return { rows, verified };
}

function percentile(values, percentileValue) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * percentileValue;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower + 1] === undefined ? sorted[lower] : sorted[lower] + fraction * (sorted[lower + 1] - sorted[lower]);
}

function latencySummary(values) {
  if (!values.length) return null;
  const round = (value) => Math.round(value * 1000) / 1000;
  return {
    count: values.length, meanMs: round(values.reduce((sum, value) => sum + value, 0) / values.length),
    p50Ms: round(percentile(values, 0.5)), p95Ms: round(percentile(values, 0.95)),
    minMs: round(Math.min(...values)), maxMs: round(Math.max(...values))
  };
}

function rankingMetrics(rows, scoreField, ks, threshold) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.candidateId)) groups.set(row.candidateId, []);
    groups.get(row.candidateId).push(row);
  }
  const perQuery = [];
  for (const [candidateId, items] of groups) {
    const ranked = [...items].sort((left, right) => right[scoreField] - left[scoreField] || left.jobId - right.jobId);
    const totalRelevant = items.filter((item) => item.relevance >= threshold).length;
    const result = { candidateId, candidates: items.length, relevant: totalRelevant };
    for (const k of ks) {
      const top = ranked.slice(0, k);
      const hits = top.filter((item) => item.relevance >= threshold).length;
      const dcg = top.reduce((sum, item, index) => sum + (2 ** item.relevance - 1) / Math.log2(index + 2), 0);
      const ideal = [...items].sort((left, right) => right.relevance - left.relevance).slice(0, k);
      const idcg = ideal.reduce((sum, item, index) => sum + (2 ** item.relevance - 1) / Math.log2(index + 2), 0);
      result[`precisionAt${k}`] = hits / k;
      result[`recallAt${k}`] = totalRelevant ? hits / totalRelevant : null;
      result[`ndcgAt${k}`] = idcg ? dcg / idcg : null;
    }
    perQuery.push(result);
    ranked.forEach((item, index) => { item[`${scoreField}Rank`] = index + 1; });
  }
  const macro = { queryCount: perQuery.length, pairCount: rows.length };
  for (const k of ks) {
    for (const name of ['precision', 'recall', 'ndcg']) {
      const key = `${name}At${k}`;
      const values = perQuery.map((item) => item[key]).filter((value) => value !== null);
      macro[key] = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    }
  }
  return { macro, perQuery };
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(filePath, rows) {
  const headers = ['candidate_id', 'job_id', 'relevance', 'annotator', 'labeled_at', 'guidelines_version', 'v1_score', 'v1_rank', 'v1_latency_ms', 'v2_score', 'v2_rank', 'v2_latency_ms', 'v2_semantic_score', 'v2_error', 'v3_score', 'v3_rank', 'v3_latency_ms', 'v3_semantic_score', 'v3_algorithm_version', 'v3_error', 'notes'];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push([row.candidateId, row.jobId, row.relevance, row.annotator, row.labeledAt, row.guidelinesVersion, row.v1Score, row.v1ScoreRank, row.v1LatencyMs, row.v2Score, row.v2ScoreRank, row.v2LatencyMs, row.v2SemanticScore, row.v2Error, row.v3Score, row.v3ScoreRank, row.v3LatencyMs, row.v3SemanticScore, row.v3AlgorithmVersion, row.v3Error, row.notes].map(csvEscape).join(','));
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

async function loadRecords(labels) {
  const candidateIds = [...new Set(labels.map((row) => row.candidateId))];
  const jobIds = [...new Set(labels.map((row) => row.jobId))];
  const [candidates, jobs] = await Promise.all([
    prisma.candidate.findMany({ where: { id: { in: candidateIds } }, include: { skills: { include: { skill: true } }, educations: true, experiences: true, projects: true } }),
    prisma.job.findMany({ where: { id: { in: jobIds } }, include: { skills: { include: { skill: true } } } })
  ]);
  const candidateMap = new Map(candidates.map((item) => [item.id, item]));
  const jobMap = new Map(jobs.map((item) => [item.id, item]));
  const missing = labels.filter((row) => !candidateMap.has(row.candidateId) || !jobMap.has(row.jobId));
  return {
    records: labels.map((label) => ({ ...label, candidate: candidateMap.get(label.candidateId), job: jobMap.get(label.jobId) })),
    missing
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const inputText = fs.readFileSync(options.input, 'utf8');
  const dataset = readLabels(options.input);
  if (!dataset.verified) throw new Error('Dataset thiếu provenance hai evaluator/snapshot hợp lệ. Không tính metric trên nhãn chưa xác minh.');
  const metadataPath = options.metadata || `${options.input}.metadata.json`;
  if (!fs.existsSync(metadataPath)) throw new Error(`Thiếu metadata đã validation: ${metadataPath}`);
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  if (metadata.status !== 'benchmark-ready') throw new Error('Metadata chưa có trạng thái benchmark-ready');
  if (metadata.datasetSha256 !== sha256(inputText)) throw new Error('Dataset hash không khớp metadata');
  if (metadata.pairCount !== dataset.rows.length) throw new Error('Số pair không khớp metadata');
  if (metadata.requirements?.relevanceThreshold !== options.relevanceThreshold) throw new Error(`relevance threshold phải giữ nguyên ${metadata.requirements?.relevanceThreshold} như lúc validation`);
  const groups = new Map();
  for (const row of dataset.rows) {
    if (!groups.has(row.candidateId)) groups.set(row.candidateId, []);
    groups.get(row.candidateId).push(row);
  }
  const maxK = Math.max(...options.ks);
  for (const [candidateId, rows] of groups) {
    if (rows.length < maxK) throw new Error(`Candidate ${candidateId} chỉ có ${rows.length} item, không đủ K=${maxK}`);
    const relevant = rows.filter((row) => row.relevance >= options.relevanceThreshold).length;
    if (!relevant || relevant === rows.length) throw new Error(`Candidate ${candidateId} phải có cả relevant và non-relevant item`);
  }
  const loaded = await loadRecords(dataset.rows);
  fs.mkdirSync(options.outputDir, { recursive: true });
  if (loaded.missing.length) {
    const missingKeys = new Set(loaded.missing.map((row) => `${row.candidateId}:${row.jobId}`));
    const invalidOutput = {
      status: 'invalid-dataset',
      warning: 'Không tính metric: dataset tham chiếu candidate/job không tồn tại trong database hiện tại.',
      generatedAt: new Date().toISOString(),
      dataset: { file: path.relative(process.cwd(), options.input), sha256: sha256(inputText), rows: dataset.rows.length, verifiedProvenance: dataset.verified },
      validation: { missingPairCount: loaded.missing.length, missingPairs: loaded.missing.map(({ candidateId, jobId }) => ({ candidateId, jobId })) },
      results: { v1: { unavailable: true }, v2: { unavailable: true } }
    };
    fs.writeFileSync(path.join(options.outputDir, 'matching-evaluation.json'), `${JSON.stringify(invalidOutput, null, 2)}\n`, 'utf8');
    writeCsv(path.join(options.outputDir, 'matching-evaluation-pairs.csv'), dataset.rows.map((row) => ({
      ...row,
      v2Error: missingKeys.has(`${row.candidateId}:${row.jobId}`) ? 'candidate/job không tồn tại trong database hiện tại' : 'evaluation bị hủy vì dataset không hợp lệ'
    })));
    throw new Error(`Có ${loaded.missing.length} cặp tham chiếu candidate/job không tồn tại; đã xuất báo cáo validation, ví dụ ${loaded.missing.slice(0, 5).map((row) => `${row.candidateId}:${row.jobId}`).join(', ')}`);
  }
  const records = loaded.records;
  const candidateHashes = new Map((metadata.featureHashes?.candidates || []).map((item) => [item.candidateId, item.featureSha256]));
  const jobHashes = new Map((metadata.featureHashes?.jobs || []).map((item) => [item.jobId, item.featureSha256]));
  for (const { candidate, job } of records) {
    if (candidateHashes.get(candidate.id) !== sha256(JSON.stringify(candidateSnapshot(candidate)))) throw new Error(`Candidate ${candidate.id} không khớp evaluation snapshot`);
    if (jobHashes.get(job.id) !== sha256(JSON.stringify(jobSnapshot(job)))) throw new Error(`Job ${job.id} không khớp evaluation snapshot`);
  }
  const rows = records.map(({ candidate, job, ...label }) => ({ ...label, candidate, job }));
  for (const row of rows) {
    const started = performance.now();
    const result = calculateMatchScore(row.candidate, row.job);
    row.v1LatencyMs = performance.now() - started;
    row.v1Score = result.score;
  }
  let v2FailureCount = 0;
  if (!options.skipV2) {
    for (const row of rows) {
      const started = performance.now();
      try {
        const result = await calculateWeightedV2(row.candidate, row.job, prisma);
        if (!Number.isFinite(result.score) || !Number.isFinite(result.semanticScore)) throw new Error('V2 trả về score không hữu hạn');
        row.v2Score = result.score;
        row.v2SemanticScore = result.semanticScore;
        row.v2Error = '';
      } catch (error) {
        row.v2Score = null; row.v2SemanticScore = null; row.v2Error = error.message; v2FailureCount += 1;
      }
      row.v2LatencyMs = performance.now() - started;
    }
  }
  let v3FailureCount = 0;
  let v3EmbeddingContract = null;
  const v3AlgorithmVersions = new Set();
  if (options.includeV3) {
    for (const row of rows) {
      const started = performance.now();
      try {
        const result = await calculateWeightedV3(row.candidate, row.job, prisma);
        row.v3AlgorithmVersion = result.requestedAlgorithmVersion || ALGORITHM_V3;
        if (result.degraded) throw new Error(`degraded-to-${result.algorithmVersion}: ${result.fallback?.reason || 'embedding_error'}`);
        if (!Number.isFinite(result.score) || !Number.isFinite(result.semanticScore)) throw new Error('V3 trả về score không hữu hạn');
        row.v3Score = result.score;
        row.v3SemanticScore = result.semanticScore;
        row.v3Error = '';
        v3AlgorithmVersions.add(result.algorithmVersion);
        v3EmbeddingContract ||= {
          model: result.embedding.model,
          modelVersion: result.embedding.modelVersion,
          taskInstruction: result.embedding.taskInstruction,
          outputDimensionality: result.embedding.outputDimensionality
        };
      } catch (error) {
        row.v3Score = null; row.v3SemanticScore = null; row.v3Error = error.message; v3FailureCount += 1;
      }
      row.v3LatencyMs = performance.now() - started;
    }
  }
  const serializableRows = rows.map(({ candidate, job, ...row }) => row);
  const v1 = rankingMetrics(serializableRows, 'v1Score', options.ks, options.relevanceThreshold);
  const v2Available = !options.skipV2 && v2FailureCount === 0;
  const v2 = v2Available ? rankingMetrics(serializableRows, 'v2Score', options.ks, options.relevanceThreshold) : null;
  const v3Available = options.includeV3 && v3FailureCount === 0 && v3AlgorithmVersions.size === 1;
  const v3 = v3Available ? rankingMetrics(serializableRows, 'v3Score', options.ks, options.relevanceThreshold) : null;
  const snapshot = records.map(({ candidate, job, candidateId, jobId }) => ({
    candidateId, jobId, candidateUpdatedAt: candidate.updatedAt, jobUpdatedAt: job.updatedAt,
    candidate: { headline: candidate.headline, bio: candidate.bio, yearsExperience: candidate.yearsExperience, desiredPosition: candidate.desiredPosition, desiredLocation: candidate.desiredLocation, desiredSalary: candidate.desiredSalary, desiredEmploymentType: candidate.desiredEmploymentType, skills: candidate.skills, educations: candidate.educations, experiences: candidate.experiences, projects: candidate.projects },
    job: { title: job.title, description: job.description, location: job.location, requiredYearsExperience: job.requiredYearsExperience, minSalary: job.minSalary, maxSalary: job.maxSalary, employmentType: job.employmentType, skills: job.skills }
  }));
  const output = {
    status: 'verified-labels',
    warning: null,
    generatedAt: new Date().toISOString(),
    dataset: { file: path.relative(process.cwd(), options.input), metadataFile: path.relative(process.cwd(), metadataPath), sha256: sha256(inputText), labelsSha256: metadata.labelsSha256, manifestSha256: metadata.manifestSha256, snapshotId: metadata.snapshotId, rows: rows.length, queryCount: new Set(rows.map((row) => row.candidateId)).size, verifiedProvenance: true, relevanceThreshold: options.relevanceThreshold, ks: options.ks },
    reproducibility: {
      node: process.version, platform: `${process.platform}/${process.arch}`,
      databaseSnapshotSha256: metadata.databaseSnapshotSha256,
      evaluatedFeatureSetSha256: sha256(JSON.stringify(snapshot)),
      embeddingModel: config.geminiEmbeddingModel, generativeModel: config.geminiModel,
      v1AlgorithmVersion: 'weighted-v1', v1Weights: DEFAULT_WEIGHTS,
      v2AlgorithmVersion: ALGORITHM_V2, v2Weights: matchingV2Weights(),
      v2EmbeddingModel: config.geminiEmbeddingModel,
      v2CacheState: 'uncontrolled; latency includes database cache lookup and any API calls',
      v3RequestedAlgorithmVersion: options.includeV3 ? ALGORITHM_V3 : null,
      v3ObservedAlgorithmVersions: [...v3AlgorithmVersions],
      v3EmbeddingContract,
      v3CacheState: options.includeV3 ? 'uncontrolled; cache hit/miss is recorded by the algorithm but latency is descriptive only' : null
    },
    results: {
      v1: { metrics: v1.macro, perQuery: v1.perQuery, latency: latencySummary(serializableRows.map((row) => row.v1LatencyMs)) },
      v2: v2 ? { algorithmVersion: ALGORITHM_V2, embeddingModel: config.geminiEmbeddingModel, metrics: v2.macro, perQuery: v2.perQuery, latency: latencySummary(serializableRows.map((row) => row.v2LatencyMs)) } : { unavailable: true, failureCount: v2FailureCount, skipped: options.skipV2 },
      v3: v3 ? { algorithmVersion: [...v3AlgorithmVersions][0], embedding: v3EmbeddingContract, metrics: v3.macro, perQuery: v3.perQuery, latency: latencySummary(serializableRows.map((row) => row.v3LatencyMs)) } : { unavailable: true, failureCount: v3FailureCount, skipped: !options.includeV3, observedAlgorithmVersions: [...v3AlgorithmVersions] }
    }
  };
  const jsonPath = path.join(options.outputDir, 'matching-evaluation.json');
  const csvPath = path.join(options.outputDir, 'matching-evaluation-pairs.csv');
  fs.writeFileSync(jsonPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  writeCsv(csvPath, serializableRows);
  console.log(JSON.stringify({ status: output.status, json: jsonPath, csv: csvPath, v1: output.results.v1.metrics, v2: output.results.v2.metrics || output.results.v2, v3: output.results.v3.metrics || output.results.v3 }, null, 2));
}

if (require.main === module) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
}

module.exports = { latencySummary, parseCsv, rankingMetrics, readLabels };
