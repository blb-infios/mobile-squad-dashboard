# Mobile Squad Dashboard - Complete Deployment Guide

## Overview

This guide documents the complete process of deploying the Mobile Squad Repository Dashboard to GitHub Pages, from initial setup to live deployment.

**Dashboard URL:** https://blb-infios.github.io/mobile-squad-dashboard/  
**GitHub Repository:** https://github.com/blb-infios/mobile-squad-dashboard  
**Auto-Update Schedule:** Every 6 hours (4 times daily)

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Step 1: Project Setup](#step-1-project-setup)
3. [Step 2: Push Code to GitHub](#step-2-push-code-to-github)
4. [Step 3: Create Azure DevOps Personal Access Token](#step-3-create-azure-devops-personal-access-token)
5. [Step 4: Add Secret to GitHub](#step-4-add-secret-to-github)
6. [Step 5: Configure GitHub Pages](#step-5-configure-github-pages)
7. [Step 6: Trigger Initial Deployment](#step-6-trigger-initial-deployment)
8. [Step 7: Verify Dashboard is Live](#step-7-verify-dashboard-is-live)
9. [Troubleshooting](#troubleshooting)
10. [Maintenance](#maintenance)

---

## Prerequisites

Before starting, ensure you have:

- ✅ Git installed and configured
- ✅ Node.js 18+ installed
- ✅ GitHub account with repository access
- ✅ Azure DevOps account (Highjumpvso organization access)
- ✅ Dashboard project code ready locally

---

## Step 1: Project Setup

### 1.1 Project Structure

The Mobile Squad Dashboard project has the following structure:

```
mobile-squad-dashboard/
├── .github/
│   └── workflows/
│       ├── github-pages.yml          # Main deployment workflow
│       ├── azure-static-web-apps-deploy.yml
│       └── update-dashboard.yml
├── public/
│   ├── index.html                    # Dashboard UI
│   ├── styles.css                    # Styling
│   └── dashboard.js                  # Frontend logic
├── src/
│   └── aggregate.js                  # Data aggregation script
├── package.json
├── .env.example
├── .gitignore
├── README.md
└── QUICKSTART.md
```

### 1.2 Key Files

**`.github/workflows/github-pages.yml`** - Main workflow that:
- Fetches data from Azure DevOps every 6 hours
- Generates dashboard
- Deploys to GitHub Pages

**`src/aggregate.js`** - Node.js script that:
- Queries Azure DevOps REST API
- Fetches repository data (builds, commits, PRs)
- Generates `public/data.json`

**`public/index.html`** - Dashboard UI that:
- Displays repository health status
- Shows latest builds and commits
- Auto-refreshes data display

---

## Step 2: Push Code to GitHub

### 2.1 Initialize Git Repository

```bash
cd /path/to/mobile-squad-dashboard

# Initialize git (if not already done)
git init

# Add all files
git add .

# Create initial commit
git commit -m "Initial commit: Mobile Squad Dashboard POC - Option 2"

# Rename branch to main
git branch -M main
```

### 2.2 Add GitHub Remote

```bash
# Add your GitHub repository as remote
git remote add origin https://github.com/blb-infios/mobile-squad-dashboard.git

# Verify remote
git remote -v
```

Expected output:
```
origin  https://github.com/blb-infios/mobile-squad-dashboard.git (fetch)
origin  https://github.com/blb-infios/mobile-squad-dashboard.git (push)
```

### 2.3 Push to GitHub

```bash
# Push code to GitHub
git push -u origin main
```

Expected output:
```
Enumerating objects: 23, done.
Counting objects: 100% (23/23), done.
Delta compression using up to 12 threads
Compressing objects: 100% (21/21), done.
Writing objects: 100% (23/23), 28.12 KiB | 9.37 MiB/s, done.
Total 23 (delta 0), reused 0 (delta 0), pack-reused 0 (from 0)
To https://github.com/blb-infios/mobile-squad-dashboard.git
 * [new branch]      main -> main
branch 'main' set up to track 'origin/main'.
```

### 2.4 Verify on GitHub

Go to: https://github.com/blb-infios/mobile-squad-dashboard

You should see:
- ✅ All project files
- ✅ README.md displayed
- ✅ `.github/workflows/` directory with workflow files

---

## Step 3: Create Azure DevOps Personal Access Token

The dashboard needs a Personal Access Token (PAT) to read data from Azure DevOps.

### 3.1 Navigate to Token Creation Page

Go to: **https://highjumpvso.visualstudio.com/_usersSettings/tokens**

### 3.2 Create New Token

Click **"New Token"** button

### 3.3 Configure Token

Fill in the following details:

**Name:**
```
Mobile Squad Dashboard
```

**Organization:**
```
Highjumpvso
```

**Expiration:**
```
1 year (recommended)
```

**Scopes:**
Select **"Custom defined"** and check these boxes:

```
☑ Code
  ☑ Read

☑ Build
  ☑ Read

☑ Work Items
  ☑ Read
```

**DO NOT select:**
- Write permissions
- Execute permissions
- Other scopes

### 3.4 Create and Copy Token

1. Click **"Create"** button
2. **IMMEDIATELY COPY THE TOKEN** - you won't see it again!
3. Store it temporarily in a secure location (you'll use it in the next step)

**Security Note:** This token provides read-only access to your Azure DevOps repositories. Keep it secure and never commit it to git.

---

## Step 4: Add Secret to GitHub

### 4.1 Navigate to Secrets Page

Go to: **https://github.com/blb-infios/mobile-squad-dashboard/settings/secrets/actions**

Or manually:
1. Go to your repository
2. Click **"Settings"** tab (top menu)
3. Click **"Secrets and variables"** (left sidebar)
4. Click **"Actions"**

### 4.2 Add New Secret

1. Click the green **"New repository secret"** button (top right)

2. Fill in:
   ```
   Name: ADO_PAT
   ```
   **IMPORTANT:** Must be exactly `ADO_PAT` (all caps, with underscore)

3. **Secret:** Paste your Azure DevOps token from Step 3

4. Click **"Add secret"** button

### 4.3 Verify Secret Added

You should see:
```
ADO_PAT    Updated now by you
```

**Security Note:** GitHub encrypts secrets and never displays them after creation. Only workflow runs can access them.

---

## Step 5: Configure GitHub Pages

### 5.1 Understand the Process

Before configuring, the GitHub Actions workflow needs to run once to create the `gh-pages` branch. We'll trigger this first, then configure Pages.

### 5.2 Trigger First Workflow Run

**Navigate to Actions:**
https://github.com/blb-infios/mobile-squad-dashboard/actions

**Run the workflow:**
1. Click **"Deploy to GitHub Pages"** in the left sidebar
2. Click the **"Run workflow"** dropdown button (top right)
3. Keep branch as **"main"**
4. Click **"Run workflow"** button

**Wait for completion:**
- ⚪ Yellow dot = Running (wait 1-2 minutes)
- ✅ Green checkmark = Success (proceed to next step)
- ❌ Red X = Failed (see [Troubleshooting](#troubleshooting))

### 5.3 Navigate to Pages Settings

After workflow succeeds, go to:
**https://github.com/blb-infios/mobile-squad-dashboard/settings/pages**

Or manually:
1. Click **"Settings"** tab
2. Click **"Pages"** (left sidebar, under "Code and automation")

### 5.4 Configure Source

On the Pages settings page:

**Source dropdown:**
- Click dropdown
- Select **"Deploy from a branch"**

**Branch selection:**
- First dropdown: Select **`gh-pages`**
- Second dropdown: Select **`/ (root)`**

**Save:**
- Click **"Save"** button

### 5.5 Confirmation

You should see a blue box that says:
```
✓ Your GitHub Pages site is currently being built from the gh-pages branch.
```

Within 1-2 minutes, it will change to a green box:
```
✓ Your site is live at https://blb-infios.github.io/mobile-squad-dashboard/
```

---

## Step 6: Trigger Initial Deployment

### 6.1 Wait for Pages to Build

After configuring GitHub Pages in Step 5, the site builds automatically.

**Progress indicators:**
1. **GitHub Pages settings page** shows:
   - Blue box: "Currently being built"
   - Changes to green: "Your site is live"

2. **Actions tab** shows:
   - New workflow run: "pages build and deployment"
   - Status: Success ✅

### 6.2 Verify Build Status

Go to: https://github.com/blb-infios/mobile-squad-dashboard/actions

You should see two successful workflows:
- ✅ "Deploy to GitHub Pages" (data fetch + deploy)
- ✅ "pages build and deployment" (GitHub Pages build)

---

## Step 7: Verify Dashboard is Live

### 7.1 Open Dashboard

Go to: **https://blb-infios.github.io/mobile-squad-dashboard/**

### 7.2 Expected Dashboard Content

**Summary Cards (Top):**
```
Total Repositories: 14
Healthy: 13
Warning: 0
Unhealthy: 1
Unknown: 0
```

**Repository Sections:**

**1. KMP Libraries (6 repos):**
- Dex
- K1V1 Authorization
- Scanner (BarcodeScanning)
- Printing
- Beep
- Vibrate

**2. Capacitor Plugins (7 repos):**
- K1Authorization
- Printing
- Camera
- Logger
- Beep
- MDM Reader
- Vibrate

**3. Security (1 repo):**
- MobileToolKit.Maintenance

### 7.3 Repository Card Details

Each repository card should display:

**Header:**
- Repository name (clickable link to ADO)
- Health status badge (color-coded)

**Details:**
- **Last Build:** Status (succeeded/failed), build number, time ago
- **Last Commit:** Commit ID (short hash), author, time ago
- **Commit Message:** First line of commit message
- **Active PRs:** Count (if any)

**Timestamp:**
- "Last updated: [timestamp]" at top of dashboard

### 7.4 Verify Data Freshness

Check that:
- ✅ Latest commits show recent work
- ✅ Build statuses reflect current pipeline state
- ✅ PR counts are accurate
- ✅ Timestamps are current

---

## Troubleshooting

### Issue 1: Workflow Failing - Missing ADO_PAT

**Symptoms:**
- ❌ Red X on "Deploy to GitHub Pages" workflow
- Error: "ADO_PAT environment variable is required"

**Solution:**
1. Verify secret exists: https://github.com/blb-infios/mobile-squad-dashboard/settings/secrets/actions
2. Should see `ADO_PAT` in the list
3. If missing, repeat [Step 4](#step-4-add-secret-to-github)
4. Re-run workflow

### Issue 2: Workflow Failing - Invalid ADO_PAT

**Symptoms:**
- ❌ Red X on workflow
- Error: "401 Unauthorized" or "403 Forbidden"

**Solution:**
1. ADO PAT may have expired or incorrect scopes
2. Generate new token: https://highjumpvso.visualstudio.com/_usersSettings/tokens
3. Ensure scopes: Code (Read), Build (Read), Work Items (Read)
4. Update GitHub secret with new token
5. Re-run workflow

### Issue 3: Dashboard Shows 404 Not Found

**Symptoms:**
- URL returns "404 - Page Not Found"
- GitHub Pages settings shows Pages is enabled

**Solution:**
1. Verify `gh-pages` branch exists:
   - Go to: https://github.com/blb-infios/mobile-squad-dashboard/branches
   - Should see `gh-pages` branch
2. If missing:
   - Workflow didn't complete successfully
   - Check Actions tab for errors
   - Fix errors and re-run
3. Wait 2-3 minutes after first Pages configuration
4. Clear browser cache and retry

### Issue 4: Dashboard Shows Old Data

**Symptoms:**
- Dashboard loads but data is stale
- "Last updated" timestamp is old

**Solution:**
1. Check recent workflow runs: https://github.com/blb-infios/mobile-squad-dashboard/actions
2. Verify "Deploy to GitHub Pages" ran successfully
3. If last run failed, check logs and fix
4. Manually trigger workflow:
   - Actions → Deploy to GitHub Pages → Run workflow
5. Wait 1-2 minutes, then refresh dashboard

### Issue 5: Some Repositories Show "Unknown" Status

**Symptoms:**
- Repository cards show "Unknown" or "No Data"
- Other repos work fine

**Solution:**
- This is normal if repository has no builds/pipelines configured
- ADO API returns no data for repos without pipelines
- Repository still shows latest commit information
- Consider setting up CI/CD pipeline for affected repos

### Issue 6: GitHub Pages Branch Not Appearing

**Symptoms:**
- Pages settings doesn't show `gh-pages` branch option
- Only shows `main` branch

**Solution:**
1. Workflow must complete successfully first
2. Check workflow status: https://github.com/blb-infios/mobile-squad-dashboard/actions
3. If successful, refresh Pages settings page
4. If still missing after successful run:
   - Wait 5 minutes
   - Clear browser cache
   - Try different browser

---

## Maintenance

### Updating Dashboard Schedule

To change the auto-update frequency, edit `.github/workflows/github-pages.yml`:

```yaml
schedule:
  - cron: '0 */6 * * *'  # Current: Every 6 hours
```

**Common schedules:**
```yaml
# Every 3 hours
- cron: '0 */3 * * *'

# Every hour
- cron: '0 * * * *'

# Twice daily (9 AM and 5 PM UTC)
- cron: '0 9,17 * * *'

# Once daily at midnight UTC
- cron: '0 0 * * *'

# Weekdays only, every 4 hours
- cron: '0 */4 * * 1-5'
```

After changing, commit and push:
```bash
git add .github/workflows/github-pages.yml
git commit -m "Update dashboard refresh schedule"
git push origin main
```

### Adding New Repositories

To track additional repositories, edit `src/aggregate.js`:

```javascript
const REPOSITORIES = {
  kmp: [
    { name: 'Koerber.Mobile.Kotlin.Dex', displayName: 'Dex' },
    { name: 'Koerber.Mobile.Kotlin.NewRepo', displayName: 'New Repo' }, // Add here
  ],
  capacitor: [
    // ... existing repos
  ],
  security: [
    // ... existing repos
  ]
};
```

Commit and push changes:
```bash
git add src/aggregate.js
git commit -m "Add new repository to dashboard"
git push origin main
```

The workflow will automatically deploy the update.

### Rotating Azure DevOps PAT

PATs expire after their configured lifetime. To rotate:

1. **Generate new token:** https://highjumpvso.visualstudio.com/_usersSettings/tokens
2. **Update GitHub secret:**
   - Go to: https://github.com/blb-infios/mobile-squad-dashboard/settings/secrets/actions
   - Click pencil icon next to `ADO_PAT`
   - Paste new token value
   - Save
3. **Test:** Manually trigger workflow to verify new token works

**Recommended:** Set calendar reminder 1 week before PAT expiration.

### Monitoring Dashboard Health

**Check workflow runs regularly:**
https://github.com/blb-infios/mobile-squad-dashboard/actions

**Look for:**
- ✅ Green checkmarks (healthy)
- ❌ Red X marks (needs attention)
- ⚠️ Yellow warnings (review logs)

**Set up notifications:**
1. Go to: https://github.com/blb-infios/mobile-squad-dashboard
2. Click "Watch" → "Custom" → "Actions"
3. Get email on workflow failures

### Backup and Recovery

**Backup strategy:**
- ✅ Code is version-controlled on GitHub
- ✅ Secrets documented (regenerate if needed)
- ✅ Configuration in git repository

**Recovery steps if needed:**
1. Clone repository
2. Regenerate ADO_PAT
3. Add secret to GitHub
4. Re-enable GitHub Pages
5. Trigger workflow

---

## Architecture Summary

### Data Flow

```
┌─────────────────────────────┐
│  GitHub Actions (Scheduler) │
│  Triggers every 6 hours     │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│  src/aggregate.js           │
│  - Queries ADO REST API     │
│  - Fetches repo data        │
│  - Generates data.json      │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│  public/data.json           │
│  Repository data snapshot   │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│  GitHub Pages Deployment    │
│  Serves static dashboard    │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│  Dashboard (Browser)        │
│  Displays data to users     │
└─────────────────────────────┘
```

### Technologies Used

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Backend | Node.js | Data aggregation script |
| API Client | Axios | Azure DevOps REST API calls |
| Frontend | HTML/CSS/JS | Dashboard UI |
| Hosting | GitHub Pages | Free static site hosting |
| CI/CD | GitHub Actions | Automated deployment |
| Scheduling | Cron (GitHub Actions) | Auto-refresh every 6 hours |
| Authentication | Azure DevOps PAT | Read-only API access |

---

## Cost Analysis

### GitHub Pages
- **Cost:** $0/month (Free tier)
- **Included:**
  - 100 GB bandwidth/month
  - Unlimited builds
  - HTTPS/SSL certificates
  - Custom domains (if needed)

### GitHub Actions
- **Cost:** $0/month (Free tier)
- **Included:**
  - 2,000 minutes/month (public repos)
  - Workflow runs: ~4/day × 2 min = 240 min/month
  - Well within free tier

### Azure DevOps API
- **Cost:** $0 (read-only access)
- No API charges for read operations

**Total Cost: $0/month** ✅

---

## Quick Reference

### Important URLs

| Resource | URL |
|----------|-----|
| **Dashboard (Live)** | https://blb-infios.github.io/mobile-squad-dashboard/ |
| **GitHub Repository** | https://github.com/blb-infios/mobile-squad-dashboard |
| **GitHub Actions** | https://github.com/blb-infios/mobile-squad-dashboard/actions |
| **GitHub Secrets** | https://github.com/blb-infios/mobile-squad-dashboard/settings/secrets/actions |
| **GitHub Pages Settings** | https://github.com/blb-infios/mobile-squad-dashboard/settings/pages |
| **ADO Token Management** | https://highjumpvso.visualstudio.com/_usersSettings/tokens |
| **Azure DevOps Project** | https://highjumpvso.visualstudio.com/WES |

### Key Files to Know

| File | Purpose |
|------|---------|
| `.github/workflows/github-pages.yml` | Main deployment workflow |
| `src/aggregate.js` | Data aggregation script |
| `public/index.html` | Dashboard UI |
| `public/data.json` | Generated data (updated by workflow) |
| `README.md` | Project documentation |

### Common Commands

```bash
# Test locally
cd mobile-squad-dashboard
npm install
npm run aggregate  # Requires ADO_PAT env var
npm run serve      # View at http://localhost:8080

# Update and deploy
git add .
git commit -m "Description of changes"
git push origin main  # Triggers auto-deployment

# Check deployment status
# Visit: https://github.com/blb-infios/mobile-squad-dashboard/actions
```

---

## Success Criteria

✅ **Deployment Successful When:**

1. ✅ Code pushed to GitHub
2. ✅ GitHub Actions workflow runs successfully
3. ✅ GitHub Pages enabled and building
4. ✅ Dashboard accessible at: https://blb-infios.github.io/mobile-squad-dashboard/
5. ✅ All 14 repositories displayed
6. ✅ Health status showing (13 healthy, 1 unhealthy)
7. ✅ Latest commits and builds visible
8. ✅ "Last updated" timestamp current
9. ✅ Auto-update schedule working (check Actions tab)
10. ✅ No errors in workflow logs

---

## Related Work Items

- **Feature #505124:** R&D - Mobile Squad Repository Monitoring Dashboard
- **PBI #506183:** POC Option 2 - Aggregation Script with Static Site ✅ **COMPLETE**

---

## Document Information

**Created:** October 16, 2026  
**Author:** Mobile Squad  
**Version:** 1.0  
**Status:** Active  
**Last Updated:** October 16, 2026  

---

**End of Document**
