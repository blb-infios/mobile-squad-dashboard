# Mobile Squad Dashboard Feature Roadmap

This document proposes the next features for the Mobile Squad Repository Dashboard. The roadmap is designed for the current architecture:

- Static dashboard hosted on GitHub Pages
- GitHub Actions aggregation every six hours
- Azure DevOps as the source for repositories, builds, commits, pull requests, work items, and package feeds
- Snyk as the security-data source
- Generated `public/data.json` consumed by the browser UI

The roadmap prioritizes features that improve release decisions and operational visibility without requiring a backend service.

## Product goals

1. Give the squad an accurate, current view of repository health.
2. Make release readiness visible at a glance.
3. Show trends instead of only the latest snapshot.
4. Make failures and security findings actionable.
5. Fail clearly when a data source is unavailable instead of displaying misleading empty values.

## Recommended priorities

| Priority | Feature | Value | Main dependencies |
| --- | --- | --- | --- |
| P0 | Complete Snyk integration | Shows actual vulnerability counts and scan freshness | `SNYK_TOKEN`, `SNYK_ORG_ID`, project matching |
| P0 | Data-source health panel | Distinguishes no findings from unavailable data | Aggregator source-status metadata |
| P0 | Release-readiness indicator | Shows whether a repository can be released | Source, feed, pipeline, and security data |
| P0 | Aggregation tests | Prevents API-shape regressions and empty-card incidents | Test runner and representative fixtures |
| P1 | Historical snapshots and trends | Shows whether health is improving or degrading | Snapshot storage in GitHub Pages or repository artifacts |
| P1 | Repository detail view | Provides deeper diagnostics without overcrowding cards | Detail route or modal and richer JSON |
| P1 | Pipeline failure analysis | Identifies repeated failures and slow pipelines | Recent build history from Azure DevOps |
| P1 | Version drift history | Shows repeated source/feed synchronization problems | Package-feed snapshots |
| P2 | Notifications | Brings urgent failures to the team automatically | Teams, Slack, or email integration |
| P2 | Ownership metadata | Makes failures actionable for the right person | Repository metadata file |
| P2 | Export and reporting | Supports weekly reviews and release meetings | CSV/Markdown/PDF generation |
| P2 | Advanced filtering and shareable views | Makes the dashboard easier to use at squad scale | URL query state and filter controls |

## P0 features

### 1. Complete Snyk integration

Populate the existing Security section with live Snyk data for every tracked repository:

- Critical, high, medium, and low vulnerability counts
- Last scan timestamp
- Snyk project URL
- New findings since the previous snapshot
- Resolved findings since the previous snapshot
- A clear state when authentication or project matching fails

The aggregator must not convert an unavailable Snyk response into zero vulnerabilities. Use explicit source states such as `connected`, `notConfigured`, `unauthorized`, `unavailable`, and `noMatchingProject`.

### 2. Data-source health panel

Add a dashboard-level panel showing the status of each upstream source:

```text
Azure Repositories   Connected
Azure Pipelines      Connected
Azure Artifacts      Connected
Azure Boards         Connected
Snyk                 Authentication failed
```

Suggested JSON shape:

```json
{
  "dataSources": {
    "repositories": { "status": "connected", "checkedAt": "..." },
    "pipelines": { "status": "connected", "checkedAt": "..." },
    "artifacts": { "status": "connected", "checkedAt": "..." },
    "workItems": { "status": "connected", "checkedAt": "..." },
    "snyk": { "status": "notConfigured", "checkedAt": "..." }
  }
}
```

### 3. Release-readiness indicator

Add a computed status to every repository:

- `ready`: source and release feed agree, required pipelines are available, and no critical/high findings exist
- `versionDrift`: source and one or more feeds differ
- `pipelineBlocked`: the latest required pipeline failed or is missing
- `securityBlocked`: critical/high vulnerabilities exist
- `dataUnavailable`: a required source could not be queried

Display the reason directly on the card and provide links to the relevant source.

### 4. Aggregation tests

Add automated tests for the data transformation layer. At minimum, cover:

- Azure build status conversion
- Release versus CI pipeline classification
- Version extraction from `package.json` and Gradle files
- Work-item state classification
- Snyk severity counting
- Missing repositories
- API authorization failures
- Partial API responses
- Preservation of `null` for unavailable data

