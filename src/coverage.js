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

/**
 * TEMPORARY: record the shape of the Azure DevOps test-results APIs.
 *
 * Test results need the same Test Management: Read scope as coverage, which
 * only the CI token carries, so the response cannot be inspected locally.
 * Publish the shape to Pages once, write the real parser against it, then
 * delete this.
 */
async function probeTestResults(data) {
  const client = axios.create({
    baseURL: `https://dev.azure.com/${process.env.ADO_ORG || 'Highjumpvso'}/${process.env.ADO_PROJECT || 'WES'}/_apis`,
    auth: { username: '', password: process.env.ADO_PAT || process.env.AZURE_DEVOPS_EXT_PAT },
    headers: { Accept: 'application/json' },
    timeout: 30000,
    validateStatus: () => true
  });

  const probes = [];
  for (const repo of (data.repositories || []).slice(0, 8)) {
    const buildId = repo.pipelines?.ci?.buildId || repo.pipelines?.release?.buildId;
    if (!buildId) continue;
    const entry = { repository: repo.name, buildId, endpoints: {} };

    const runs = await client.get('/test/runs', { params: { buildUri: `vstfs:///Build/Build/${buildId}`, 'api-version': '7.0' } });
    entry.endpoints.runs = { status: runs.status, count: runs.data?.count ?? null };
    if (runs.status === 200) {
      entry.endpoints.runs.value = (runs.data?.value || []).map((run) => ({ keys: Object.keys(run), run }));
      const firstId = runs.data?.value?.[0]?.id;
      if (firstId) {
        const stats = await client.get(`/test/runs/${firstId}/statistics`, { params: { 'api-version': '7.0' } });
        entry.endpoints.statistics = { status: stats.status, body: stats.status === 200 ? stats.data : null };
      }
    }

    const summary = await client.get('/testresults/resultsummarybybuild', { params: { buildId, 'api-version': '7.0-preview.1' } });
    entry.endpoints.resultSummary = { status: summary.status, body: summary.status === 200 ? summary.data : null };

    probes.push(entry);
  }

  await fs.writeFile(path.join(__dirname, '../public/test-diag.json'), JSON.stringify({ generatedAt: new Date().toISOString(), probes }, null, 2));
  console.log(`🔎 Test-result shape probed for ${probes.length} builds`);
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
    repo.coverage = await fetchLatestCoverage(builds, repo.type || repo.category);
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
    await probeTestResults(data);
  } catch (error) {
    console.warn(`⚠ Test-result probe skipped: ${error.message}`);
  }
}

main().catch((error) => {
  console.error('❌ Coverage aggregation failed:', error.message);
  process.exit(1);
});
