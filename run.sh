#!/bin/bash
# Quick run script for local development

set -e

echo "🚀 Mobile Squad Dashboard - Quick Run"
echo ""

# Get Azure CLI token
echo "📝 Getting Azure DevOps token from Azure CLI..."
export AZURE_DEVOPS_EXT_PAT=$(az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv 2>/dev/null)

if [ -z "$AZURE_DEVOPS_EXT_PAT" ]; then
  echo "❌ Failed to get token. Run: az login"
  exit 1
fi

echo "✅ Token acquired"
echo ""

# Aggregate data
echo "📊 Fetching repository data..."
npm run aggregate
echo ""

# Open dashboard
echo "🌐 Opening dashboard in browser..."
open public/index.html

echo ""
echo "✅ Dashboard opened! Data refreshed successfully."
echo ""
echo "💡 Tips:"
echo "  - Refresh browser to see updated data"
echo "  - Run './run.sh' anytime to refresh data"
echo "  - Deploy to GitHub Pages for auto-updates"
