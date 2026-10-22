#!/usr/bin/env node
/**
 * Fetch Snyk data separately from Azure DevOps aggregation.
 * Reads the ADO-generated public/data.json and merges Snyk results into it.
 */

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const {
  calculateHealth,
  calculateReleaseReadiness,
  createHistorySnapshot,
  fetchSnykData,
  fetchSnykIssues,
  fetchSnykProjects
} = require('./aggregate');

async function main() {
  const dataPath = path.join(__dirname, '../public/data.json');
  const data = JSON.parse(await fs.readFile(dataPath, 'utf8'));
  const projects = await fetchSnykProjects();
  const issues = await fetchSnykIssues();

  for (const repo of data.repositories || []) {
    const snyk = await fetchSnykData(projects, issues, {
      name: repo.name,
      displayName: repo.name,
      fullName: repo.fullName,
      category: repo.category,
      snykNames: repo.snykNames || [],
      packageName: repo.packages?.npm || repo.packages?.maven || null
    });
    repo.snyk = snyk
      ? { ...snyk, issues: Array.isArray(snyk.issues) ? snyk.issues : [] }
      : null;
    repo.health = calculateHealth(repo.pipelines || {}, snyk);
    repo.releaseReadiness = calculateReleaseReadiness(repo);
  }

  for (const category of data.categories || []) {
    for (const repo of category.repositories || []) {
      const flatRepo = (data.repositories || []).find((item) => item.fullName === repo.fullName);
      if (flatRepo) {
        repo.snyk = flatRepo.snyk;
        repo.health = flatRepo.health;
        repo.releaseReadiness = flatRepo.releaseReadiness;
      }
    }
  }

  const checkedAt = new Date().toISOString();
  data.dataSources = data.dataSources || {};
  data.dataSources.snyk = {
    status: issues.available ? 'connected' : 'unavailable',
    checkedAt
  };
  const historyPath = path.join(__dirname, '../public/history.json');
  try {
    const history = JSON.parse(await fs.readFile(historyPath, 'utf8'));
    const snapshots = Array.isArray(history.snapshots) ? history.snapshots : [];
    const snapshot = createHistorySnapshot(data);
    if (snapshots.at(-1)?.timestamp === data.generatedAt) snapshots[snapshots.length - 1] = snapshot;
    else snapshots.push(snapshot);
    await fs.writeFile(historyPath, JSON.stringify({ snapshots: snapshots.slice(-90) }, null, 2));
    data.history = snapshots.slice(-90);
  } catch (_) {
    // The ADO step creates history; a missing file should not block Snyk data.
  }

  await fs.writeFile(dataPath, JSON.stringify(data, null, 2));
  console.log(`✅ Snyk data merged into ${dataPath}`);
}

main().catch((error) => {
  console.error('❌ Snyk aggregation failed:', error.message);
  process.exit(1);
});
