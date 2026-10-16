# 🚀 Deploy to Azure Static Web Apps

## Option A: Azure Portal (Easiest - Recommended)

### Step 1: Create Static Web App via Portal

1. **Go to Azure Portal**: https://portal.azure.com

2. **Create Resource**:
   - Click "Create a resource"
   - Search for "Static Web App"
   - Click "Create"

3. **Configure Basics**:
   ```
   Subscription: (your subscription)
   Resource Group: Create new → "mobile-squad-rg"
   Name: mobile-squad-dashboard
   Plan type: Free
   Region: East US 2 (or closest to you)
   ```

4. **Configure Deployment**:
   ```
   Source: GitHub
   GitHub Account: (sign in and authorize)
   Organization: (your org)
   Repository: mobile-squad-dashboard
   Branch: main
   Build Presets: Custom
   App location: public
   Api location: (leave empty)
   Output location: (leave empty)
   ```

5. **Click "Review + Create"** → **"Create"**

### Step 2: Configure Application Settings

After deployment completes:

1. Go to your Static Web App resource
2. Click **"Configuration"** in left menu
3. Click **"Application settings"**
4. Add these settings:
   ```
   Name: ADO_PAT
   Value: (your Azure DevOps Personal Access Token)
   
   Name: ADO_ORG
   Value: Highjumpvso
   
   Name: ADO_PROJECT
   Value: WES
   ```
5. Click **"Save"**

### Step 3: Add GitHub Secret

1. Go to your GitHub repo: `https://github.com/YOUR_ORG/mobile-squad-dashboard`
2. Go to **Settings** → **Secrets and variables** → **Actions**
3. Add secret:
   ```
   Name: ADO_PAT
   Value: (your Azure DevOps Personal Access Token)
   ```

### Step 4: Access Dashboard

Your dashboard will be available at:
```
https://mobile-squad-dashboard.azurestaticapps.net
```

Custom domain available in Azure Portal → Custom domains

---

## Option B: Azure CLI (Advanced)

### Prerequisites

```bash
# Install Azure CLI (if not already installed)
brew install azure-cli  # macOS
# or: curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash  # Linux

# Install Azure Static Web Apps CLI
npm install -g @azure/static-web-apps-cli

# Login to Azure
az login
```

### Step 1: Create GitHub Repository First

```bash
cd mobile-squad-dashboard

# Initialize git and push to GitHub
git init
git add .
git commit -m "Initial commit: Mobile Squad Dashboard"
git branch -M main

# Create GitHub repo
gh repo create mobile-squad-dashboard --public --source=. --remote=origin --push
```

### Step 2: Create Azure Static Web App

```bash
# Set variables
RESOURCE_GROUP="mobile-squad-rg"
APP_NAME="mobile-squad-dashboard"
LOCATION="eastus2"
GITHUB_REPO="https://github.com/YOUR_ORG/mobile-squad-dashboard"
GITHUB_TOKEN="your_github_token_here"  # Generate at https://github.com/settings/tokens

# Create resource group
az group create \
  --name $RESOURCE_GROUP \
  --location $LOCATION

# Create static web app
az staticwebapp create \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --source $GITHUB_REPO \
  --location $LOCATION \
  --branch main \
  --app-location "public" \
  --login-with-github

# Get deployment token
DEPLOYMENT_TOKEN=$(az staticwebapp secrets list \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --query "properties.apiKey" -o tsv)

echo "Deployment token: $DEPLOYMENT_TOKEN"
```

### Step 3: Add GitHub Secrets

```bash
# Add secrets via GitHub CLI
gh secret set ADO_PAT --body "your_ado_pat_here"
gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --body "$DEPLOYMENT_TOKEN"
```

Or manually:
1. Go to GitHub repo → Settings → Secrets → Actions
2. Add `ADO_PAT` secret
3. Add `AZURE_STATIC_WEB_APPS_API_TOKEN` secret

### Step 4: Configure App Settings

```bash
# Add ADO configuration as app settings
az staticwebapp appsettings set \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --setting-names \
    ADO_ORG=Highjumpvso \
    ADO_PROJECT=WES \
    ADO_PAT="your_ado_pat_here"
```

### Step 5: Trigger Deployment

```bash
# Push to trigger GitHub Actions
git push origin main

# Or manually trigger in GitHub
# Go to Actions tab → Azure Static Web Apps CI/CD → Run workflow
```

---

## Option C: VS Code Extension

### Install Extension

1. Open VS Code
2. Install extension: **"Azure Static Web Apps"**
3. Sign in to Azure

### Deploy

1. Right-click on `mobile-squad-dashboard` folder
2. Select **"Create Static Web App..."**
3. Follow prompts:
   - Name: `mobile-squad-dashboard`
   - Region: Choose closest
   - Preset: Custom
   - App location: `public`
   - Output location: (leave empty)
4. Extension creates GitHub workflow automatically

---

## Configuration Files

The following files are pre-configured for Azure:

### `staticwebapp.config.json`
- Routes configuration
- Fallback handling
- 404 redirects

