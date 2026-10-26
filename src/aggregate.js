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
const SKIP_COVERAGE = process.env.SKIP_COVERAGE === 'true';
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

const WORK_ITEM_FIELDS = 'System.Title,System.State,System.WorkItemType,System.AssignedTo,System.CreatedDate';

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

let coverageAccessWarningShown = false;

function coverageTotals(modules) {
  return modules.reduce((summary, module) => {
    const stats = module?.statistics || module || {};
    summary.linesCovered += Number(stats.linesCovered || 0);
    summary.linesNotCovered += Number(stats.linesNotCovered || 0);
    summary.blocksCovered += Number(stats.blocksCovered || 0);
    summary.blocksNotCovered += Number(stats.blocksNotCovered || 0);
    return summary;
  }, { linesCovered: 0, linesNotCovered: 0, blocksCovered: 0, blocksNotCovered: 0 });
}

function coverageMetrics(totals) {
  const lineTotal = totals.linesCovered + totals.linesNotCovered;
  const blockTotal = totals.blocksCovered + totals.blocksNotCovered;
  return {
    lines: { covered: totals.linesCovered, total: lineTotal, percent: lineTotal ? (totals.linesCovered / lineTotal) * 100 : null },
    blocks: { covered: totals.blocksCovered, total: blockTotal, percent: blockTotal ? (totals.blocksCovered / blockTotal) * 100 : null }
  };
}

/**
 * Derive a platform bucket from a covered source-file name.
 *
 * Azure DevOps returns a single coverage record per build with an empty
 * configuration.flavor/platform, and its "modules" are individual source
 * files. Kotlin Multiplatform encodes the source set in the file name
 * (Platform.android.kt, ReportFileSource.jvm.kt, BeepSoundAndroid.kt), and
 * Capacitor plugins split by extension (.ts for web, .java for Android), so
 * the file name is the only available platform signal.
 *
 * Two matching styles are used deliberately:
 *   - dot-delimited suffixes are matched case-insensitively (Platform.ios.kt)
 *   - bare suffixes require a CamelCase boundary on the original casing, so
 *     "Scenarios.kt" is not mistaken for an iOS source file.
 *
 * Returns null when the file carries no platform signal at all.
 */
function classifyCoverageTarget(name, framework) {
  const file = String(name || '').trim();
  if (!file) return null;

  // Extension-only signals.
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(file)) return 'web';
  if (/\.(swift|mm?|h)$/i.test(file)) return 'ios';
  if (/\.java$/i.test(file)) return 'android';

  // Dot-delimited Kotlin source-set suffixes: Platform.android.kt
  const dotted = file.match(/\.(android|ios|apple|native|darwin|jvm|desktop|js|wasm|web|common)\.kts?$/i);
  if (dotted) return normalizeCoverageTarget(dotted[1]);

  // CamelCase suffixes on the original casing: BeepSoundAndroid.kt
  const camel = file.match(/[a-z0-9](Android|IOS|Ios|Apple|Native|Darwin|Jvm|JVM|Desktop|Web|Wasm)\.kts?$/);
  if (camel) return normalizeCoverageTarget(camel[1]);

  // Plain Kotlin with no source-set marker. A Capacitor plugin has no shared
  // Kotlin source set at all - its Kotlin lives in android/src - so these are
  // Android sources. Only KMP genuinely has common Kotlin.
  if (/\.kts?$/i.test(file)) {
    return String(framework || '').toLowerCase() === 'capacitor' ? 'android' : 'common';
  }
  return null;
}

function normalizeCoverageTarget(token) {
  const key = String(token).toLowerCase();
  if (key === 'apple' || key === 'native' || key === 'darwin') return 'ios';
  if (key === 'desktop') return 'jvm';
  if (key === 'js' || key === 'wasm') return 'web';
  return key;
}

/**
 * Group covered source files into platform buckets.
 * Returns null unless at least two distinct platforms are present, so a
 * repository without a real split does not render a single row that merely
 * restates the headline percentage.
 */
