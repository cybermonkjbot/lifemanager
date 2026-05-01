# Security Policy

## Supported Versions

This project is currently in rapid development.

| Version | Supported |
| --- | --- |
| `main` | Yes |
| Tagged releases before `0.1.0` | No |

## Reporting a Vulnerability

Please do not open public issues for security vulnerabilities.

Preferred channel:
1. Use GitHub private vulnerability reporting in the Security tab.
2. If private reporting is unavailable, contact the maintainer privately through the repository owner profile: <https://github.com/cybermonkjbot>.

Please include:
- affected component(s)
- reproduction steps or proof of concept
- impact assessment
- suggested mitigation if available

## Source Distribution Review

Before making source, packages, installers, container images, or release
artifacts available externally, verify that they exclude secrets, local auth
state, customer data, generated runtime state, private deployment credentials,
and infrastructure-only configuration.

Public source releases must include `LICENSE`, `NOTICE`, `USE_POLICY.md`, and
`TRADEMARKS.md`.

The repository is source-available for noncommercial use only. Commercial use,
hosted services, client deployments, paid support, resale, and white-labeling
are not permitted.

## Response Targets

- Initial acknowledgment: within 3 business days.
- Triage decision: within 7 business days.
- Fix timeline: depends on severity and complexity; critical issues are prioritized.

We may request additional details to validate and reproduce the report.
