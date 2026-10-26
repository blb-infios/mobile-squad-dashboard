#!/usr/bin/env node
/**
 * Fetch Azure DevOps code coverage and test results separately from
 * repository aggregation. Both need the Test Management: Read scope, so they
 * share this step. Reads public/data.json and merges using the CI build IDs.
 */

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const {
  calculateReleaseReadiness,
  fetchLatestCoverage,
  fetchLatestTestResults
} = require('./aggregate');

async function main() {
  if (!process.env.ADO_PAT && !process.env.AZURE_DEVOPS_EXT_PAT) {
    throw new Error('ADO_PAT or AZURE_DEVOPS_EXT_PAT is required for coverage aggregation');
  }

  const dataPath = path.join(__dirname, '../public/data.json');
  const data = JSON.parse(await fs.readFile(dataPath, 'utf8'));
  let coverageCount = 0;
  let testCount = 0;
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
    repo.tests = await fetchLatestTestResults(builds);
    repo.releaseReadiness = calculateReleaseReadiness(repo);
    if (repo.coverage) coverageCount++;
    if (repo.tests) testCount++;
  }

  for (const category of data.categories || []) {
    for (const repo of category.repositories || []) {
      const flatRepo = (data.repositories || []).find((item) => item.fullName === repo.fullName);
      if (flatRepo) {
        repo.coverage = flatRepo.coverage;
        repo.tests = flatRepo.tests;
        repo.releaseReadiness = flatRepo.releaseReadiness;
      }
    }
  }

  data.dataSources = data.dataSources || {};
  data.dataSources.coverage = {
    status: coverageCount ? 'connected' : 'unavailable',
    checkedAt: new Date().toISOString()
  };
  data.dataSources.tests = {
    status: testCount ? 'connected' : 'unavailable',
    checkedAt: new Date().toISOString()
  };

  await fs.writeFile(dataPath, JSON.stringify(data, null, 2));
  console.log(`✅ Coverage data merged into ${dataPath}: ${coverageCount}/${attempted} repositories with coverage`);
  console.log(`✅ Test results merged: ${testCount}/${attempted} repositories with published tests`);
}

main().catch((error) => {
  console.error('❌ Coverage aggregation failed:', error.message);
  process.exit(1);
});
