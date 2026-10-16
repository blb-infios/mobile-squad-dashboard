# 🚀 Deployment Guide

## Local Testing (Current Status)

✅ **Working!** The dashboard is fully functional locally.

**Quick start:**
```bash
cd mobile-squad-dashboard
./run.sh
```

This will:
1. Get Azure CLI token
2. Fetch latest data from ADO
3. Open dashboard in browser

## Deploy to GitHub Pages

### Step 1: Create GitHub Repository

```bash
cd mobile-squad-dashboard

# Initialize git
git init
git add .
git commit -m "Initial commit: Mobile Squad Dashboard POC"

# Create repo on GitHub (via gh CLI or web UI)
gh repo create mobile-squad-dashboard --public --source=. --remote=origin --push

# Or manually:
# 1. Create repo at https://github.com/new
# 2. git remote add origin https://github.com/YOUR_ORG/mobile-squad-dashboard.git
# 3. git branch -M main
# 4. git push -u origin main
```

### Step 2: Configure Repository Secret

1. Go to: `https://github.com/YOUR_ORG/mobile-squad-dashboard/settings/secrets/actions`
2. Click "New repository secret"
3. Name: `ADO_PAT`
4. Value: Get your Personal Access Token from:
   - Go to: https://highjumpvso.visualstudio.com/_usersSettings/tokens
   - Create new token with scopes:
     - **Code**: Read
     - **Build**: Read
     - **Work Items**: Read
     - **Graph**: Read
   - Expiration: 1 year recommended
   - Copy the token value
5. Click "Add secret"

### Step 3: Enable GitHub Pages

1. Go to: `Settings → Pages`
2. Source: **Deploy from a branch**
3. Branch: **main** / **public** folder
4. Click Save

### Step 4: Wait for Actions

- Go to `Actions` tab
- The workflow will run automatically:
  - On push (initial deployment)
  - Every 6 hours (scheduled)
  - Manual trigger available

### Step 5: Access Dashboard

Your dashboard will be available at:
```
https://YOUR_ORG.github.io/mobile-squad-dashboard/
```

## Deploy to Azure Static Web Apps (Alternative)

### Via Azure Portal

1. **Create Static Web App:**
   - Portal → Create Resource → Static Web App
   - Name: `mobile-squad-dashboard`
   - Region: Choose closest
   - Deployment: GitHub
   - Repository: Select your repo
   - Branch: `main`
   - Build preset: Custom
   - App location: `/`
   - API location: (leave empty)
   - Output location: `public`

2. **Add Application Settings:**
   - Go to: Configuration → Application settings
   - Add:
     - `ADO_ORG` = `Highjumpvso`
     - `ADO_PROJECT` = `WES`
     - `ADO_PAT` = (your Personal Access Token)

3. **Wait for Deployment:**
   - GitHub Actions will automatically deploy
   - Check Actions tab for progress

4. **Access Dashboard:**
   - URL will be: `https://mobile-squad-dashboard-xxx.azurestaticapps.net`

### Via Azure CLI

```bash
# Install Azure Static Web Apps CLI
npm install -g @azure/static-web-apps-cli

# Create resource group
az group create --name mobile-squad-rg --location eastus

# Create static web app
az staticwebapp create \
  --name mobile-squad-dashboard \
  --resource-group mobile-squad-rg \
  --source https://github.com/YOUR_ORG/mobile-squad-dashboard \
  --branch main \
  --app-location "/" \
  --output-location "public" \
  --login-with-github

# Set app settings
az staticwebapp appsettings set \
  --name mobile-squad-dashboard \
  --resource-group mobile-squad-rg \
  --setting-names ADO_ORG=Highjumpvso ADO_PROJECT=WES ADO_PAT=your_token_here
```

## Monitoring & Maintenance

### Check Dashboard Health

- **GitHub Actions**: Check `Actions` tab for failed runs
- **Dashboard**: Should show "Last updated: X minutes ago"
- **Data freshness**: Updates every 6 hours

### Update Schedule

Edit `.github/workflows/update-dashboard.yml` to change frequency:

```yaml
schedule:
  - cron: '0 */6 * * *'  # Every 6 hours
  # Examples:
  # - cron: '0 */3 * * *'   # Every 3 hours
  # - cron: '0 9,17 * * *'  # 9 AM and 5 PM daily
  # - cron: '0 */1 * * *'   # Every hour
```

### Troubleshooting

**GitHub Actions failing:**
1. Check Actions tab for error logs
2. Verify `ADO_PAT` secret is set and hasn't expired
3. Re-generate token if expired

**Dashboard shows stale data:**
1. Check last GitHub Actions run time
2. Trigger manual run: Actions → Update Dashboard Data → Run workflow
3. Check if `public/data.json` is being committed

**Repositories show "Unknown" status:**
1. Verify repository names in `src/aggregate.js` match ADO
2. Check PAT has correct scopes
3. Look at browser console for errors

## Cost Estimate

### GitHub Pages
- ✅ **FREE** for public repos
- Bandwidth: 100GB/month
- Storage: 1GB
- Perfect for team dashboards

### Azure Static Web Apps
- **Free tier**: $0/mo
  - 100GB bandwidth/mo
  - Unlimited API calls
  - Custom domains
- **Standard tier**: $9/mo
  - Unlimited bandwidth
  - Enterprise features

## Next Steps

1. ✅ **Complete**: Local POC working
2. 🚀 **Deploy**: Push to GitHub Pages
3. 📊 **Evaluate**: Use for 1-2 weeks
4. 🔄 **Enhance**: Add Snyk vulnerability data
5. 📱 **Extend**: Mobile app view
6. 🔔 **Alerts**: Slack/Teams notifications

## Related Work Items

- Feature #505124: R&D - Mobile Squad Repository Monitoring Dashboard
- PBI #506183: POC Option 2 - Aggregation Script with Static Site

**POC Status**: ✅ Complete and ready for deployment
