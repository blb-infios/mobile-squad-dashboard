#!/usr/bin/env node
/**
 * Mobile Squad Dashboard - real data aggregation.
 *
 * Required: ADO_PAT, ADO_ORG, ADO_PROJECT
 * Optional: SNYK_TOKEN, SNYK_ORG_ID, SNYK_API
 *
 * The script deliberately returns null/zero for a source that is not
 * configured or accessible. It never invents dashboard values.
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const ADO_ORG = process.env.ADO_ORG || 'Highjumpvso';
const ADO_PROJECT = process.env.ADO_PROJECT || 'WES';
const ADO_PAT = process.env.ADO_PAT || process.env.AZURE_DEVOPS_EXT_PAT;
const ADO_API_VERSION = '7.1';
const SNYK_TOKEN = process.env.SNYK_TOKEN;
const SNYK_ORG_ID = process.env.SNYK_ORG_ID;
const SNYK_API = (process.env.SNYK_API || 'https://api.eu.snyk.io')
  .replace(/\/rest\/?$/, '')
  .replace(/\/$/, '');
const SNYK_REST_API = `${SNYK_API}/rest`;
const SNYK_API_VERSION = process.env.SNYK_API_VERSION || '2024-10-15';
const SKIP_SNYK = process.env.SKIP_SNYK === 'true';
const REPOSITORY_CONFIG = require('../config/repositories.json');

if (!ADO_PAT && require.main === module) {
  console.error('❌ Error: ADO_PAT or AZURE_DEVOPS_EXT_PAT environment variable is required');
  process.exit(1);
}

const REPOSITORIES = {
  kmp: [
    { name: 'Koerber.Mobile.Kotlin.Dex',              displayName: 'Dex',              snykNames: ['KMP-App-Template-Native'] },
    { name: 'Koerber.Mobile.Kotlin.K1V1Authorization', displayName: 'K1V1 Authorization', snykNames: ['CommunicationApp3', 'KotlinUtilityApp'] },
    { name: 'Koerber.Mobile.Kotlin.BarcodeScanning',  displayName: 'Scanner' },
    { name: 'Koerber.Mobile.Kotlin.Printing',          displayName: 'Printing' },
    { name: 'Koerber.Mobile.Kotlin.Beep',              displayName: 'Beep' },
    { name: 'Koerber.Mobile.Kotlin.Vibrate',           displayName: 'Vibrate' }
  ],
  capacitor: [
    { name: 'Koerber.Mobile.Capacitor.K1Authorization', displayName: 'K1Authorization' },
    { name: 'Koerber.Mobile.Capacitor.Printing',        displayName: 'Printing' },
    { name: 'Koerber.Mobile.Capacitor.Camera',          displayName: 'Camera' },
    { name: 'Koerber.Mobile.Capacitor.Logger',          displayName: 'Logger' },
    { name: 'Koerber.Mobile.Capacitor.Beep',            displayName: 'Beep' },
    { name: 'Koerber.Mobile.Capacitor.MDMReader',       displayName: 'MDM Reader' },
    { name: 'Koerber.Mobile.Capacitor.Vibrate',         displayName: 'Vibrate' }
  ],
  security: [
    { name: 'MobileToolKit.Maintenance', displayName: 'Security Automation' }
  ]
};

const adoClient = axios.create({
  baseURL: `https://dev.azure.com/${ADO_ORG}/${ADO_PROJECT}/_apis`,
  auth: { username: '', password: ADO_PAT },
  headers: { Accept: 'application/json' },
  timeout: 30000
});

const snykClient = axios.create({
  baseURL: SNYK_REST_API,
  headers: SNYK_TOKEN ? {
    Accept: 'application/vnd.api+json',
    Authorization: `token ${SNYK_TOKEN}`
  } : {},
  timeout: 30000
});

const apiParams = (extra = {}) => ({ 'api-version': ADO_API_VERSION, ...extra });
const dollarTop = (value) => ({ [String.fromCharCode(36) + 'top']: value });

function warn(message, error) {
  const detail = error?.response?.status ? ` (${error.response.status})` : '';
  console.warn(`  ⚠️ ${message}${detail}`);
}

async function optionalGet(url, config, message, fallback) {
  try {
    return (await adoClient.get(url, config)).data;
  } catch (error) {
    warn(message, error);
    return fallback;
  }
}

async function fetchRepositories() {
  console.log('📦 Fetching repositories...');
  const response = await adoClient.get('/git/repositories', { params: apiParams() });
  return response.data.value || [];
}

async function fetchBuilds(repoId) {
  const data = await optionalGet(
    '/build/builds',
    { params: apiParams({
      repositoryId: repoId,
      repositoryType: 'TfsGit',
      queryOrder: 'finishTimeDescending',
      ...dollarTop(50)
    }) },
    `Could not fetch builds for repository ${repoId}`,
    { value: [] }
  );
  return data.value || [];
}

function isReleaseBuild(build) {
  const name = String(build.definition?.name || '').toLowerCase();
  return /(^|[.\-_ ])(release|prod|production|publish)([.\-_ ]|$)/i.test(name);
}

function duration(start, finish) {
  if (!start || !finish) return null;
  const seconds = Math.max(0, (Date.parse(finish) - Date.parse(start)) / 1000);
  if (!Number.isFinite(seconds)) return null;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

function pipelineStatus(build) {
  if (!build) return 'notRun';
  if (String(build.status).toLowerCase() === 'inprogress') return 'inProgress';
  const result = String(build.result || '').toLowerCase();
  return {
    succeeded: 'succeeded',
    failed: 'failed',
    partiallysucceeded: 'partiallySucceeded',
    canceled: 'canceled'
  }[result] || 'notRun';
}

function buildToPipeline(build, fallbackName) {
  if (!build) return null;
  return {
    name: build.definition?.name || fallbackName,
    status: pipelineStatus(build),
    lastRun: build.finishTime || build.startTime || null,
    duration: duration(build.startTime, build.finishTime),
    url: build._links?.web?.href || `https://dev.azure.com/${ADO_ORG}/${ADO_PROJECT}/_build/results?buildId=${build.id}`
  };
}

function pipelinesFromBuilds(builds) {
  const release = builds.find(isReleaseBuild) || null;
  const ci = builds.find((build) => !isReleaseBuild(build)) || null;
  return {
    ci: buildToPipeline(ci, 'CI Pipeline'),
    release: buildToPipeline(release, 'Release Pipeline')
  };
}

async function fetchCommit(repoId, branch = 'develop') {
  const data = await optionalGet(
    `/git/repositories/${repoId}/commits`,
    { params: apiParams({
      'searchCriteria.itemVersion.version': branch,
      'searchCriteria.itemVersion.versionType': 'branch',
      ...dollarTop(1)
    }) },
    `Could not fetch ${branch} commit for repository ${repoId}`,
    { value: [] }
  );
  return data.value?.[0] || null;
}

async function fetchLatestCommit(repoId) {
  return (await fetchCommit(repoId, 'develop')) ||
    (await fetchCommit(repoId, 'main')) ||
    (await fetchCommit(repoId, 'master'));
}

async function fetchPullRequests(repoId) {
  const data = await optionalGet(
    `/git/repositories/${repoId}/pullrequests`,
    { params: apiParams({ 'searchCriteria.status': 'active', ...dollarTop(50) }) },
    `Could not fetch pull requests for repository ${repoId}`,
    { value: [] }
  );
  return data.value || [];
}

async function listSourceFiles(repoId, branch) {
  const data = await optionalGet(
    `/git/repositories/${repoId}/items`,
    { params: apiParams({
      scopePath: '/',
      recursionLevel: 'Full',
      includeContentMetadata: true,
      'versionDescriptor.version': branch,
      'versionDescriptor.versionType': 'branch',
      ...dollarTop(1000)
    }) },
    `Could not list source files for repository ${repoId}`,
    { value: [] }
  );
  return data.value || [];
}

async function readSourceFile(repoId, itemPath, branch) {
  try {
    const response = await adoClient.get(`/git/repositories/${repoId}/items`, {
      params: apiParams({
        path: itemPath,
        includeContent: true,
        'versionDescriptor.version': branch,
        'versionDescriptor.versionType': 'branch'
      })
    });
    return response.data.content || '';
  } catch (_) {
    return null;
  }
}

function parseVersion(content, itemPath) {
  if (!content) return null;
  if (itemPath.toLowerCase().endsWith('package.json')) {
    try { return JSON.parse(content).version || null; } catch (_) { return null; }
  }
  const matches = [
    /(?:^|\n)\s*(?:val\s+|var\s+)?libBaseVersion\s*=\s*["']([^"']+)["']/i,
    /(?:^|\n)\s*(?:val\s+|var\s+)?libVersion(?:Android|Ios)\s*=\s*[^\n]*?["']([0-9]+\.[0-9]+\.[0-9]+(?:[-+][^\s"']+)*)["']/i,
    /(?:^|\n)\s*(?:VERSION_NAME|version)\s*[:=]\s*["']?([0-9]+\.[0-9]+\.[0-9]+(?:[-+][^\s"']+)*)/i,
    /(?:^|\n)\s*version\s*=\s*["']([^"']+)["']/i
  ];
  for (const pattern of matches) {
    const match = content.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function parsePackage(content, itemPath) {
  if (!content) return { npm: null, maven: null };
  if (itemPath.toLowerCase().endsWith('package.json')) {
    try {
      const pkg = JSON.parse(content);
      return { npm: pkg.name || null, maven: null };
    } catch (_) { return { npm: null, maven: null }; }
  }
  const variables = Object.fromEntries(
    [...content.matchAll(/(?:^|\n)\s*(?:val\s+|var\s+)?([A-Za-z][A-Za-z0-9_]*)\s*=\s*["']([^"']+)["']/g)]
      .map((match) => [match[1], match[2]])
  );
  const group = variables.libGroupId || variables.groupId || content.match(/(?:^|\n)\s*group\s*=\s*["']([^"']+)["']/i)?.[1] || null;
  const artifactCandidates = [
    variables.libArtifactId,
    ...[...content.matchAll(/artifactId\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]),
    content.match(/artifactId\s*=\s*artifactId\.replace\(\s*["'][^"']+["']\s*,\s*["']([^"']+)["']\s*\)/i)?.[1]
  ].filter(Boolean);
  const artifact = artifactCandidates.find((value) => /library|plugin|capacitor|scanner|printing|beep|vibrate|authorization|camera|logger/i.test(value)) || artifactCandidates[0] || null;
  return { npm: null, maven: group && artifact && !/[${}]/.test(artifact) ? `${group}:${artifact}` : null };
}

const ARTIFACT_FEEDS = {
  dev: {
    project: 'WES',
    feed: '24dda4c8-5fdf-4aa7-8c63-a1e73bdeab56'
  },
  platform: {
    project: 'Platform',
    feed: '315a4d70-8267-47c1-a02a-b679a538e1d2'
  }
};

const artifactClient = axios.create({
  baseURL: `https://feeds.dev.azure.com/${ADO_ORG}`,
  auth: { username: '', password: ADO_PAT },
  headers: { Accept: 'application/json' },
  timeout: 30000
});
const artifactVersionCache = new Map();
let artifactAccessWarningShown = false;

async function fetchArtifactVersion(feedKey, packageName, protocol) {
  if (!packageName) return null;
  const feed = ARTIFACT_FEEDS[feedKey];
  if (!feed) return null;
  const cacheKey = `${feedKey}:${protocol}:${packageName}`;
  if (artifactVersionCache.has(cacheKey)) return artifactVersionCache.get(cacheKey);

  try {
    const packageResponse = await artifactClient.get(`/${encodeURIComponent(feed.project)}/_apis/packaging/feeds/${feed.feed}/packages`, {
      params: {
        protocolType: protocol,
        packageNameQuery: packageName,
        includeAllVersions: false,
        isListed: true,
        'api-version': '7.1'
      }
    });
    const candidate = (packageResponse.data.value || []).find((item) =>
      String(item.name || '').toLowerCase() === String(packageName).toLowerCase()
    ) || packageResponse.data.value?.[0];
    if (!candidate?.id) {
      artifactVersionCache.set(cacheKey, null);
      return null;
    }

    const versionsResponse = await artifactClient.get(`/${encodeURIComponent(feed.project)}/_apis/packaging/feeds/${feed.feed}/packages/${candidate.id}/versions`, {
      params: { isListed: true, 'api-version': '7.1' }
    });
    const versions = (versionsResponse.data.value || [])
      .filter((item) => item.version)
      .sort((a, b) => Date.parse(b.publishDate || 0) - Date.parse(a.publishDate || 0));
    const version = versions[0]?.version || null;
    artifactVersionCache.set(cacheKey, version);
    return version;
  } catch (error) {
    if (!artifactAccessWarningShown) {
      warn('Azure Artifacts unavailable; add Packaging Read to ADO_PAT to populate feed versions', error);
      artifactAccessWarningShown = true;
    }
    artifactVersionCache.set(cacheKey, null);
    return null;
  }
}

async function fetchFeedVersions(metadata, category) {
  const protocol = metadata.packages.npm ? 'Npm' : metadata.packages.maven ? 'Maven' : null;
  const packageName = metadata.packages.npm || metadata.packages.maven?.split(':')[1];
  if (!protocol || !packageName) return { devFeed: null, platformFeed: null };
  const [devFeed, platformFeed] = await Promise.all([
    fetchArtifactVersion('dev', packageName, protocol),
    category === 'security' ? null : fetchArtifactVersion('platform', packageName, protocol)
  ]);
  return { devFeed, platformFeed };
}

async function fetchSourceMetadata(repoId) {
  for (const branch of ['develop', 'main', 'master']) {
    const files = await listSourceFiles(repoId, branch);
    const candidates = files
      .filter((item) => item.gitObjectType === 'blob' || item.itemType === 'file')
      .map((item) => item.path)
      .filter((itemPath) => /(^|\/)(package\.json|gradle\.properties|build\.gradle(?:\.kts)?|libs\.versions\.toml)$/i.test(itemPath));
    const parsed = [];

    for (const itemPath of candidates) {
      const content = await readSourceFile(repoId, itemPath, branch);
      const version = parseVersion(content, itemPath);
      const packages = parsePackage(content, itemPath);
      if (version || packages.npm || packages.maven) parsed.push({ version, packages, branch, path: itemPath });
    }

    // Prefer the published plugin/library manifest over example apps and build tooling.
    const officialPackage = parsed.find((item) =>
      String(item.packages.npm || '').startsWith('@koerber/mobile-capacitor-')
    );
    const publishedMaven = parsed.find((item) => {
      const artifact = String(item.packages.maven || '').split(':')[1] || '';
      return /(?:library|scanner|printing|beep|vibrate|authorization|camera|logger)/i.test(artifact);
    });
    const selected = officialPackage || publishedMaven || parsed[0];
    if (selected) return selected;
  }
  return { version: null, packages: { npm: null, maven: null }, branch: null, path: null };
}

function classifyWorkItem(state) {
  const normalized = String(state || '').toLowerCase();
  if (['new', 'approved', 'proposed', 'to do', 'open'].includes(normalized)) return 'open';
  if (['active', 'in progress', 'doing'].includes(normalized)) return 'inProgress';
  if (['committed', 'resolved', 'closed', 'done', 'completed'].includes(normalized)) return 'committed';
  return 'open';
}

async function fetchWorkItemIds(repoId, pullRequests, builds) {
  const ids = new Set();

  // Build work-item refs are the authoritative links for commits included in a build.
  const buildLinks = await Promise.all((builds || []).slice(0, 2).map((build) => optionalGet(
    `/build/builds/${build.id}/workitems`,
    { params: apiParams() },
    `Could not fetch work items for build ${build.id}`,
    { value: [] }
  )));
  buildLinks.forEach((data) => (data.value || []).forEach((item) => ids.add(item.id)));

  // Include work items explicitly linked to active pull requests as well.
  const prLinks = await Promise.all((pullRequests || []).slice(0, 20).map((pr) => optionalGet(
    `/git/repositories/${repoId}/pullrequests/${pr.pullRequestId}/workitems`,
    { params: apiParams() },
    `Could not fetch work-item links for PR ${pr.pullRequestId}`,
    { value: [] }
  )));
  prLinks.forEach((data) => (data.value || []).forEach((item) => ids.add(item.id)));
  return [...ids];
}

async function fetchWorkItems(repoId, pullRequests, builds) {
  const ids = await fetchWorkItemIds(repoId, pullRequests, builds);
  const result = { open: 0, inProgress: 0, committed: 0, url: `https://dev.azure.com/${ADO_ORG}/${ADO_PROJECT}/_queries` };
  if (!ids.length) return result;

  for (let start = 0; start < ids.length; start += 200) {
    const chunk = ids.slice(start, start + 200);
    const data = await optionalGet(
      '/wit/workitems',
      { params: apiParams({ ids: chunk.join(','), fields: 'System.State,System.WorkItemType' }) },
      `Could not fetch work-item details for repository ${repoId}`,
      { value: [] }
    );
    (data.value || []).forEach((item) => { result[classifyWorkItem(item.fields?.['System.State'])]++; });
  }
  return result;
}

function emptySnyk() {
  return { critical: 0, high: 0, medium: 0, low: 0, lastScan: null, url: null };
}

function masked(value) {
  const text = String(value || '');
  if (!text) return '(missing)';
  if (text.length <= 8) return `${text.slice(0, 2)}…${text.slice(-2)}`;
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

function resolveSnykUrl(url) {
  if (!url || /^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/rest/')) return `${SNYK_API}${url}`;
  return url;
}

function logSnyk(message) {
  console.log(`  🔐 Snyk: ${message}`);
}

function snykErrorDetail(error) {
  const status = error.response?.status || 'network';
  const body = error.response?.data;
  let detail = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : error.message;
  if (SNYK_TOKEN) detail = detail.split(SNYK_TOKEN).join('[REDACTED]');
  const config = error.config || {};
  const baseUrl = String(config.baseURL || '');
  const requestUrl = String(config.url || '');
  const fullUrl = /^https?:\/\//i.test(requestUrl) ? requestUrl : `${baseUrl}${requestUrl}`;
  const params = config.params ? JSON.stringify(config.params) : '{}';
  return `status=${status}, url=${fullUrl}, params=${params}, response=${detail}`;
}

async function fetchSnykTargets() {
  if (!SNYK_TOKEN || !SNYK_ORG_ID) return new Map();
  try {
    const targets = new Map();
    let nextUrl = `/orgs/${encodeURIComponent(SNYK_ORG_ID)}/targets`;
    let params = { version: SNYK_API_VERSION, limit: 100 };
    while (nextUrl) {
      const response = await snykClient.get(resolveSnykUrl(nextUrl), {
        params,
        headers: { 'Content-Type': 'application/vnd.api+json' }
      });
      (response.data.data || []).forEach((t) => {
        const name = t.attributes?.display_name || t.attributes?.displayName || null;
        if (t.id && name) targets.set(t.id, name);
      });
      nextUrl = response.data.links?.next || null;
      params = undefined;
    }
    logSnyk(`target lookup succeeded: ${targets.size} target(s)`);
    return targets;
  } catch (error) {
    warn('Could not fetch Snyk targets', error);
    return new Map();
  }
}

async function fetchSnykProjects() {
  const tokenConfigured = Boolean(SNYK_TOKEN);
  const orgConfigured = Boolean(SNYK_ORG_ID);
  logSnyk(`configuration token=${tokenConfigured ? 'present' : 'missing'}, org=${orgConfigured ? masked(SNYK_ORG_ID) : 'missing'}, api=${SNYK_REST_API}`);
  if (!tokenConfigured || !orgConfigured) {
    logSnyk('skipped because SNYK_TOKEN and SNYK_ORG_ID are required');
    return [];
  }

  try {
    const projects = [];
    let nextUrl = `/orgs/${encodeURIComponent(SNYK_ORG_ID)}/projects`;
    let params = { version: SNYK_API_VERSION, limit: 100 };
    let page = 0;
    while (nextUrl && page < 20) {
      const response = await snykClient.get(resolveSnykUrl(nextUrl), {
        params,
        headers: { 'Content-Type': 'application/vnd.api+json' }
      });
      const items = response.data.data || [];
      projects.push(...items.map((item) => {
        const attributes = item.attributes || {};
        return {
          id: item.id,
          name: attributes.name || item.id,
          targetId: item.relationships?.target?.data?.id || null,
          targetDisplayName: null,
          lastTestedDate: attributes.lastTestedDate || attributes.last_tested_date || attributes.lastTestedAt || attributes.last_tested_at || null,
          issueCounts: attributes.issueCountsBySeverity || attributes.issue_counts_by_severity || attributes.issueCounts || attributes.issue_counts || null,
          url: item.links?.self || null
        };
      }));
      nextUrl = response.data.links?.next || null;
      params = undefined;
      page++;
    }
    if (nextUrl) logSnyk(`project pagination stopped at ${page} pages; more pages remain`);

    // Enrich generic-named projects (e.g. "android") with their target display name
    const targetMap = await fetchSnykTargets();
    projects.forEach((p) => {
      if (p.targetId && targetMap.has(p.targetId)) {
        p.targetDisplayName = targetMap.get(p.targetId);
      }
    });

    logSnyk(`project lookup succeeded: ${projects.length} project(s) returned`);
    logSnyk('all project names:\n' + projects.map((p, i) =>
      `  ${i + 1}. [${masked(p.id)}] ${p.name}${p.targetDisplayName ? ` (target: ${p.targetDisplayName})` : ''}`
    ).join('\n'));
    return projects;
  } catch (error) {
    warn('Could not fetch Snyk projects; check SNYK_TOKEN, SNYK_ORG_ID, and API region', error);
    logSnyk(`project lookup failed: ${snykErrorDetail(error)}`);
    return [];
  }
}

async function fetchSnykIssues() {
  if (!SNYK_TOKEN || !SNYK_ORG_ID) return { available: false, byProject: new Map() };
  try {
    const issues = [];
    let nextUrl = `/orgs/${encodeURIComponent(SNYK_ORG_ID)}/issues`;
    let params = { version: SNYK_API_VERSION };
    let page = 0;
    while (nextUrl) {
      if (page >= 1000) throw new Error('Snyk issue pagination exceeded 1000 pages');
      const response = await snykClient.get(resolveSnykUrl(nextUrl), {
        params,
        headers: { 'Content-Type': 'application/vnd.api+json' }
      });
      issues.push(...(response.data.data || []));
      nextUrl = response.data.links?.next || null;
      params = undefined;
      page++;
    }
    const activeIssues = issues.filter(isActiveSnykIssue);
    const byProject = new Map();
    let unassociated = 0;
    activeIssues.forEach((issue) => {
      const relationships = issue.relationships || {};
      const projectId = relationshipId(relationships.scan_item) ||
        relationshipId(relationships.project) ||
        issue.attributes?.project_id ||
        issue.attributes?.projectId ||
        issue.attributes?.scan_item_id ||
        issue.attributes?.scanItemId;
      if (!projectId) {
        unassociated++;
        return;
      }
      if (!byProject.has(projectId)) byProject.set(projectId, []);
      byProject.get(projectId).push(issue);
    });
    logSnyk(`issue lookup succeeded with API version ${SNYK_API_VERSION}: ${activeIssues.length} active issue(s) from ${issues.length} total across ${byProject.size} project(s), ${unassociated} unassociated`);
    if (issues[0]) {
      logSnyk(`issue shape: attributes=${Object.keys(issues[0].attributes || {}).join(',') || 'none'}, relationships=${Object.keys(issues[0].relationships || {}).join(',') || 'none'}`);
    }
    return { available: true, byProject, totalIssues: activeIssues.length, unassociated };
  } catch (error) {
    warn('Could not fetch Snyk organization issues', error);
    logSnyk(`issue lookup failed: ${snykErrorDetail(error)}`);
    return { available: false, byProject: new Map() };
  }
}

function normalizeName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function snykProjectAliases(repo) {
  const suffix = String(repo.fullName || '').split('.').pop().toLowerCase();
  const display = String(repo.displayName || '').toLowerCase();
  const aliases = [repo.fullName, repo.packageName, repo.displayName];

  // Explicit Snyk project name overrides defined in REPOSITORIES
  if (Array.isArray(repo.snykNames)) {
    aliases.push(...repo.snykNames);
  }

  const synonyms = {
    scanner: ['barcode-scanner', 'barcode-scanning'],
    'k1v1 authorization': ['k1v1authorization'],
    'mdm reader': ['mdm-reader', 'mdmreader']
  };
  aliases.push(...(synonyms[display] || []));
  if (repo.category === 'capacitor') {
    aliases.push(`@koerber/mobile-capacitor-${suffix}`);
  } else if (repo.category === 'kmp') {
    aliases.push(`${suffix}-kmp-library`, `${suffix}kmp`, `kmp${suffix}demoapp`);
  }
  return aliases.filter(Boolean).map(normalizeName);
}

function projectMatchScore(candidateName, alias, repo, aliasIndex) {
  if (candidateName === alias) return 120 - aliasIndex;
  if (candidateName.includes(alias)) {
    if (repo.category === 'kmp' && candidateName.includes('capacitor')) return 0;
    if (repo.category === 'capacitor' && candidateName.includes('kmp')) return 0;
    if (repo.category === 'kmp' && (candidateName.includes('kmp') || candidateName.includes('barcode'))) return 95 - aliasIndex;
    if (repo.category === 'capacitor' && candidateName.includes('capacitor')) return 95 - aliasIndex;
    return 70 - aliasIndex;
  }
  if (alias.includes(candidateName) && candidateName.length > 6) return 60 - aliasIndex;
  return 0;
}

function adoRepoNameFromProject(projectName) {
  const match = String(projectName || '').match(/WES\/Koerber\.Mobile\.\w+\.(\w+)\s*\(/i);
  return match ? match[1].toLowerCase() : null;
}

function adoRepoNameFromTarget(targetDisplayName) {
  if (!targetDisplayName) return null;
  // e.g. "WES/_git/Koerber.Mobile.Capacitor.Camera" or "Koerber.Mobile.Capacitor.Camera"
  const match = String(targetDisplayName).match(/Koerber\.Mobile\.\w+\.(\w+)/i);
  return match ? match[1].toLowerCase() : null;
}

function findSnykProjects(projects, repo) {
  const aliases = snykProjectAliases(repo);
  const repoSuffix = String(repo.fullName || '').split('.').pop().toLowerCase();
  const matched = [];
  projects.forEach((candidate) => {
    // ADO-monitored projects (WES/Koerber.Mobile.X.RepoName(develop):...) must match this repo
    const adoRepo = adoRepoNameFromProject(candidate.name)
      || adoRepoNameFromTarget(candidate.targetDisplayName);
    if (adoRepo && adoRepo !== repoSuffix) return;

    const candidateName = normalizeName(candidate.name);
    // For generic project names ("android", "ios"), use target display name for matching instead
    const effectiveCandidateName = ['android', 'ios'].includes(candidateName) && candidate.targetDisplayName
      ? normalizeName(candidate.targetDisplayName)
      : candidateName;
    const score = aliases.reduce((best, alias, index) =>
      Math.max(best, projectMatchScore(effectiveCandidateName, alias, repo, index)), 0);
    if (score >= 60) matched.push({ project: candidate, score });
  });
  matched.sort((a, b) => b.score - a.score);
  return matched.map((item) => item.project);
}

function relationshipId(relationship) {
  const data = relationship?.data;
  return Array.isArray(data) ? data[0]?.id : data?.id;
}

function isActiveSnykIssue(issue) {
  const attributes = issue.attributes || {};
  const status = String(attributes.status || '').toLowerCase();
  if (attributes.ignored === true || ['resolved', 'ignored', 'closed'].includes(status)) return false;
  if (status) return ['open', 'active', 'new'].includes(status);
  const coordinates = Array.isArray(attributes.coordinates) ? attributes.coordinates : [];
  return coordinates.length === 0 || coordinates.some((coordinate) => {
    const state = String(coordinate.state || '').toLowerCase();
    return !['resolved', 'ignored', 'closed'].includes(state);
  });
}

function severityFromSnykIssue(issue) {
  return String(
    issue.attributes?.effective_severity_level ||
    issue.attributes?.effectiveSeverityLevel ||
    issue.attributes?.severity ||
    issue.attributes?.issueData?.severity ||
    ''
  ).toLowerCase();
}

function applySeverityCounts(target, source) {
  if (!source || typeof source !== 'object') return false;
  let applied = false;
  for (const severity of ['critical', 'high', 'medium', 'low']) {
    const value = Number(source[severity] ?? source[severity.toUpperCase()]);
    if (Number.isFinite(value)) {
      target[severity] = value;
      applied = true;
    }
  }
  return applied;
}

async function fetchSnykData(projects, issuesResult, repo) {
  if (!projects.length) {
    logSnyk(`${repo.name}: no project data available`);
    return null;
  }
  if (!issuesResult.available) {
    logSnyk(`${repo.name}: issue lookup failed; not reporting zero vulnerabilities`);
    return null;
  }
  const matchedProjects = findSnykProjects(projects, repo);
  if (!matchedProjects.length) {
    logSnyk(`${repo.name}: no matching Snyk project found`);
    return null;
  }

  const counts = emptySnyk();
  let totalMatched = 0;
  let latestScan = null;
  let primaryUrl = null;

  for (const project of matchedProjects) {
    const projectIssues = (issuesResult.byProject.get(project.id) || []).filter(isActiveSnykIssue);
    projectIssues.forEach((issue) => {
      const severity = severityFromSnykIssue(issue);
      if (Object.prototype.hasOwnProperty.call(counts, severity)) counts[severity]++;
    });
    totalMatched += projectIssues.length;
    if (project.lastTestedDate && (!latestScan || project.lastTestedDate > latestScan)) {
      latestScan = project.lastTestedDate;
    }
    if (!primaryUrl) primaryUrl = `https://app.snyk.io/org/${SNYK_ORG_ID}/project/${project.id}`;
  }

  const projectNames = matchedProjects.map((project) => `"${project.name}"`).join(', ');
  logSnyk(`${repo.name}: matched ${matchedProjects.length} project(s) [${projectNames}], ${totalMatched} active issue(s) - critical=${counts.critical}, high=${counts.high}, medium=${counts.medium}, low=${counts.low}`);
  counts.lastScan = latestScan;
  counts.url = primaryUrl;
  return counts;
}

function calculateHealth(pipelines, snyk) {
  const builds = Object.values(pipelines).filter(Boolean);
  const failed = builds.some((pipeline) => ['failed', 'canceled'].includes(pipeline.status));
  const vulnerabilities = Number(snyk?.critical || 0) + Number(snyk?.high || 0);
  if (!builds.length) return { status: 'unknown', label: 'No Data', color: '#999' };
  if (failed) return { status: 'unhealthy', label: 'Unhealthy', color: '#dc3545' };
  if (vulnerabilities > 0 || builds.some((pipeline) => pipeline.status === 'partiallySucceeded')) {
    return { status: 'warning', label: 'Warning', color: '#ffc107' };
  }
  return { status: 'healthy', label: 'Healthy', color: '#28a745' };
}

function baseVersion(value) {
  return String(value || '').trim().replace(/^v/i, '').split(/[-+]/)[0];
}

function calculateReleaseReadiness(repo) {
  const reasons = [];
  const versions = repo.versions || {};
  const pipelines = repo.pipelines || {};
  const snyk = repo.snyk;
  if (!versions.source) reasons.push('Source version unavailable');
  if (!versions.devFeed || !versions.platformFeed) reasons.push('Published feed version unavailable');
  if (versions.source && versions.devFeed && baseVersion(versions.source) !== baseVersion(versions.devFeed)) reasons.push('Dev feed differs from source');
  if (versions.source && versions.platformFeed && baseVersion(versions.source) !== baseVersion(versions.platformFeed)) reasons.push('Platform feed differs from source');
  if (!pipelines.ci) reasons.push('CI pipeline unavailable');
  else if (['failed', 'canceled'].includes(pipelines.ci.status)) reasons.push('CI pipeline failed');
  if (!pipelines.release) reasons.push('Release pipeline unavailable');
  else if (['failed', 'canceled'].includes(pipelines.release.status)) reasons.push('Release pipeline failed');
  if (snyk === null) reasons.push('Snyk data unavailable');
  else if (Number(snyk?.critical || 0) + Number(snyk?.high || 0) > 0) reasons.push('Critical/high vulnerabilities found');

  let status = 'ready';
  if (reasons.some((reason) => /vulnerabilit|pipeline failed/.test(reason))) status = 'blocked';
  else if (reasons.some((reason) => /differs/.test(reason))) status = 'versionDrift';
  else if (reasons.length) status = 'dataUnavailable';
  return { status, label: { ready: 'Ready', blocked: 'Blocked', versionDrift: 'Version drift', dataUnavailable: 'Data unavailable' }[status], reasons };
}

function buildDataSources(repositories, snykState) {
  const checkedAt = new Date().toISOString();
  const hasPipelines = repositories.some((repo) => repo.pipelines?.ci || repo.pipelines?.release);
  const hasWorkItems = repositories.some((repo) => {
    const work = repo.workItems || {};
    return work.open + work.inProgress + work.committed > 0;
  });
  const hasArtifacts = repositories.some((repo) => repo.versions?.devFeed || repo.versions?.platformFeed);
  return {
    repositories: { status: repositories.length ? 'connected' : 'unavailable', checkedAt },
    sourceCode: { status: repositories.some((repo) => repo.versions?.source) ? 'connected' : 'unavailable', checkedAt },
    pipelines: { status: hasPipelines ? 'connected' : 'unavailable', checkedAt },
    artifacts: { status: hasArtifacts ? 'connected' : 'unavailable', checkedAt },
    workItems: { status: hasWorkItems ? 'connected' : 'noData', checkedAt },
    snyk: { status: snykState.available ? 'connected' : snykState.configured ? 'unavailable' : 'notConfigured', checkedAt }
  };
}

function createHistorySnapshot(data) {
  return {
    timestamp: data.generatedAt,
    summary: data.summary,
    repositories: data.repositories.map((repo) => ({
      name: repo.name,
      fullName: repo.fullName,
      health: repo.health?.status || 'unknown',
      releaseReadiness: repo.releaseReadiness?.status || 'dataUnavailable',
      snyk: repo.snyk ? { critical: repo.snyk.critical, high: repo.snyk.high, medium: repo.snyk.medium, low: repo.snyk.low } : null,
      versions: repo.versions
    }))
  };
}

function createSnykState() {
  return {
    configured: Boolean(SNYK_TOKEN && SNYK_ORG_ID),
    available: Boolean(!SKIP_SNYK && SNYK_TOKEN && SNYK_ORG_ID)
  };
}

function repositoryData(repoDef, repo, category, commit, pullRequests, metadata, feedVersions, pipelines, workItems, snyk) {
  const health = calculateHealth(pipelines, snyk);
  const repoData = {
    name: repoDef.displayName,
    fullName: repo.name,
    health,
    url: repo.webUrl,
    platforms: category === 'kmp' ? ['android', 'ios', 'jvm'] : category === 'capacitor' ? ['android', 'ios', 'web'] : [],
    versions: {
      source: metadata.version,
      devFeed: feedVersions.devFeed,
      platformFeed: feedVersions.platformFeed
    },
    packages: metadata.packages,
    snykNames: repoDef.snykNames || [],
    pipelines,
    snyk,
    workItems,
    lastBuild: null,
    lastCommit: commit ? {
      id: String(commit.commitId || '').substring(0, 7),
      message: String(commit.comment || '').split('\n')[0],
      author: commit.author?.name || commit.committer?.name || 'Unknown',
      date: commit.author?.date || commit.committer?.date || null,
      url: commit.remoteUrl || null
    } : null,
    activePRs: pullRequests.length,
    pullRequests: pullRequests.map((pr) => ({
      id: pr.pullRequestId,
      title: pr.title,
      author: pr.createdBy?.displayName || 'Unknown',
      status: pr.status,
      url: `https://dev.azure.com/${ADO_ORG}/${ADO_PROJECT}/_git/${repo.name}/pullrequest/${pr.pullRequestId}`
    }))
  };

  repoData.releaseReadiness = calculateReleaseReadiness(repoData);
  const latestBuild = Object.values(pipelines).filter(Boolean).sort((a, b) => Date.parse(b.lastRun || 0) - Date.parse(a.lastRun || 0))[0];
  if (latestBuild) {
    repoData.lastBuild = {
      result: latestBuild.status,
      status: latestBuild.status,
      finishTime: latestBuild.lastRun,
      url: latestBuild.url
    };
  }
  return repoData;
}

async function aggregateData() {
  console.log('🚀 Starting real data aggregation...\n');
  const allRepos = await fetchRepositories();
  const repoMap = new Map(allRepos.map((repo) => [repo.name, repo]));
  const snykProjects = SKIP_SNYK ? [] : await fetchSnykProjects();
  const snykIssues = SKIP_SNYK
    ? { available: false, byProject: new Map() }
    : await fetchSnykIssues();
  const snykState = {
    configured: Boolean(SNYK_TOKEN && SNYK_ORG_ID),
    available: !SKIP_SNYK && Boolean(SNYK_TOKEN && SNYK_ORG_ID) && snykIssues.available
  };
  if (SKIP_SNYK) console.log('ℹ️ Snyk deferred to the separate Snyk aggregation step.');
  else if (!SNYK_TOKEN || !SNYK_ORG_ID) console.log('ℹ️ Snyk skipped: SNYK_TOKEN and SNYK_ORG_ID are not configured.');

  const generatedAt = new Date().toISOString();
  const dashboardData = {
    generatedAt,
    lastUpdated: generatedAt,
    summary: { total: 0, healthy: 0, warning: 0, unhealthy: 0, unknown: 0 },
    categories: [],
    repositories: []
  };

  for (const [category, definitions] of Object.entries(REPOSITORIES)) {
    console.log(`\n📁 Processing ${category.toUpperCase()} repositories...`);
    const categoryData = {
      name: category,
      displayName: category.charAt(0).toUpperCase() + category.slice(1),
      repositories: []
    };

    for (const repoDefinition of definitions) {
      const repoDef = { ...repoDefinition, ...(REPOSITORY_CONFIG[repoDefinition.name] || {}) };
      const repo = repoMap.get(repoDef.name);
      if (!repo) {
        console.log(`  ⚠️ Repository not found: ${repoDef.name}`);
        const missing = {
          name: repoDef.displayName,
          fullName: repoDef.name,
          category,
          type: category,
          health: { status: 'unknown', label: 'Not Found', color: '#999' },
          releaseReadiness: { status: 'dataUnavailable', label: 'Data unavailable', reasons: ['Repository not found'] },
          platforms: category === 'kmp' ? ['android', 'ios', 'jvm'] : category === 'capacitor' ? ['android', 'ios', 'web'] : [],
          versions: { source: null, devFeed: null, platformFeed: null },
          packages: { npm: null, maven: null },
          pipelines: { ci: null, release: null },
          snyk: emptySnyk(),
          workItems: { open: 0, inProgress: 0, committed: 0, url: `https://dev.azure.com/${ADO_ORG}/${ADO_PROJECT}/_queries` },
          url: null,
          lastBuild: null,
          lastCommit: null,
          activePRs: 0,
          pullRequests: []
        };
        categoryData.repositories.push(missing);
        dashboardData.repositories.push(missing);
        dashboardData.summary.unknown++;
        continue;
      }

      const [builds, commit, pullRequests, metadata] = await Promise.all([
        fetchBuilds(repo.id),
        fetchLatestCommit(repo.id),
        fetchPullRequests(repo.id),
        fetchSourceMetadata(repo.id)
      ]);
      const pipelines = pipelinesFromBuilds(builds);
      const [feedVersions, workItems, snyk] = await Promise.all([
        fetchFeedVersions(metadata, category),
        fetchWorkItems(repo.id, pullRequests, builds),
        fetchSnykData(snykProjects, snykIssues, { ...repoDef, fullName: repo.name, category, packageName: metadata.packages.npm || metadata.packages.maven })
      ]);
      const repoData = repositoryData(repoDef, repo, category, commit, pullRequests, metadata, feedVersions, pipelines, workItems, snyk);
      const flatData = { ...repoData, category, type: category };

      console.log(`  ✓ ${repoDef.displayName} (${metadata.version || 'source version unavailable'})`);
      categoryData.repositories.push(repoData);
      dashboardData.repositories.push(flatData);
      dashboardData.summary[repoData.health.status]++;
    }

    dashboardData.categories.push(categoryData);
    dashboardData.summary.total += categoryData.repositories.length;
  }
  dashboardData.dataSources = buildDataSources(dashboardData.repositories, snykState);
  return dashboardData;
}

async function loadHistory(historyPath) {
  try {
    const saved = JSON.parse(await fs.readFile(historyPath, 'utf8'));
    return Array.isArray(saved.snapshots) ? saved.snapshots : [];
  } catch (_) {
    return [];
  }
}

async function writeHistory(data, historyPath) {
  const snapshots = await loadHistory(historyPath);
  snapshots.push(createHistorySnapshot(data));
  const trimmed = snapshots.slice(-90);
  await fs.writeFile(historyPath, JSON.stringify({ snapshots: trimmed }, null, 2));
  data.history = trimmed;
}

async function main() {
  try {
    const data = await aggregateData();
    const outputPath = path.join(__dirname, '../public/data.json');
    const historyPath = path.join(__dirname, '../public/history.json');
    await writeHistory(data, historyPath);
    await fs.writeFile(outputPath, JSON.stringify(data, null, 2));
    console.log('\n✅ Real data aggregation complete!');
    console.log(`📊 Summary: ${data.summary.total} repos - ${data.summary.healthy} healthy, ${data.summary.warning} warning, ${data.summary.unhealthy} unhealthy, ${data.summary.unknown} unknown`);
    console.log(`💾 Data written to: ${outputPath}`);
  } catch (error) {
    console.error('\n❌ Error during aggregation:', error.message);
    if (error.response) console.error('Response data:', error.response.data);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = {
  aggregateData,
  calculateHealth,
  calculateReleaseReadiness,
  classifyWorkItem,
  createHistorySnapshot,
  emptySnyk,
  fetchSnykData,
  fetchSnykIssues,
  fetchSnykProjects,
  parseVersion
};
