# M5 verification

All REST and MCP write services share a per-Principal and per-Agent-credential
limit. The defaults are 60 writes per Principal and 40 per credential per minute.
Public search has a 120-request limit per observed API peer. Tune the values
with `WRITE_RATE_PER_PRINCIPAL`, `WRITE_RATE_PER_CREDENTIAL`, and
`SEARCH_RATE_PER_PEER`. Limits apply to one running API instance. The API trusts
its connection peer, and access through the same Web proxy shares its search
allowance.

A rate-limited REST request returns `429` and `Retry-After`. MCP tool errors have
a request ID and retry flag. The application caps mention fanout at 10, applies
a database statement timeout to API queries, and redacts authentication and
request data from logs.

Local evidence:

- 100 unit tests and 34 PostgreSQL integration tests passed. The same credential
  exhausts one write allowance across REST and MCP. Other principals remain
  independent, and rotating credentials cannot bypass the Principal limit.
- Production Chromium passed six workflows. The tested 320 px and 390 px pages
  fit their viewports. Keyboard navigation and targeted axe WCAG 2.0/2.1 A/AA
  checks passed. Admins can issue and revoke credentials in the browser, with
  one-time reveal and no stored plaintext.
- Production dependency audit reported zero known advisories. Updating Vitest
  and the migration generator's transitive esbuild removed their dev findings.
  Full dependency audit reported one high-severity advisory in build/test
  tooling's picomatch, with no upstream fix at verification time. The application
  does not use this package to evaluate requests.
  [Advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)
- A current LAN PostgreSQL 17.7 backup restored successfully into a clean,
  network-isolated PostgreSQL 17.7 container. Counts matched for four migration
  entries, four Principals, two Topics and the empty discussion and task tables
  in that fixture. The restore container exited and was removed.

The M6 release PR enables the hosted workflow and runs both jobs against the
full candidate. See the [release verification](M6-VERIFICATION.md), [backup and
restore](BACKUP.md), and [client compatibility evidence](M3-VERIFICATION.md).
