#!/usr/bin/env node
/**
 * Fetch Azure DevOps code coverage separately from repository aggregation.
 * Reads public/data.json and merges coverage using the CI build IDs.
 */

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const {
  calculateReleaseReadiness,
  fetchBuildCoverage
} = require('./aggregate');

async function main() {
  if (!process.env.ADO_PAT && !process.env.AZURE_DEVOPS_EXT_PAT) {
    throw new Error('ADO_PAT or AZURE_DEVOPS_EXT_PAT is required for coverage aggregation');
  }

  const dataPath = path.join(__dirname, '../public/data.json');
  const data = JSON.parse(await fs.readFile(dataPath, 'utf8'));
  let coverageCount = 0;
  let attempted = 0;

  for (const repo of data.repositories || []) {
    const buildId = repo.pipelines?.ci?.buildId || repo.pipelines?.release?.buildId;
    attempted++;
    repo.coverage = await fetchBuildCoverage(buildId);
    if (repo.coverage) {
      repo.coverage.percent = repo.coverage.lines?.percent ?? null;
      repo.coverage.threshold = Number(process.env.COVERAGE_THRESHOLD || 80);
      repo.coverage.lastRun = repo.pipelines?.ci?.lastRun || repo.pipelines?.release?.lastRun || null;
      repo.coverage.url = repo.pipelines?.ci?.url
        ? `${repo.pipelines.ci.url}&view=codecoverage-tab`
        : repo.pipelines?.release?.url || null;
    }
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
}

main().catch((error) => {
  console.error('❌ Coverage aggregation failed:', error.message);
  process.exit(1);
});