function coverageTargetsFromModules(modules, framework) {
  const buckets = new Map();
  modules.forEach((module) => {
    const target = classifyCoverageTarget(module?.name, framework);
    if (!target) return;
    if (!buckets.has(target)) buckets.set(target, []);
    buckets.get(target).push(module);
  });
  if (buckets.size < 2) return null;

  const targets = {};
  buckets.forEach((bucketModules, target) => {
    const metrics = coverageMetrics(coverageTotals(bucketModules));
    if (!metrics.lines.total && !metrics.blocks.total) return;
    targets[target] = {
      percent: metrics.lines.percent,
      lines: metrics.lines,
      blocks: metrics.blocks,
      files: bucketModules.length
    };
  });
  return Object.keys(targets).length > 1 ? targets : null;
}

function summarizeCoverage(data, buildId, framework) {
  const records = Array.isArray(data?.value) ? data.value : [];
  const modules = records.flatMap((record) => Array.isArray(record?.modules) ? record.modules : []);
  const totals = coverageTotals(modules);
  const metrics = coverageMetrics(totals);
  if (!metrics.lines.total && !metrics.blocks.total) return null;

  // Preferred split: ADO sometimes labels each record with a build flavor or
  // platform (configuration.flavor / configuration.platform). Most pipelines
  // here leave both empty, so this only applies when the values are present.
  const labelled = {};
  records.forEach((record) => {
    const config = record?.configuration || {};
    const targetName = record?.label || record?.name || record?.targetName || record?.target
      || config.platform || config.flavor;
    if (!targetName || !String(targetName).trim()) return;
    const targetModules = Array.isArray(record.modules) && record.modules.length ? record.modules : [record];
    const targetMetrics = coverageMetrics(coverageTotals(targetModules));
    if (targetMetrics.lines.total || targetMetrics.blocks.total) labelled[String(targetName).trim()] = {
      percent: targetMetrics.lines.percent,
      lines: targetMetrics.lines,
      blocks: targetMetrics.blocks
    };
  });

  // Fallback split: derive platforms from the covered source-file names.
  const targets = Object.keys(labelled).length > 1
    ? labelled
    : coverageTargetsFromModules(modules, framework);

  return {
    buildId,
    ...metrics,
    percent: metrics.lines.percent,
    targets,
    modules: modules.length
  };
}

async function fetchBuildCoverage(buildId, framework) {
  if (!buildId) return null;
  try {
    const data = await adoClient.get('/test/codecoverage', {
      params: { buildId, flags: 7, 'api-version': '7.0' }
    });
    return summarizeCoverage(data.data, buildId, framework);
  } catch (error) {
    if (!coverageAccessWarningShown) {
      warn(`Code coverage unavailable for build ${buildId}; add Test Management: Read to ADO_PAT`, error);
      coverageAccessWarningShown = true;
    }
    return null;
  }
}

function coverageSnapshot(coverage, build) {
  if (!coverage) return null;
  const runUrl = buildUrl(build);
  const url = runUrl ? `${runUrl}${runUrl.includes('?') ? '&' : '?'}view=codecoverage-tab` : null;
  return {
    buildId: coverage.buildId,
    timestamp: build.finishTime || build.startTime || null,
    percent: coverage.percent,
    lines: coverage.lines,
    blocks: coverage.blocks,
    targets: coverage.targets,
    url
  };
}

