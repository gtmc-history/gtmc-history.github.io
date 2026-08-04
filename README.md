# gtmc-history.github.io

## Dashboard security

The operator-only dashboard functions require both of these Supabase Secrets:

- `DASHBOARD_TOKEN`: a newly generated, high-entropy operator token
- `ALLOWED_ORIGINS`: a comma-separated list of exact dashboard origins, without paths or trailing slashes

`ALLOWED_ORIGINS` is defense in depth and does not replace token authentication. Add every required local development origin explicitly; localhost is not allowed automatically.

The dashboard asks the operator for the token at runtime and keeps it only in JavaScript memory. Do not put the token in HTML, client-side environment variables, URLs, browser storage, cookies, logs, or documentation.

The token previously committed to this public repository must be treated as compromised. Remove it from active Supabase configuration by replacing it with a new Secret, deploy both dashboard Edge Functions, and distribute the new token to authorized operators out of band.
