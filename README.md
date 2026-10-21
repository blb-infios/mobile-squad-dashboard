# 📊 Mobile Squad Repository Dashboard

Automated monitoring dashboard for all Mobile Squad repositories (KMP, Capacitor, and Security).

## Features

- ✅ Real-time repository health monitoring
- 🏗️ Build status tracking (latest build result, build number, finish time)
- 📝 Latest commit information (commit ID, author, message, time)
- 🔀 Active pull request count
- 🛡️ Active Snyk vulnerability tracking
- 📊 Azure DevOps code coverage tracking
- 🔄 Auto-refreshes every 6 hours via GitHub Actions
- 📱 Responsive design for mobile and desktop

## Repositories Tracked

### KMP Libraries (6)
- Dex
- K1V1 Authorization
- Scanner (BarcodeScanning)
- Printing
- Beep
- Vibrate

### Capacitor Plugins (7)
- K1Authorization
- Printing
- Camera
- Logger
- Beep
- MDM Reader
- Vibrate

### Security (1)
- MobileToolKit.Maintenance

## Quick Start

### Prerequisites

- Node.js 18+
- Azure DevOps Personal Access Token (PAT) with read access to:
  - Code (read)
  - Build (read)
  - Work Items (read)
  - Packaging (read) - required for Azure Artifacts feed versions
  - Test Management (read) - required for Azure DevOps code coverage data
- Optional Snyk API token and organization ID for Snyk findings

### Local Development

1. **Clone and install dependencies:**
   ```bash
   cd mobile-squad-dashboard
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env and add your ADO_PAT
   ```

3. **Fetch data:**
   ```bash
   npm run aggregate
   ```

4. **View dashboard locally:**
   ```bash
   npm run serve
   # Opens http://localhost:8080
   ```

## Deployment

### Azure Static Web Apps (Recommended)

**Easiest option with Azure integration!**

See **[DEPLOY_AZURE.md](DEPLOY_AZURE.md)** for complete Azure deployment guide.

**Quick start:**
1. Go to https://portal.azure.com
2. Create a resource → Search "Static Web App"
3. Configure: GitHub repo, branch `main`, app location `public`
4. Add application settings: `ADO_PAT`, `ADO_ORG`, `ADO_PROJECT`
5. Done! Dashboard at: `https://mobile-squad-dashboard.azurestaticapps.net`

**Cost**: FREE tier (100GB bandwidth/month, perfect for team dashboards)

### GitHub Pages

1. **Create GitHub repository**
2. **Add repository secrets:**
   - Go to Settings → Secrets and variables → Actions
   - Add `ADO_PAT` with an Azure DevOps PAT having Code, Build, Work Items, and Packaging (read) scopes
   - Add `SNYK_TOKEN` and `SNYK_ORG_ID` if Snyk findings are required

3. **Push code to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "Initial dashboard setup"
   git branch -M main
   git remote add origin https://github.com/YOUR_ORG/mobile-squad-dashboard.git
   git push -u origin main
   ```

4. **Enable GitHub Pages:**
   - Go to Settings → Pages
   - Source: Deploy from a branch
   - Branch: `main` / `public` folder
   - Save

5. **Wait for GitHub Actions to run** (updates every 6 hours automatically)

6. **Access dashboard:**
   ```
   https://YOUR_ORG.github.io/mobile-squad-dashboard/
   ```

### Azure Static Web Apps

1. **Create Azure Static Web App**
2. **Configure build:**
   - App location: `/`
   - API location: (leave empty)
   - Output location: `public`

3. **Add application settings:**
   - `ADO_PAT`: Your Azure DevOps PAT
   - `ADO_ORG`: `Highjumpvso`
   - `ADO_PROJECT`: `WES`

4. **Deploy via GitHub Actions** (auto-configured by Azure)

## Architecture

```
┌─────────────────────────────┐
│   GitHub Actions (Cron)     │
│   Every 6 hours             │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│   aggregate.js              │
│   - Queries ADO REST API    │
│   - Fetches builds/commits  │
│   - Calculates health       │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│   public/data.json          │
│   Generated dashboard data  │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│   Static Site (GitHub Pages)│
│   - index.html              │
│   - dashboard.js            │
│   - styles.css              │
└─────────────────────────────┘
```

## Health Status Logic

**Healthy** (🟢):
- Latest build succeeded
- No conflicting PRs

**Warning** (🟡):
- Build partially succeeded, OR
- Has conflicting/failing PRs

**Unhealthy** (🔴):
- Latest build failed or canceled

**Unknown** (⚫):
- No build data available
- Repository not found

## Scripts

| Command | Description |
|---------|-------------|
| `npm run aggregate` | Fetch data from ADO API and generate `data.json` |
| `npm run serve` | Start local HTTP server to view dashboard |

## Extending

### Adding New Repositories

Edit `src/aggregate.js` and add to the `REPOSITORIES` object:

```javascript
const REPOSITORIES = {
  kmp: [
    { name: 'Koerber.Mobile.Kotlin.NewLib', displayName: 'New Library' }
  ]
};
```

### Adding Snyk Vulnerability Data

1. Get Snyk API token
2. Add to `.env`: `SNYK_TOKEN=xxx`
3. Extend `aggregate.js` to query Snyk API
4. Update dashboard UI to display vulnerability count

### Customizing UI

- **Styles**: Edit `public/styles.css`
- **Layout**: Edit `public/index.html`
- **Data rendering**: Edit `public/dashboard.js`

## Troubleshooting

**Error: "ADO_PAT environment variable is required"**
- Make sure `.env` file exists with `ADO_PAT=your_token`
- For GitHub Actions, add `ADO_PAT` as a repository secret

**Dashboard shows "No builds found"**
- Verify PAT has Build (read) scope
- Check that repository has at least one build pipeline

**GitHub Actions failing**
- Check Actions tab for error details
- Verify `ADO_PAT` secret is set correctly
- Ensure PAT hasn't expired

## Related Work Items

- Feature #505124: R&D - Mobile Squad Repository Monitoring Dashboard
- PBI #506183: POC Option 2 - Aggregation Script with Static Site

## License

MIT

