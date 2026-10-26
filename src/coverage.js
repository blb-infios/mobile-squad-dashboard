#!/usr/bin/env node
/**
 * Fetch Azure DevOps code coverage separately from repository aggregation.
 * Reads public/data.json and merges coverage using the CI build IDs.
 */

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const {
  calculateReleaseReadiness,
  fetchLatestCoverage
} = require('./aggregate');

const ADO_ORG = process.env.ADO_ORG || 'Highjumpvso';
const ADO_PROJECT = process.env.ADO_PROJECT || 'WES';

/**
 * Capture the raw shape of the ADO code-coverage response for a build.
 * Used to discover where per-target (platform/flavor) identity actually lives
 * so the dashboard can group coverage by Android / iOS / JVM / Web.
 */
async function probeCoverageShape(buildId) {
  const client = axios.create({
    baseURL: `https://dev.azure.com/${ADO_ORG}/${ADO_PROJECT}/_apis`,
    auth: { username: '', password: process.env.ADO_PAT || process.env.AZURE_DEVOPS_EXT_PAT },
    headers: { Accept: 'application/json' },
    timeout: 30000,
    validateStatus: () => true
  });
  const response = await client.get('/test/codecoverage', {
    params: { buildId, flags: 7, 'api-version': '7.0' }
  });
  const records = Array.isArray(response.data?.value) ? response.data.value : [];
  return {
    buildId,
    httpStatus: response.status,
    recordCount: records.length,
    records: records.map((record) => ({
      keys: Object.keys(record),
      configuration: record.configuration || null,
      label: record.label ?? null,
      name: record.name ?? null,
      moduleCount: Array.isArray(record.modules) ? record.modules.length : 0,
      moduleNames: Array.isArray(record.modules) ? record.modules.map((module) => module?.name).slice(0, 40) : [],
      sampleModule: Array.isArray(record.modules) && record.modules[0]
        ? { keys: Object.keys(record.modules[0]), statistics: record.modules[0].statistics || null }
        : null
    }))
  };
}

async function writeCoverageDiagnostics(data) {
  const probes = [];
  for (const repo of (data.repositories || []).slice(0, 6)) {
    const buildId = repo.coverage?.buildId || repo.pipelines?.ci?.buildId;
    if (!buildId) continue;
    try {
      probes.push({ repository: repo.name, ...(await probeCoverageShape(buildId)) });
    } catch (error) {
      probes.push({ repository: repo.name, buildId, error: error.message });
    }
  }
  const diagPath = path.join(__dirname, '../public/coverage-diag.json');
  await fs.writeFile(diagPath, JSON.stringify({ generatedAt: new Date().toISOString(), probes }, null, 2));
  console.log(`🔎 Coverage shape diagnostics written for ${probes.length} builds`);
}

async function main() {
  if (!process.env.ADO_PAT && !process.env.AZURE_DEVOPS_EXT_PAT) {
    throw new Error('ADO_PAT or AZURE_DEVOPS_EXT_PAT is required for coverage aggregation');
  }

  const dataPath = path.join(__dirname, '../public/data.json');
  const data = JSON.parse(await fs.readFile(dataPath, 'utf8'));
  let coverageCount = 0;
  let attempted = 0;

  for (const repo of data.repositories || []) {
    attempted++;
    const history = Array.isArray(repo.pipelines?.ci?.history)
      ? repo.pipelines.ci.history
      : Array.isArray(repo.pipelines?.release?.history) ? repo.pipelines.release.history : [];
    const builds = history.length
      ? history.map((run) => ({
        id: run.buildId,
        finishTime: run.lastRun,
        startTime: run.lastRun,
        _links: run.url ? { web: { href: run.url } } : undefined
      }))
      : [{
        id: repo.pipelines?.ci?.buildId || repo.pipelines?.release?.buildId,
        finishTime: repo.pipelines?.ci?.lastRun || repo.pipelines?.release?.lastRun,
        startTime: repo.pipelines?.ci?.lastRun || repo.pipelines?.release?.lastRun,
        _links: repo.pipelines?.ci?.url ? { web: { href: repo.pipelines.ci.url } } : undefined
      }];
    repo.coverage = await fetchLatestCoverage(builds);
    repo.releaseReadiness = calculateReleaseReadiness(repo);
    if (repo.coverage) coverageCount++;
  }

  for (const category of data.categories || []) {
    for (const repo of category.repositories || []) {
      const flatRepo = (data.repositories || []).find((item) => item.fullName === repo.fullName);
      if (flatRepo) {
        repo.coverage = flatRepo.coverage;
        repo.releaseReadiness = flatRepo.releaseReadiness;
      }
    }
  }

  data.dataSources = data.dataSources || {};
  data.dataSources.coverage = {
    status: coverageCount ? 'connected' : 'unavailable',
    checkedAt: new Date().toISOString()
  };

  await fs.writeFile(dataPath, JSON.stringify(data, null, 2));
  console.log(`✅ Coverage data merged into ${dataPath}: ${coverageCount}/${attempted} repositories with coverage`);

  try {
    await writeCoverageDiagnostics(data);
  } catch (error) {
    console.warn(`⚠ Coverage diagnostics skipped: ${error.message}`);
  }
}

main().catch((error) => {
  console.error('❌ Coverage aggregation failed:', error.message);
  process.exit(1);
});
