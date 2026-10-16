#!/bin/bash
# Quick Azure Static Web Apps deployment script

set -e

echo "🚀 Azure Static Web Apps - Quick Deploy"
echo "========================================"
echo ""

# Configuration
RESOURCE_GROUP="mobile-squad-rg"
APP_NAME="mobile-squad-dashboard"
LOCATION="eastus2"

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    echo "❌ Azure CLI not found. Install it first:"
    echo "   macOS: brew install azure-cli"
    echo "   Linux: curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash"
    exit 1
fi

# Check if logged in to Azure
echo "🔐 Checking Azure login..."
if ! az account show &> /dev/null; then
    echo "Please log in to Azure:"
    az login
fi

echo "✅ Logged in as: $(az account show --query user.name -o tsv)"
echo ""

# Check if GitHub CLI is available
if ! command -v gh &> /dev/null; then
    echo "⚠️  GitHub CLI not found. You'll need to create the repo manually."
    echo "   Install: brew install gh"
    echo ""
fi

# Create GitHub repo if gh is available
if command -v gh &> /dev/null; then
    echo "📦 Creating GitHub repository..."
    
    if ! gh repo view &> /dev/null; then
        gh repo create mobile-squad-dashboard --public --source=. --remote=origin --push || {
            echo "⚠️  Repository might already exist. Continuing..."
        }
    else
        echo "✅ Repository already exists"
    fi
    echo ""
fi

# Get GitHub repo URL
if git remote get-url origin &> /dev/null; then
    GITHUB_REPO=$(git remote get-url origin)
    echo "📍 GitHub repository: $GITHUB_REPO"
else
    echo "⚠️  No git remote found. Please create GitHub repo first:"
    echo "   gh repo create mobile-squad-dashboard --public --source=. --remote=origin --push"
    exit 1
fi

echo ""
echo "🏗️  Creating Azure resources..."
echo ""

# Create resource group
echo "Creating resource group: $RESOURCE_GROUP in $LOCATION..."
az group create \
    --name "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --output table

echo ""

# Create static web app
echo "Creating Static Web App: $APP_NAME..."
echo "This will:"
echo "  1. Create the Azure Static Web App"
echo "  2. Connect to your GitHub repository"
echo "  3. Set up automatic deployments"
echo ""

az staticwebapp create \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --source "$GITHUB_REPO" \
    --location "$LOCATION" \
    --branch main \
    --app-location "public" \
    --login-with-github \
    --output table

echo ""

# Get deployment token
echo "📝 Getting deployment token..."
DEPLOYMENT_TOKEN=$(az staticwebapp secrets list \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query "properties.apiKey" -o tsv)

# Get app URL
APP_URL=$(az staticwebapp show \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query "defaultHostname" -o tsv)

echo ""
echo "✅ Azure Static Web App created successfully!"
echo ""
echo "📍 Dashboard URL: https://$APP_URL"
echo ""

# Add GitHub secrets
if command -v gh &> /dev/null; then
    echo "🔐 Setting up GitHub secrets..."
    
    # Add deployment token
    echo "$DEPLOYMENT_TOKEN" | gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN
    
    echo "✅ AZURE_STATIC_WEB_APPS_API_TOKEN added"
    echo ""
    echo "⚠️  You still need to add ADO_PAT secret manually:"
    echo "   gh secret set ADO_PAT"
    echo "   Or go to: https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/settings/secrets/actions"
    echo ""
else
    echo "📋 Manual GitHub Secrets Setup Required:"
    echo ""
    echo "Add these secrets to your GitHub repository:"
    echo "  1. Go to: Settings → Secrets and variables → Actions"
    echo "  2. Add secret:"
    echo "     Name: AZURE_STATIC_WEB_APPS_API_TOKEN"
    echo "     Value: $DEPLOYMENT_TOKEN"
    echo "  3. Add secret:"
    echo "     Name: ADO_PAT"
    echo "     Value: (your Azure DevOps Personal Access Token)"
    echo ""
fi

echo "🎯 Next Steps:"
echo ""
echo "1. Add ADO_PAT GitHub secret (see above)"
echo "2. Push to trigger deployment:"
echo "   git push origin main"
echo ""
echo "3. Check deployment status:"
echo "   GitHub: https://github.com/$(git remote get-url origin | sed 's/.*github.com[:/]\(.*\)\.git/\1/')/actions"
echo ""
echo "4. Access dashboard:"
echo "   https://$APP_URL"
echo ""
echo "5. (Optional) Configure Azure app settings:"
echo "   az staticwebapp appsettings set \\"
echo "     --name $APP_NAME \\"
echo "     --resource-group $RESOURCE_GROUP \\"
echo "     --setting-names ADO_ORG=Highjumpvso ADO_PROJECT=WES"
echo ""
echo "✨ Deployment complete!"