### `.github/workflows/azure-static-web-apps-deploy.yml`
- Automated deployment
- Data refresh every 6 hours
- PR preview environments

---

## Generate Azure DevOps PAT

1. Go to: https://highjumpvso.visualstudio.com/_usersSettings/tokens
2. Click **"New Token"**
3. Configure:
   ```
   Name: Mobile Squad Dashboard
   Organization: Highjumpvso
   Expiration: 1 year (recommended)
   Scopes (Custom defined):
     ☑ Code: Read
     ☑ Build: Read
     ☑ Work Items: Read
     ☑ Graph: Read
   ```
4. Click **"Create"**
5. **Copy the token** (you won't see it again!)

---

## Verify Deployment

### Check Status

```bash
# Get app details
az staticwebapp show \
  --name mobile-squad-dashboard \
  --resource-group mobile-squad-rg

# Get URL
az staticwebapp show \
  --name mobile-squad-dashboard \
  --resource-group mobile-squad-rg \
  --query "defaultHostname" -o tsv
```

### Check GitHub Actions

1. Go to GitHub repo → **Actions** tab
2. Look for **"Azure Static Web Apps CI/CD"** workflow
3. Check if it completed successfully

### Test Dashboard

1. Open: `https://mobile-squad-dashboard.azurestaticapps.net`
2. Should show all 14 repositories
3. Check "Last updated" timestamp
4. Verify health status is accurate

---

## Custom Domain (Optional)

### Add Custom Domain

1. Go to Azure Portal → Static Web App
2. Click **"Custom domains"**
3. Click **"Add"**
4. Choose:
   - **Free certificate** (Azure managed), or
   - **Bring your own certificate**
5. Add DNS records:
   ```
   Type: CNAME
   Name: dashboard (or subdomain of your choice)
   Value: mobile-squad-dashboard.azurestaticapps.net
   ```
6. Wait for validation (5-10 minutes)

---

## Costs

### Free Tier (Current Setup)
- ✅ **$0/month**
- 100 GB bandwidth/month
- 2 custom domains
- Automatic HTTPS
- Global distribution
- Perfect for team dashboards

### Standard Tier (If Needed)
- **$9/month**
- Unlimited bandwidth
- Unlimited custom domains
- Enterprise features
- SLA guarantee

**For this dashboard: Free tier is sufficient** ✅

---

## Monitoring

### View Analytics

Azure Portal → Static Web App → **"Analytics"**
- Page views
- Bandwidth usage
- Error rates

### Check Logs

Azure Portal → Static Web App → **"Logs"**
- Deployment logs
- Runtime logs
- Build errors

### GitHub Actions Logs

GitHub repo → **Actions** tab → Select workflow run
- View aggregation script output
- Check for API errors

---

## Troubleshooting

### Deployment Fails

**Check GitHub Actions log:**
```bash
# View latest workflow run
gh run list --workflow=azure-static-web-apps-deploy.yml --limit 1
gh run view (run-id)
```

**Common issues:**
- Missing `AZURE_STATIC_WEB_APPS_API_TOKEN` secret
- Missing `ADO_PAT` secret
- Expired Azure DevOps PAT

### Dashboard Shows Stale Data

1. Check last GitHub Actions run time
2. Manually trigger workflow:
   - GitHub → Actions → Azure Static Web Apps CI/CD → Run workflow
3. Verify `ADO_PAT` app setting is correct

### "No Data" or Empty Dashboard

1. Check browser console for errors (F12)
2. Verify `data.json` is being generated
3. Check aggregation script logs in GitHub Actions
4. Verify PAT has correct scopes

---

## Auto-Updates

The dashboard automatically refreshes every 6 hours via GitHub Actions:
- **00:00 UTC** (5:00 PM PST / 8:00 PM EST)
- **06:00 UTC** (11:00 PM PST / 2:00 AM EST)
- **12:00 UTC** (5:00 AM PST / 8:00 AM EST)
- **18:00 UTC** (11:00 AM PST / 2:00 PM EST)

To change schedule, edit `.github/workflows/azure-static-web-apps-deploy.yml`:
```yaml
schedule:
  - cron: '0 */6 * * *'  # Current: every 6 hours
  # Examples:
  # - cron: '0 */3 * * *'   # Every 3 hours
  # - cron: '0 9,17 * * 1-5' # 9 AM and 5 PM, weekdays only
```

---

## Quick Reference

| Task | Command/URL |
|------|-------------|
| Create via Portal | https://portal.azure.com → Static Web App |
| View dashboard | https://mobile-squad-dashboard.azurestaticapps.net |
| GitHub Actions | https://github.com/YOUR_ORG/mobile-squad-dashboard/actions |
| Generate ADO PAT | https://highjumpvso.visualstudio.com/_usersSettings/tokens |
| Manual refresh | GitHub → Actions → Run workflow |
| Check logs | Azure Portal → Static Web App → Logs |

---

**Ready to deploy!** Choose Option A (Portal) for easiest setup. 🚀
