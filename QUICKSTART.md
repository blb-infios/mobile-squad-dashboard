# 🚀 Quick Deploy to Azure (5 Minutes)

## Step 1: Create GitHub Repository

```bash
cd /Users/bhargavbl/Development/MobileSquad/mobile-squad-dashboard

# Initialize git (if not already done)
git init
git add .
git commit -m "Initial commit: Mobile Squad Dashboard"
git branch -M main

# Create GitHub repo (choose one method)

# Method A: Using GitHub CLI (easiest)
gh auth login  # If not already logged in
gh repo create mobile-squad-dashboard --public --source=. --remote=origin --push

# Method B: Manual
# 1. Go to https://github.com/new
# 2. Repository name: mobile-squad-dashboard
# 3. Public
# 4. Don't initialize with README
# 5. Create repository
# 6. Run:
git remote add origin https://github.com/YOUR_USERNAME/mobile-squad-dashboard.git
git push -u origin main
```

## Step 2: Deploy to Azure

### Option A: Azure Portal (Recommended)

1. **Go to Azure Portal**: https://portal.azure.com

2. **Create Static Web App**:
   - Search "Static Web App" → Create
   - **Basics**:
     - Subscription: (your subscription)
     - Resource Group: Create new → `mobile-squad-rg`
     - Name: `mobile-squad-dashboard`
     - Plan: **Free**
     - Region: **East US 2**
   - **Deployment**:
     - Source: **GitHub**
     - GitHub Account: (authorize if needed)
     - Organization: (your username/org)
     - Repository: **mobile-squad-dashboard**
     - Branch: **main**
     - Build Presets: **Custom**
     - App location: **public**
     - Api location: *(leave empty)*
     - Output location: *(leave empty)*
   - Click **Review + Create** → **Create**

3. **Wait 2-3 minutes** for deployment

### Option B: Automated Script

```bash
./deploy-azure.sh
```

## Step 3: Add GitHub Secrets

1. **Get Azure DevOps PAT**:
   - Go to: https://highjumpvso.visualstudio.com/_usersSettings/tokens
   - New Token → Name: `Mobile Squad Dashboard`
   - Scopes: Code (Read), Build (Read), Work Items (Read)
   - Create and copy the token

2. **Add to GitHub**:
   ```bash
   # Using GitHub CLI
   gh secret set ADO_PAT
   # Paste your token when prompted

   # Or manually:
   # Go to: https://github.com/YOUR_USERNAME/mobile-squad-dashboard/settings/secrets/actions
   # New repository secret → Name: ADO_PAT, Value: (paste token)
   ```

3. **GitHub Actions will automatically add `AZURE_STATIC_WEB_APPS_API_TOKEN`**
   (Azure creates this during deployment)

## Step 4: Verify Deployment

1. **Check GitHub Actions**:
   ```
   https://github.com/YOUR_USERNAME/mobile-squad-dashboard/actions
   ```
   Should show "Azure Static Web Apps CI/CD" running

2. **Get Dashboard URL**:
   - Azure Portal → Static Web App → Overview
   - URL: `https://mobile-squad-dashboard.azurestaticapps.net`

3. **Open Dashboard**:
   - Should show all 14 repositories
   - Health status for each
   - "Last updated" timestamp

## Done! 🎉

Your dashboard is now:
- ✅ Live on Azure
- ✅ Auto-updating every 6 hours
- ✅ Tracking all Mobile Squad repos
- ✅ Free hosting forever (Free tier)

---

## Troubleshooting

### GitHub Actions Failing?

Check if `ADO_PAT` secret is set:
```bash
gh secret list
```

Should show:
- `ADO_PAT`
- `AZURE_STATIC_WEB_APPS_API_TOKEN`
- `GITHUB_TOKEN` (automatic)

### Dashboard Empty?

1. Check GitHub Actions logs for errors
2. Manually trigger workflow:
   ```
   GitHub → Actions → Azure Static Web Apps CI/CD → Run workflow
   ```

### Need Help?

See full documentation:
- **DEPLOY_AZURE.md** - Complete Azure guide
- **README.md** - Full project documentation
- **DEPLOYMENT.md** - All deployment options

---

## Next Steps

- ✅ Share dashboard URL with team
- ✅ Bookmark for daily standup
- ✅ Consider adding Snyk vulnerability tracking
- ✅ Update PBI #506183 status to "Completed"
