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
      packageName: repo.packages?.npm || repo.packages?.maven || null
    });
    repo.snyk = snyk;
    repo.health = calculateHealth(repo.pipelines || {}, snyk);
  }

  for (const category of data.categories || []) {
    for (const repo of category.repositories || []) {
      const flatRepo = (data.repositories || []).find((item) => item.fullName === repo.fullName);
      if (flatRepo) {
        repo.snyk = flatRepo.snyk;
        repo.health = flatRepo.health;
      }
    }
  }

  await fs.writeFile(dataPath, JSON.stringify(data, null, 2));
  console.log(`✅ Snyk data merged into ${dataPath}`);
}

main().catch((error) => {
  console.error('❌ Snyk aggregation failed:', error.message);
  process.exit(1);
});
