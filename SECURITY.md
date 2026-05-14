# Security Policy

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability) feature instead:

1. Go to the **Security** tab of this repository.
2. Click **Report a vulnerability**.
3. Fill in the details — steps to reproduce, impact, and any suggested fix.

## Scope

Issues we consider in-scope:

- Authentication or authorisation bypasses (e.g. accessing another user's saves, elevating from Player to Admin)
- Remote code execution via the API or game upload
- Path traversal in file serving or backup import
- JWT secret exposure or token forgery

Out of scope:

- Vulnerabilities that require physical access to the server machine
- Self-XSS (exploiting yourself)
- Issues that only affect development mode (`--debug`)
- Theoretical attacks with no practical exploitation path

## Supported versions

Only the latest release is actively maintained.
