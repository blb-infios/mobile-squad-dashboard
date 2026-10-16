#!/usr/bin/env node
/**
 * Mobile Squad Dashboard - Data Aggregation Script
 * 
 * Fetches repository data from Azure DevOps and generates dashboard JSON
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

// Configuration
const ADO_ORG = process.env.ADO_ORG || 'Highjumpvso';
const ADO_PROJECT = process.env.ADO_PROJECT || 'WES';
const ADO_PAT = process.env.ADO_PAT || process.env.AZURE_DEVOPS_EXT_PAT;

if (!ADO_PAT) {
  console.error('❌ Error: ADO_PAT or AZURE_DEVOPS_EXT_PAT environment variable is required');
  process.exit(1);
}

// Repository definitions
const REPOSITORIES = {
  kmp: [
    { name: 'Koerber.Mobile.Kotlin.Dex', displayName: 'Dex' },
    { name: 'Koerber.Mobile.Kotlin.K1V1Authorization', displayName: 'K1V1 Authorization' },
    { name: 'Koerber.Mobile.Kotlin.BarcodeScanning', displayName: 'Scanner' },
    { name: 'Koerber.Mobile.Kotlin.Printing', displayName: 'Printing' },
    { name: 'Koerber.Mobile.Kotlin.Beep', displayName: 'Beep' },
    { name: 'Koerber.Mobile.Kotlin.Vibrate', displayName: 'Vibrate' }
  ],
  capacitor: [
    { name: 'Koerber.Mobile.Capacitor.K1Authorization', displayName: 'K1Authorization' },
    { name: 'Koerber.Mobile.Capacitor.Printing', displayName: 'Printing' },
    { name: 'Koerber.Mobile.Capacitor.Camera', displayName: 'Camera' },
    { name: 'Koerber.Mobile.Capacitor.Logger', displayName: 'Logger' },
    { name: 'Koerber.Mobile.Capacitor.Beep', displayName: 'Beep' },
    { name: 'Koerber.Mobile.Capacitor.MDMReader', displayName: 'MDM Reader' },
    { name: 'Koerber.Mobile.Capacitor.Vibrate', displayName: 'Vibrate' }
  ],
  security: [
    { name: 'MobileToolKit.Maintenance', displayName: 'Security Automation' }
  ]
};

// ADO API client
const adoClient = axios.create({
  baseURL: `https://dev.azure.com/${ADO_ORG}/${ADO_PROJECT}/_apis`,
  auth: {
    username: '',
    password: ADO_PAT
  },
  headers: {
    'Content-Type': 'application/json'
  }
});

/**
 * Fetch all repositories
 */
async function fetchRepositories() {
  console.log('📦 Fetching repositories...');
  const response = await adoClient.get('/git/repositories', {
    params: { 'api-version': '7.0' }
  });
  return response.data.value;
}

/**
 * Fetch latest build for a repository
 */
async function fetchLatestBuild(repoName) {
  try {
    // Try to find pipelines for this repository
    const pipelinesResponse = await adoClient.get('/pipelines', {
      params: {
        'api-version': '7.0'
      }
    });
    
    // Find pipeline that matches the repository name
    const pipeline = pipelinesResponse.data.value.find(p => 
      p.name.includes(repoName) || 
      p.name.toLowerCase().includes(repoName.toLowerCase().split('.').pop())
    );
    
    if (!pipeline) {
      return null;
    }
    
    // Get latest run for this pipeline
    const runsResponse = await adoClient.get(`/pipelines/${pipeline.id}/runs`, {
      params: {
        'api-version': '7.0',
        '$top': 1
      }
    });
    
    const run = runsResponse.data.value[0];
    if (!run) return null;
    
    // Map to build format
    return {
      id: run.id,
      buildNumber: run.name,
      result: run.result?.toLowerCase() || 'unknown',
      status: run.state,
      finishTime: run.finishedDate,
      _links: {
        web: {
          href: run._links?.web?.href || `https://dev.azure.com/${ADO_ORG}/${ADO_PROJECT}/_build/results?buildId=${run.id}`
        }
      }
    };
  } catch (error) {
    // Silently ignore - build data is optional
    return null;
  }
}

/**
 * Fetch latest commit for a repository
 */
async function fetchLatestCommit(repoId, branch = 'develop') {
  try {
    const response = await adoClient.get(`/git/repositories/${repoId}/commits`, {
      params: {
        'api-version': '7.0',
        'searchCriteria.itemVersion.version': branch,
        '$top': 1
      }
    });
    return response.data.value[0] || null;
  } catch (error) {
    console.warn(`  ⚠️  Could not fetch commits for repo ${repoId}:`, error.message);
    return null;
  }
}

/**
 * Fetch pull requests for a repository
 */
