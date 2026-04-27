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

## Proprietary Distribution Review

The hosted admin console, billing internals, tenant administration, and managed secret internals are private code. Do not publish the working tree or generated source snapshots without explicit authorization.

Before any external distribution, verify that the package, installer, container image, or licensed source handoff excludes secrets, local auth state, customer data, and any modules that are outside the authorized distribution scope.

## Response Targets

- Initial acknowledgment: within 3 business days.
- Triage decision: within 7 business days.
- Fix timeline: depends on severity and complexity; critical issues are prioritized.

We may request additional details to validate and reproduce the report.
