# Running the Dashboard Locally

This guide covers everything needed to run the Mobile Squad Dashboard on your machine, including ADO data fetching and Snyk vulnerability scanning.

## Prerequisites

- Node.js 18 or later
- An Azure DevOps Personal Access Token (PAT)
- Optional: A Snyk API token

## Setup

### 1. Clone and install dependencies

```bash
cd mobile-squad-dashboard
npm install
```

### 2. Configure your environment

Copy the example file:

```bash
cp .env.example .env
```

Edit `.env` and fill in your credentials:

```env
# Azure DevOps — required
ADO_ORG=Highjumpvso
ADO_PROJECT=WES
ADO_PAT=your_ado_pat_here

# Snyk — optional, needed for vulnerability data
SNYK_TOKEN=your_snyk_token_here
SNYK_ORG_ID=28aa5671-469c-48b5-94c0-769b64247486
SNYK_API=https://api.eu.snyk.io
```

Never commit `.env` to the repository. It is already listed in `.gitignore`.

### 3. ADO PAT permissions

Create your PAT at https://dev.azure.com/highjumpvso/_usersSettings/tokens with these scopes:

| Scope | Access |
|---|---|
| Code | Read |
| Build | Read |
| Work Items | Read |
| Packaging | Read |

Packaging Read is required to populate feed versions. Test Management Read is required to populate Azure DevOps code coverage. Without those scopes, the affected dashboard sections show no data while the rest of the dashboard still works.

### 4. Snyk credentials

- `SNYK_TOKEN`: your personal API token from https://app.snyk.io/account, or a service account token
- `SNYK_ORG_ID`: the organisation UUID (`28aa5671-469c-48b5-94c0-769b64247486` for Mobile Squad)
- `SNYK_API`: the EU region endpoint — keep as `https://api.eu.snyk.io`

Snyk is optional. If omitted, the Security section on each card shows "No scan data" but everything else works normally.

## Running

### Step 1 — Fetch Azure DevOps data

```bash
npm run aggregate
```

This calls the Azure DevOps REST API for all 14 tracked repositories and writes `public/data.json`. It takes about 30–60 seconds.

### Step 2 — Fetch Snyk data (optional)

```bash
npm run aggregate:snyk
```

This calls the Snyk REST API, matches projects to repositories, fetches active vulnerability counts, and merges the results into `public/data.json`. It takes about 30–90 seconds depending on the number of issues returned.

### Step 3 — Open the dashboard

```bash
npm run serve
```

Opens http://localhost:8080 in your browser.

### Combined run

```bash
npm run aggregate && npm run aggregate:snyk && npm run serve
```

## Troubleshooting

### SSL certificate error (Snyk only)

If `npm run aggregate:snyk` fails with:

```
unable to get local issuer certificate
```

Add this to your `.env` for local testing only:

```env
NODE_TLS_REJECT_UNAUTHORIZED=0
```

Never commit this setting. It disables TLS verification on your machine. This is a local corporate certificate trust issue and does not affect GitHub Actions.

### ADO_PAT not working

- Check the PAT has not expired
- Verify all four scopes are enabled (Code, Build, Work Items, Packaging)
- The organisation must be `Highjumpvso` and project `WES`

### Snyk shows zero issues for all repositories

- Confirm `SNYK_TOKEN` is the correct token (not `SNYK_API_TOKEN`)
- Confirm `SNYK_ORG_ID` is the UUID form, not a slug
- Run `npm run aggregate:snyk` and check the log lines starting with `🔐 Snyk:` for the root cause

### Dashboard shows stale data

`public/data.json` is not tracked in git. If the file is missing or empty, run `npm run aggregate` first.

## How the two-step aggregation works

| Step | Command | What it does |
|---|---|---|
| ADO | `npm run aggregate` | Fetches repositories, builds, commits, pull requests, work items, and package feed versions from Azure DevOps. Writes `public/data.json`. |
| Snyk | `npm run aggregate:snyk` | Reads `public/data.json`, calls the Snyk REST API, matches Snyk projects to ADO repositories using project names and target display names, counts active (non-resolved) vulnerabilities, and merges the counts back into `public/data.json`. |
| Serve | `npm run serve` | Starts a local HTTP server on port 8080 and opens the dashboard. |

The GitHub Actions workflow runs the same two steps automatically every six hours and deploys the result to GitHub Pages. The only difference is that `NODE_TLS_REJECT_UNAUTHORIZED` is never set in the workflow.

## GitHub Actions vs local

| | GitHub Actions | Local |
|---|---|---|
| ADO credentials | `ADO_PAT` repository secret | `.env` file |
| Snyk credentials | `SNYK_TOKEN` and `SNYK_ORG_ID` repository secrets | `.env` file |
| Output | deployed to GitHub Pages | local `public/data.json` |
| Schedule | every 6 hours | manual |
| SSL | trusted by default | may need `NODE_TLS_REJECT_UNAUTHORIZED=0` |

## Available scripts

| Script | Description |
|---|---|
| `npm run aggregate` | Fetch ADO data and write `public/data.json` |
| `npm run aggregate:snyk` | Fetch Snyk data and merge into `public/data.json` |
| `npm run serve` | Serve `public/` at http://localhost:8080 |