async function fetchLatestCoverage(builds, framework) {
  const candidates = [...(builds || [])]
    .filter((build) => !isReleaseBuild(build))
    .sort((a, b) => Date.parse(b.finishTime || b.startTime || 0) - Date.parse(a.finishTime || a.startTime || 0))
    .slice(0, 10);
  const snapshots = [];
  for (const build of candidates) {
    const coverage = await fetchBuildCoverage(build.id, framework);
    if (coverage) snapshots.push(coverageSnapshot(coverage, build));
  }
  const latest = snapshots[0];
  if (!latest) return null;
  const threshold = Number(process.env.COVERAGE_THRESHOLD || 80);
  const previous = snapshots[1] || null;
  const change = previous && Number.isFinite(Number(latest.percent)) && Number.isFinite(Number(previous.percent))
    ? Number(latest.percent) - Number(previous.percent)
    : null;
  return {
    ...latest,
    lastRun: latest.timestamp,
    threshold,
    thresholdStatus: Number.isFinite(Number(latest.percent)) ? (latest.percent >= threshold ? 'passing' : 'failing') : null,
    previous: previous ? { timestamp: previous.timestamp, percent: previous.percent, lines: previous.lines, blocks: previous.blocks } : null,
    change,
    history: snapshots
  };
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

function buildUrl(build) {
  return build?._links?.web?.href || (build?.id
    ? `https://dev.azure.com/${ADO_ORG}/${ADO_PROJECT}/_build/results?buildId=${build.id}`
    : null);
}

function buildBranch(build) {
  const branch = build?.sourceBranch || build?.branchName || null;
  return branch ? String(branch).replace(/^refs\/heads\//, '') : null;
}

function buildToRun(build, fallbackName) {
  if (!build) return null;
  return {
    name: build.definition?.name || fallbackName,
    buildId: build.id ?? null,
    status: pipelineStatus(build),
    lastRun: build.finishTime || build.startTime || null,
    duration: duration(build.startTime, build.finishTime),
    branch: buildBranch(build),
    url: buildUrl(build)
  };
}

function pipelineSummary(history) {
  const completed = history.filter((run) => !['inProgress', 'notRun'].includes(run.status));
  const succeeded = completed.filter((run) => run.status === 'succeeded').length;
  return {
    successRate: completed.length ? (succeeded / completed.length) * 100 : null,
    failedRuns: completed.filter((run) => run.status === 'failed').length,
    totalRuns: completed.length
  };
}

function pipelinesFromBuilds(builds) {
  const ordered = [...(builds || [])].sort((a, b) =>
    Date.parse(b.finishTime || b.startTime || 0) - Date.parse(a.finishTime || a.startTime || 0));
  const createPipeline = (release, fallbackName) => {
    const history = ordered
      .filter((build) => isReleaseBuild(build) === release)
      .slice(0, 10)
      .map((build) => buildToRun(build, fallbackName));
    if (!history.length) return null;
    const latest = history[0];
    return { ...latest, ...pipelineSummary(history), history };
  };
  return {
    ci: createPipeline(false, 'CI Pipeline'),
    release: createPipeline(true, 'Release Pipeline')
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

async function fetchPullRequestStatuses(repoId, pullRequestId) {
  const data = await optionalGet(
    `/git/repositories/${repoId}/pullrequests/${pullRequestId}/statuses`,
    { params: apiParams() },
    `Could not fetch statuses for pull request ${pullRequestId}`,
    { value: [] }
  );
  return data.value || [];
}

async function fetchPullRequests(repoId) {
  const data = await optionalGet(
    `/git/repositories/${repoId}/pullrequests`,
    { params: apiParams({ 'searchCriteria.status': 'active', ...dollarTop(50) }) },
    `Could not fetch pull requests for repository ${repoId}`,
    { value: [] }
  );
  return Promise.all((data.value || []).map(async (pullRequest) => ({
    ...pullRequest,
    statuses: await fetchPullRequestStatuses(repoId, pullRequest.pullRequestId)
  })));
}

function approvalState(reviewers) {
  const votes = (reviewers || []).map((reviewer) => Number(reviewer.vote)).filter(Number.isFinite);
  if (!votes.length) return reviewers?.length ? 'pending' : null;
  if (votes.some((vote) => vote <= -10)) return 'rejected';
  if (votes.some((vote) => vote >= 10)) return 'approved';
  if (votes.some((vote) => vote < 0)) return 'changesRequested';
  return 'pending';
}

function pullRequestBuildStatus(statuses) {
  const values = (statuses || []).filter((status) => {
    const context = `${status?.context?.name || ''} ${status?.context?.genre || ''}`.toLowerCase();
    return !context || /build|ci|continuous integration/.test(context);
  });
  const state = values.map((status) => String(status?.state || '').toLowerCase());
  if (state.some((value) => ['failed', 'error'].includes(value))) return 'failed';
  if (state.some((value) => ['pending', 'notset', 'queued', 'inprogress'].includes(value))) return 'pending';
  if (state.some((value) => ['succeeded', 'approved'].includes(value))) return 'succeeded';
  if (state.some((value) => ['canceled', 'notapplicable'].includes(value))) return 'canceled';
  return null;
}

function pullRequestDetails(pullRequest, repositoryName) {
  const reviewers = Array.isArray(pullRequest?.reviewers) ? pullRequest.reviewers.filter(Boolean).map((reviewer) => ({
    name: reviewer.displayName || reviewer.uniqueName || null,
    vote: Number.isFinite(Number(reviewer.vote)) ? Number(reviewer.vote) : null
  })) : [];
  const hasConflicts = typeof pullRequest?.hasConflicts === 'boolean'
    ? pullRequest.hasConflicts
    : pullRequest?.mergeStatus ? String(pullRequest.mergeStatus).toLowerCase() === 'conflicts' : null;
  return {
    id: pullRequest.pullRequestId ?? null,
    title: pullRequest.title || null,
    author: pullRequest.createdBy?.displayName || null,
    status: pullRequest.status || null,
    createdDate: pullRequest.creationDate || null,
    ageDays: ageInDays(pullRequest.creationDate),
    isDraft: typeof pullRequest.isDraft === 'boolean' ? pullRequest.isDraft : null,
    reviewers,
    approvalState: approvalState(reviewers),
    mergeConflicts: hasConflicts,
    buildStatus: pullRequestBuildStatus(pullRequest.statuses),
    url: pullRequest.url || `https://dev.azure.com/${ADO_ORG}/${ADO_PROJECT}/_git/${encodeURIComponent(repositoryName || '')}/pullrequest/${pullRequest.pullRequestId}`
  };
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

/**
 * Bucket an Azure DevOps work-item state into the four active Scrum states
 * the dashboard reports, plus a 'done' bucket that callers discard.
 *
 * Completed work is separated out rather than folded into 'committed' because
 * work items arrive largely through build links, and anything linked to a
 * merged build is finished by definition - without this split, finished work
 * swamped the counts and read as current workload.
 */
function classifyWorkItem(state) {
  const normalized = String(state || '').toLowerCase();
  if (['done', 'closed', 'resolved', 'completed', 'removed'].includes(normalized)) return 'done';
  if (['active', 'in progress', 'doing'].includes(normalized)) return 'inProgress';
  if (normalized === 'committed') return 'committed';
  if (normalized === 'approved') return 'approved';
  return 'new';
}

const WORK_ITEM_STATES = ['new', 'approved', 'inProgress', 'committed'];
const ADO_AREA_PATH = process.env.ADO_AREA_PATH || 'WES\\Mobile Squad';
let activeBacklogCache = null;

/**
 * Fetch every active (non-completed) work item under the squad's area path.
 *
 * Build and pull-request links alone surface almost nothing: most active work
 * is in the New state, has no commits yet, and is therefore invisible to a
 * commit-derived lookup. Measured against this project, widening the build
 * sample from 2 to 25 builds returned identical results, so the backlog has to
 * be queried directly.
 *
 * Fetched once per run and reused across repositories.
 */
async function fetchActiveBacklog() {
  if (activeBacklogCache) return activeBacklogCache;
  activeBacklogCache = [];
  try {
    const wiql = {
      query: `SELECT [System.Id] FROM WorkItems WHERE [System.AreaPath] UNDER '${ADO_AREA_PATH}'`
        + " AND [System.State] NOT IN ('Done','Closed','Removed','Resolved')"
    };
    const queried = await adoClient.post('/wit/wiql', wiql, { params: apiParams() });
    const ids = (queried.data?.workItems || []).map((item) => item.id).filter(Boolean);
    for (let start = 0; start < ids.length; start += 200) {
      const data = await optionalGet(
        '/wit/workitems',
        { params: apiParams({ ids: ids.slice(start, start + 200).join(','), fields: WORK_ITEM_FIELDS }) },
        'Could not fetch active backlog details',
        { value: [] }
      );
      (data.value || []).forEach((item) => activeBacklogCache.push(item));
    }
    console.log(`  🗂 Active backlog under ${ADO_AREA_PATH}: ${activeBacklogCache.length} items`);
  } catch (error) {
    warn(`Could not query active backlog for ${ADO_AREA_PATH}; falling back to build and PR links only`, error);
  }
  return activeBacklogCache;
}

/**
 * Match backlog items to a repository by title.
 *
 * Azure DevOps has no field tying a work item to a repository, and the
 * alternatives measured worse: work-item artifact relations resolve for only
 * 5% of active items, and build links resolve for none on most repositories.
 * Titles here routinely name the component - "[Snyk][HIGH][Koerber.Mobile.
 * Capacitor.Logger] ..." - so the title is the strongest signal available.
 *
 * This is a heuristic: squad-level items that name no component (roughly
 * seven in eight of the backlog) cannot be attributed to any repository and
 * are intentionally left out rather than guessed at.
 */
const ALL_TRACKED_REPOS = Object.values(REPOSITORIES).flat();

/** Display names shared by more than one tracked repository. KMP and Capacitor
 *  both ship Beep, Printing and Vibrate, so those short names identify no
 *  single repository and must not be used for attribution. */
const AMBIGUOUS_DISPLAY_NAMES = new Set(
  ALL_TRACKED_REPOS
    .map((repo) => String(repo.displayName || '').toLowerCase())
    .filter((name, index, names) => name && names.indexOf(name) !== index)
);

function componentPattern(value) {
  const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Treat dot, hyphen, underscore and space as interchangeable separators.
  const loose = escaped.replace(/\\\./g, '[.\\-_ ]');
  return new RegExp(`(^|[^a-z0-9])${loose}([^a-z0-9]|$)`, 'i');
}

function backlogItemsForRepository(backlog, repoDef, fullName) {
  const ownFullNames = [fullName, repoDef?.name].filter(Boolean).map(String);
  const ownPatterns = ownFullNames.map(componentPattern);

  // Full names belonging to a *different* tracked repository. A title naming
  // one of these is claimed by that repository alone, which stops the KMP
  // Beep card from absorbing "[Snyk][HIGH][Koerber.Mobile.Capacitor.Beep]".
  const otherPatterns = ALL_TRACKED_REPOS
    .map((repo) => String(repo.name))
    .filter((name) => !ownFullNames.some((own) => own.toLowerCase() === name.toLowerCase()))
    .map(componentPattern);

  const display = String(repoDef?.displayName || '');
  const displayPattern = display && !AMBIGUOUS_DISPLAY_NAMES.has(display.toLowerCase())
    ? componentPattern(display)
    : null;

  return (backlog || []).filter((item) => {
    const title = String(item?.fields?.['System.Title'] || '');
    if (!title) return false;
    if (ownPatterns.some((pattern) => pattern.test(title))) return true;
    // Another repository is named explicitly - leave the item to it.
    if (otherPatterns.some((pattern) => pattern.test(title))) return false;
    return displayPattern ? displayPattern.test(title) : false;
  });
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

function ageInDays(date) {
  const timestamp = Date.parse(date || '');
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 864e5));
}

function workItemUrl(itemId, item) {
  return item?._links?.html?.href || (itemId
    ? `https://dev.azure.com/${ADO_ORG}/${ADO_PROJECT}/_workitems/edit/${itemId}`
    : null);
}

async function fetchWorkItems(repoId, pullRequests, builds, repoDef, fullName) {
  const result = {
    new: 0,
    approved: 0,
    inProgress: 0,
    committed: 0,
    items: [],
    url: `https://dev.azure.com/${ADO_ORG}/${ADO_PROJECT}/_queries`
  };

  // Source 1: work items linked to recent builds and open pull requests.
  const linkedIds = await fetchWorkItemIds(repoId, pullRequests, builds);
  const linked = [];
  for (let start = 0; start < linkedIds.length; start += 200) {
    const data = await optionalGet(
      '/wit/workitems',
      { params: apiParams({ ids: linkedIds.slice(start, start + 200).join(','), fields: WORK_ITEM_FIELDS }) },
      `Could not fetch work-item details for repository ${repoId}`,
      { value: [] }
    );
    (data.value || []).forEach((item) => linked.push(item));
  }

  // Source 2: active backlog items whose title names this component.
  const backlog = backlogItemsForRepository(await fetchActiveBacklog(), repoDef, fullName);

  const seen = new Set();
  [...linked, ...backlog].forEach((item) => {
    if (item?.id == null || seen.has(item.id)) return;
    const fields = item.fields || {};
    const state = fields['System.State'] || null;
    const bucket = classifyWorkItem(state);
    // Completed work is excluded entirely. Every work-item type - PBI, Bug,
    // Feature, Epic - counts the same towards the active total.
    if (bucket === 'done') return;
    seen.add(item.id);
    result[bucket]++;
    result.items.push({
      id: item.id ?? null,
      title: fields['System.Title'] || null,
      type: fields['System.WorkItemType'] || null,
      state,
      assignedTo: fields['System.AssignedTo']?.displayName || fields['System.AssignedTo']?.uniqueName || fields['System.AssignedTo'] || null,
      createdDate: fields['System.CreatedDate'] || null,
      ageDays: ageInDays(fields['System.CreatedDate']),
      url: workItemUrl(item.id, item)
    });
  });

  result.items.sort((a, b) => WORK_ITEM_STATES.indexOf(classifyWorkItem(a.state)) - WORK_ITEM_STATES.indexOf(classifyWorkItem(b.state)));
  return result;
}

function emptySnyk() {
  return { critical: 0, high: 0, medium: 0, low: 0, lastScan: null, url: null, issues: [] };
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

function firstSnykValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '') ?? null;
}

function firstSnykString(value) {
  if (Array.isArray(value)) return firstSnykString(value[0]);
  if (value && typeof value === 'object') return firstSnykString(value.version || value.name || value.id);
  return value === undefined || value === null || value === '' ? null : String(value);
}

function normalizeSnykIssue(issue) {
  const attributes = issue?.attributes || {};
  const issueData = attributes.issueData || attributes.issue_data || {};
  const coordinate = Array.isArray(attributes.coordinates) ? attributes.coordinates[0] || {} : {};
  const identifiers = issueData.identifiers || attributes.identifiers || {};
  const cves = identifiers.CVE || identifiers.cve || [];
  const fixedIn = firstSnykValue(issueData.fixedIn, issueData.fixed_in, attributes.fixedIn, attributes.fixed_in, coordinate.fixedIn, coordinate.fixed_in);
  return {
    id: firstSnykValue(issue?.id, issueData.id),
    cve: firstSnykString(cves),
    title: firstSnykValue(issueData.title, attributes.title, attributes.problem),
    severity: firstSnykValue(severityFromSnykIssue(issue), null),
    package: firstSnykValue(issueData.packageName, issueData.package_name, attributes.packageName, coordinate.packageName, coordinate.package_name, coordinate.package),
    version: firstSnykValue(issueData.version, attributes.version, coordinate.version),
    fixedVersion: firstSnykString(fixedIn),
    status: firstSnykValue(attributes.status, coordinate.state),
    url: firstSnykValue(issue?.links?.self, issueData.url, attributes.url)
  };
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
  const issueDetails = [];
  let totalMatched = 0;
  let latestScan = null;
  let primaryUrl = null;

  for (const project of matchedProjects) {
    const projectIssues = (issuesResult.byProject.get(project.id) || []).filter(isActiveSnykIssue);
    projectIssues.forEach((issue) => {
      const severity = severityFromSnykIssue(issue);
      if (Object.prototype.hasOwnProperty.call(counts, severity)) counts[severity]++;
      issueDetails.push(normalizeSnykIssue(issue));
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
  counts.issues = issueDetails;
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
  return { status, label: { ready: 'Ready', blocked: 'Blocked', versionDrift: 'Version drift', dataUnavailable: 'NA' }[status], reasons };
}

function buildDataSources(repositories, snykState) {
  const checkedAt = new Date().toISOString();
  const hasPipelines = repositories.some((repo) => repo.pipelines?.ci || repo.pipelines?.release);
  const hasWorkItems = repositories.some((repo) => {
    const work = repo.workItems || {};
    return WORK_ITEM_STATES.some((state) => Number(work[state] || 0) > 0);
  });
  const hasArtifacts = repositories.some((repo) => repo.versions?.devFeed || repo.versions?.platformFeed);
  return {
    repositories: { status: repositories.length ? 'connected' : 'unavailable', checkedAt },
    sourceCode: { status: repositories.some((repo) => repo.versions?.source) ? 'connected' : 'unavailable', checkedAt },
    pipelines: { status: hasPipelines ? 'connected' : 'unavailable', checkedAt },
    artifacts: { status: hasArtifacts ? 'connected' : 'unavailable', checkedAt },
    coverage: { status: repositories.some((repo) => repo.coverage) ? 'connected' : 'unavailable', checkedAt },
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
      snyk: repo.snyk ? {
        critical: repo.snyk.critical,
        high: repo.snyk.high,
        medium: repo.snyk.medium,
        low: repo.snyk.low
      } : null,
      coverage: repo.coverage ? {
        percent: repo.coverage.percent,
        threshold: repo.coverage.threshold,
        thresholdStatus: repo.coverage.thresholdStatus,
        change: repo.coverage.change,
        previous: repo.coverage.previous,
        history: repo.coverage.history
      } : null,
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

function repositoryData(repoDef, repo, category, commit, pullRequests, metadata, feedVersions, pipelines, coverage, workItems, snyk) {
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
    coverage,
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
    pullRequests: pullRequests.map((pr) => pullRequestDetails(pr, repo.name))
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
          releaseReadiness: { status: 'dataUnavailable', label: 'NA', reasons: ['Repository not found'] },
          platforms: category === 'kmp' ? ['android', 'ios', 'jvm'] : category === 'capacitor' ? ['android', 'ios', 'web'] : [],
          versions: { source: null, devFeed: null, platformFeed: null },
          packages: { npm: null, maven: null },
          pipelines: { ci: null, release: null },
          coverage: null,
          snyk: emptySnyk(),
          workItems: { open: 0, inProgress: 0, committed: 0, items: [], url: `https://dev.azure.com/${ADO_ORG}/${ADO_PROJECT}/_queries` },
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
      const [coverage, feedVersions, workItems, snyk] = await Promise.all([
        SKIP_COVERAGE ? null : fetchLatestCoverage(builds, category),
        fetchFeedVersions(metadata, category),
        fetchWorkItems(repo.id, pullRequests, builds, repoDef, repo.name),
        fetchSnykData(snykProjects, snykIssues, { ...repoDef, fullName: repo.name, category, packageName: metadata.packages.npm || metadata.packages.maven })
      ]);
      const repoData = repositoryData(repoDef, repo, category, commit, pullRequests, metadata, feedVersions, pipelines, coverage, workItems, snyk);
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
  classifyCoverageTarget,
  coverageTargetsFromModules,
  calculateReleaseReadiness,
  backlogItemsForRepository,
  classifyWorkItem,
  createHistorySnapshot,
  emptySnyk,
  fetchBuildCoverage,
  fetchLatestCoverage,
  fetchSnykData,
  fetchSnykIssues,
  fetchSnykProjects,
  parseVersion
};
