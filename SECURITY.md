# Security Policy

## Reporting a vulnerability

Please **do not** report security vulnerabilities through public GitHub issues,
discussions, or pull requests.

Instead, use GitHub's private vulnerability reporting:

**https://github.com/SaiBarathR/helprr/security/advisories/new**

Include as much of the following as you can:

- A description of the issue and its impact
- Steps to reproduce (a proof of concept helps a lot)
- The Helprr version and deployment setup (Docker Compose, reverse proxy, etc.)

Helprr is a self-hosted project maintained on a best-effort basis. You should
receive an acknowledgement within 7 days. Please allow time for a fix to be
released before disclosing the issue publicly.

## Supported versions

Only the latest release receives security fixes. If you are running an older
version, update to the latest release before reporting.

## Scope notes

Helprr is designed to run on a private network or behind an HTTPS reverse
proxy. Reports that require the attacker to already hold an administrator
account, or that depend on exposing Helprr directly to the public internet
against the documented guidance, may be treated as hardening suggestions
rather than vulnerabilities — but please report them anyway.