async function fetchPullRequests(repoId) {
  try {
    const response = await adoClient.get(`/git/repositories/${repoId}/pullrequests`, {
      params: {
        'api-version': '7.0',
        'searchCriteria.status': 'active',
        '$top': 10
      }
    });
    return response.data.value || [];
  } catch (error) {
    console.warn(`  ⚠️  Could not fetch PRs for repo ${repoId}:`, error.message);
    return [];
  }
}

/**
 * Determine repository health status
 */
function calculateHealth(build, prs) {
  if (!build) return { status: 'unknown', label: 'No Data', color: '#999' };
  
  const hasFailedPRs = prs.some(pr => pr.mergeStatus === 'conflicts' || pr.mergeStatus === 'failure');
  
  if (build.result === 'succeeded' && !hasFailedPRs) {
    return { status: 'healthy', label: 'Healthy', color: '#28a745' };
  } else if (build.result === 'partiallySucceeded' || hasFailedPRs) {
    return { status: 'warning', label: 'Warning', color: '#ffc107' };
  } else if (build.result === 'failed' || build.result === 'canceled') {
    return { status: 'unhealthy', label: 'Unhealthy', color: '#dc3545' };
  }
  
  return { status: 'unknown', label: 'Unknown', color: '#6c757d' };
}

/**
 * Aggregate data for all repositories
 */
async function aggregateData() {
  console.log('🚀 Starting data aggregation...\n');
  
  // Fetch all repositories from ADO
  const allRepos = await fetchRepositories();
  const repoMap = new Map(allRepos.map(r => [r.name, r]));
  
  const dashboardData = {
    generatedAt: new Date().toISOString(),
    summary: {
      total: 0,
      healthy: 0,
      warning: 0,
      unhealthy: 0,
      unknown: 0
    },
    categories: [],
    repositories: [] // Flat list for new UI
  };
  
  // Process each category
  for (const [category, repos] of Object.entries(REPOSITORIES)) {
    console.log(`\n📁 Processing ${category.toUpperCase()} repositories...`);
    
    const categoryData = {
      name: category,
      displayName: category.charAt(0).toUpperCase() + category.slice(1),
      repositories: []
    };
    
    for (const repoDef of repos) {
      const repo = repoMap.get(repoDef.name);
      
      if (!repo) {
        console.log(`  ⚠️  Repository not found: ${repoDef.name}`);
        categoryData.repositories.push({
          name: repoDef.displayName,
          fullName: repoDef.name,
          health: { status: 'unknown', label: 'Not Found', color: '#999' },
          url: '#',
          lastBuild: null,
          lastCommit: null,
          activePRs: 0
        });
        dashboardData.summary.unknown++;
        continue;
      }
      
      console.log(`  ✓ ${repoDef.displayName}`);
      
      // Fetch data in parallel
      const [build, commit, prs] = await Promise.all([
        fetchLatestBuild(repo.name),
        fetchLatestCommit(repo.id),
        fetchPullRequests(repo.id)
      ]);
      
      const health = calculateHealth(build, prs);
      
      const repoData = {
        name: repoDef.displayName,
        fullName: repo.name,
        health,
        url: repo.webUrl,
        lastBuild: build ? {
          id: build.id,
          number: build.buildNumber,
          result: build.result,
          status: build.status,
          finishTime: build.finishTime,
          url: build._links.web.href
        } : null,
        lastCommit: commit ? {
          id: commit.commitId.substring(0, 7),
          message: commit.comment.split('\n')[0],
          author: commit.author.name,
          date: commit.author.date,
          url: commit.remoteUrl
        } : null,
        activePRs: prs.length,
        pullRequests: prs.map(pr => ({
          id: pr.pullRequestId,
          title: pr.title,
          author: pr.createdBy.displayName,
          status: pr.status,
          url: `https://dev.azure.com/${ADO_ORG}/${ADO_PROJECT}/_git/${repo.name}/pullrequest/${pr.pullRequestId}`
        }))
      };
      
      categoryData.repositories.push(repoData);
      dashboardData.summary[health.status]++;
      
      // Add to flat repositories array for new UI
      dashboardData.repositories.push({
        ...repoData,
        category: category, // Add category for filtering
        type: category.toUpperCase() // For type filter
      });
    }
    
    dashboardData.categories.push(categoryData);
    dashboardData.summary.total += categoryData.repositories.length;
  }
  
  return dashboardData;
}

/**
 * Main execution
 */
async function main() {
  try {
    const data = await aggregateData();
    
    // Write to public directory
    const outputPath = path.join(__dirname, '../public/data.json');
    await fs.writeFile(outputPath, JSON.stringify(data, null, 2));
    
    console.log('\n✅ Data aggregation complete!');
    console.log(`📊 Summary: ${data.summary.total} repos - ` +
      `${data.summary.healthy} healthy, ` +
      `${data.summary.warning} warning, ` +
      `${data.summary.unhealthy} unhealthy, ` +
      `${data.summary.unknown} unknown`);
    console.log(`💾 Data written to: ${outputPath}`);
    
  } catch (error) {
    console.error('\n❌ Error during aggregation:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { aggregateData };
