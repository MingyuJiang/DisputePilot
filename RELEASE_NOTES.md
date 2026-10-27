# 1.0.0 offline demo

- Bind refund drafts to their existing analysis and exact payment payload.
- Await real replay results, recover from reopening errors, coalesce concurrent
  requests and preserve validator findings, including skipped checks.
- Display verification metadata without fabricated passing checks. Mark offline
  remote confirmation as not applicable in summaries and execution history.
- Distinguish real Sandbox observations from fixture-based refund checks.
- Refresh pending counts after batch submission and report the excluded cases.
- Improve merchant authoring layout and capture-specific approval wording.
- Share a portable launcher with real failure exit codes, port checks, cached
  setup/builds and a fixed package-local offline database.
- Include full source/tests, frozen OpenAPI contract and owner-approved MIT.

No real messages, refunds or evidence are sent by the offline demo.
