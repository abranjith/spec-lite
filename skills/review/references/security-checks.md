# Security Checks

This review is heuristic. Recommend stack-appropriate SAST, dependency, DAST, and secret scanners; never present a clean manual review as security clearance.

## Quick Threat Model

Identify trust boundaries, high-value data, likely attack vectors, public exposure, authentication/authorization design, deployment, and compliance requirements before assigning severity.

Review authentication, authorization/tenant isolation, input validation, data protection, API abuse/rate limits, dependencies, infrastructure/IAM/CORS/headers, and error leakage. Missing authentication or authorization on a public-facing non-public system is Critical.

## Always-Run Injection Scan

- **SQL injection:** raw concatenation/interpolation, ORM raw-query bypasses, and dynamic identifiers/order/limit values. Prefer parameterized queries and allowlists. A direct path to arbitrary queries is Critical.
- **XSS:** unescaped user-controlled HTML, unsafe template directives, `innerHTML`/`document.write`, `dangerouslySetInnerHTML`, and missing/weak CSP. Rate High–Critical by exposed data/actions.
- **CSRF:** for cookie-authenticated state changes, verify tokens, SameSite cookies, or Origin/Referer validation. Explain when not applicable (for example, bearer-only APIs or CLIs).

## Always-Run Secret Scan

Inspect source, config, CI, and tests for literal credentials; committed `.env` files; credential-bearing connection strings; private key blocks; and secret-named variables assigned high-entropy strings. Check at least:

| Secret | Pattern |
|---|---|
| AWS access key | `AKIA[0-9A-Z]{16}` |
| Stripe live key | `sk_live_[A-Za-z0-9]{24,}` |
| OpenAI key | `sk-[A-Za-z0-9]{32,}` |
| GitHub token | `ghp_[A-Za-z0-9]{36}` or `github_pat_...` |
| Google API key | `AIza[0-9A-Za-z_-]{35}` |
| Private key | `-----BEGIN (RSA |EC )?PRIVATE KEY-----` |

For a real secret: recommend immediate rotation, replacement with environment/secrets-manager access, appropriate `.gitignore`, git-history scrubbing, and a full-history Gitleaks/TruffleHog scan. Treat a committed usable secret as Critical; a local ignored `.env` is not itself a vulnerability.

## User-Directed Skips

Honor skips but report each skipped check and its risk. Authentication/authorization skips on a public-facing system require Critical emphasis. Include this block when auth/authz is skipped:

```text
⚠️ RISK WARNING — Authentication/Authorization Skipped

This application has no authentication or authorization layer.

For internal-only systems, network controls become the only barrier; accidental public exposure grants open access. For public-facing systems the risk is Critical: anyone may access functionality/data, and without authorization users may access one another's data. Do not deploy publicly without explicitly accepting and documenting this risk.
```

## Tool Limitations

Recommend appropriate tools such as Semgrep/CodeQL for SAST, ecosystem dependency audits, OWASP ZAP/Burp for DAST, and Gitleaks/TruffleHog for secrets. Manual inspection can miss runtime-only issues, obfuscation, deep data flow, and vulnerabilities in git history.