Tests should use saved API fixtures and must not require production credentials.

## P1 features

### 5. Historical snapshots and trends

Store one generated snapshot per aggregation run. Each snapshot should include:

- Generation timestamp
- Repository health
- Pipeline status
- Vulnerability counts
- Source and feed versions
- Work-item counts

The static site can load a compact history file such as `history.json` and render:

- Seven-day and thirty-day health trends
- Vulnerability trend lines
- Pipeline success rate
- Number of repositories with version drift
- Data-source availability over time

A retention policy should keep the latest 30 to 90 days to limit repository size.

### 6. Repository detail view

Keep the summary cards compact and add a detail page or modal for each repository. Include:

- Recent CI and release runs
- Pipeline duration and result history
- Latest commit and active pull requests
- Linked work items
- Package versions and feed links
- Snyk findings and scan age
- Release-readiness explanation

The detail view should be addressable with a URL such as:

```text
/repository.html?name=Dex
```

### 7. Pipeline failure analysis

Fetch a limited recent build history for each repository and calculate:

- Success rate over the last 10 runs
- Consecutive failure count
- Last failed run
- Average duration
- Slowest recent run
- CI versus release comparison

Use a small inline chart or status bar so the feature remains usable on mobile screens.

### 8. Version drift history

Track source, development-feed, and platform-feed versions over time. Highlight:

- Source ahead of development feed
- Development feed ahead of source
- Platform feed behind source
- Missing release publication
- Repeated drift lasting more than one aggregation cycle

## P2 features

### 9. Notifications

Add a notification job to GitHub Actions for new or worsening conditions:

- New critical/high Snyk vulnerability
- Newly failed pipeline
- Consecutive pipeline failures
- Package feed drift
- Stale or unavailable data source

Notifications should be deduplicated so the same condition does not alert every six hours.

### 10. Ownership metadata

Add a committed metadata file, for example `config/repositories.json`:

```json
{
  "Dex": {
    "owner": "Mobile Squad",
    "primaryContact": "team-channel",
    "releaseCadence": "monthly"
  }
}
```

Use this metadata to show ownership and route notifications.

### 11. Export and reporting

Support:

- CSV export of the filtered repository list
- JSON download of the current snapshot
- Weekly Markdown report generated by GitHub Actions
- PDF summary for release meetings
- Copyable links containing the current filters

### 12. Advanced filtering and shareable views

Add filters for:

- Repository type
- Health status
- Release readiness
- Pipeline status
- Vulnerability severity
- Version drift
- Owner
- Platform
- Stale data

Persist filters in URL query parameters so views can be shared with the squad.

## Non-functional improvements

These should be implemented alongside the roadmap features:

- Retry transient Azure DevOps and Snyk failures with exponential backoff.
- Apply per-source timeouts so one unavailable API does not block all data.
- Avoid logging tokens, URLs containing credentials, or sensitive API responses.
- Keep generated data free of secrets and personal access tokens.
- Preserve accessible labels, keyboard navigation, and dark-mode contrast.
- Add a workflow validation step that fails when required fields are unexpectedly absent.
- Include the aggregation timestamp and source status in every deployment.

## Suggested implementation sequence

### Milestone 1: trustworthy snapshot

1. Complete Snyk integration.
2. Add `dataSources` status metadata.
3. Add release-readiness computation.
4. Add aggregation tests.
5. Add a workflow summary showing repository and source counts.

### Milestone 2: historical visibility

1. Store timestamped snapshots.
2. Add seven-day and thirty-day trend calculations.
3. Add pipeline success-rate and vulnerability trend displays.
4. Add version-drift history.

### Milestone 3: diagnostics and actionability

1. Add repository detail views.
2. Add recent pipeline history.
3. Add ownership metadata.
4. Add Teams/Slack/email notifications.
5. Add CSV and weekly Markdown exports.

## Definition of done for a feature

A feature is complete when:

- The aggregator obtains the data from the real upstream source.
- Authentication and unavailable-source states are represented explicitly.
- The generated JSON contract is documented or tested.
- The dashboard renders the result in both light and dark themes.
- The GitHub Actions workflow runs successfully with the required secrets.
- The feature has a targeted automated test or a documented reason why a test is not practical.
- No secrets or generated credentials are committed to the repository.
