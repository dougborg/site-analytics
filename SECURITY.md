# Security policy

## Supported versions

Only the latest published version of `@dougborg/site-analytics` receives fixes.

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub's private vulnerability reporting](https://github.com/dougborg/site-analytics/security/advisories/new), not in a public issue.
Include the affected version, a description of the problem, and steps to reproduce it.
You should get an acknowledgement within a week.
Fixes ship as a new release, and the advisory is published once a fixed version is available.

## How releases are protected

Releases are built and published from GitHub Actions with npm provenance, so each version on npm links to the exact commit and workflow that built it.
The workflow can only stage a release; the maintainer approves each version with two-factor authentication before it goes live.
Verify a downloaded package with `npm audit signatures`.
