/**
 * Mobile Squad Dashboard - Frontend JS
 */

// Time formatting utilities
function timeAgo(dateString) {
  if (!dateString) return 'Never';
  
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);
  
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}

// Render summary cards
function renderSummary(summary) {
  document.getElementById('totalRepos').textContent = summary.total;
  document.getElementById('healthyRepos').textContent = summary.healthy;
  document.getElementById('warningRepos').textContent = summary.warning;
  document.getElementById('unhealthyRepos').textContent = summary.unhealthy;
  document.getElementById('unknownRepos').textContent = summary.unknown;
}

// Render repository card
function renderRepoCard(repo) {
  const buildInfo = repo.lastBuild ? `
    <div class="detail-row">
      <span class="detail-label">Last Build:</span>
      <a href="${repo.lastBuild.url}" target="_blank" class="build-status ${repo.lastBuild.result}">
        ${repo.lastBuild.result || 'unknown'}
      </a>
    </div>
    <div class="detail-row">
      <span class="detail-label">Build #:</span>
      <span class="detail-value">${repo.lastBuild.number}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Finished:</span>
      <span class="time-ago">${timeAgo(repo.lastBuild.finishTime)}</span>
    </div>
  ` : `
    <div class="detail-row">
      <span class="detail-label">Build Status:</span>
      <span class="detail-value">No builds found</span>
    </div>
  `;

  const commitInfo = repo.lastCommit ? `
    <div class="detail-row">
      <span class="detail-label">Last Commit:</span>
      <a href="${repo.lastCommit.url}" target="_blank" class="detail-value">${repo.lastCommit.id}</a>
    </div>
    <div class="detail-row">
      <span class="detail-label">Author:</span>
      <span class="detail-value">${repo.lastCommit.author}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Committed:</span>
      <span class="time-ago">${timeAgo(repo.lastCommit.date)}</span>
    </div>
    <div class="commit-message">"${repo.lastCommit.message}"</div>
  ` : `
    <div class="detail-row">
      <span class="detail-label">Commits:</span>
      <span class="detail-value">No commits found</span>
    </div>
  `;

  const prInfo = repo.activePRs > 0 ? `
    <div class="detail-row">
      <span class="detail-label">Active PRs:</span>
      <span class="pr-badge">${repo.activePRs}</span>
    </div>
  ` : '';

  return `
    <div class="repo-card">
      <div class="repo-header">
        <a href="${repo.url}" target="_blank" class="repo-name">${repo.name}</a>
        <span class="repo-health ${repo.health.status}">${repo.health.label}</span>
      </div>
      <div class="repo-details">
        ${buildInfo}
        ${commitInfo}
        ${prInfo}
      </div>
    </div>
  `;
}

// Render category section
function renderCategory(category) {
  const repoCards = category.repositories
    .map(repo => renderRepoCard(repo))
    .join('');

  return `
    <section class="category">
      <div class="category-header">
        <h2 class="category-title">${category.displayName} Libraries</h2>
        <span class="category-count">${category.repositories.length} repos</span>
      </div>
      <div class="repo-grid">
        ${repoCards}
      </div>
    </section>
  `;
}

// Load and render dashboard data
async function loadDashboard() {
  try {
    const response = await fetch('data.json');
    if (!response.ok) {
      throw new Error(`Failed to fetch data: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Update last updated time
    const lastUpdated = new Date(data.generatedAt);
    document.getElementById('lastUpdated').textContent = 
      `Last updated: ${lastUpdated.toLocaleString()} (${timeAgo(data.generatedAt)})`;
    
    // Render summary
    renderSummary(data.summary);
    
    // Render categories
    const categoriesHtml = data.categories
      .map(category => renderCategory(category))
      .join('');
    
    document.getElementById('repoCategories').innerHTML = categoriesHtml;
    
  } catch (error) {
    console.error('Error loading dashboard:', error);
    document.getElementById('repoCategories').innerHTML = `
      <div class="loading">
        ❌ Error loading dashboard data: ${error.message}
        <br><br>
        Make sure to run <code>npm run aggregate</code> first to generate the data.
      </div>
    `;
  }
}

// Auto-refresh every 5 minutes
function startAutoRefresh() {
  setInterval(() => {
    console.log('Auto-refreshing dashboard data...');
    loadDashboard();
  }, 5 * 60 * 1000);
}

// Initialize dashboard on page load
document.addEventListener('DOMContentLoaded', () => {
  loadDashboard();
  startAutoRefresh();
});
