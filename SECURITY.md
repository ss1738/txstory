# Security policy

## Scope

TxStory is read-only. It never connects wallets, holds keys or signs anything.
Relevant issues include:

- **Credential exposure:** provider URLs or keys appearing in output, logs,
  recordings or exports.
- **Unsafe handling of untrusted data:** provider responses, explorer labels,
  ABIs, recordings, chain files. Examples include script injection in the UI,
  path traversal, resource exhaustion, or anything that is executed or fetched
  because of that data.
- **Misleading results that could cause harm,** for example an interpretation
  shown as decoded fact when it is not, or a rolled-back transfer counted as a
  balance change.
- **Server-side issues:** admission-control bypass, proxy trust (`X-Forwarded-For`
  spoofing), or denial of service beyond the documented limits.

## Reporting

Please report vulnerabilities **privately**. Don't open a public issue.

- **Intended channel:** GitHub private vulnerability reporting on this
  repository ("Security" tab → "Report a vulnerability").
  - **Status:** enabled on the public repository `ss1738/txstory` (enabled
    2026-11-27). Copies or forks of this repository have their own settings, so
    check that the "Report a vulnerability" button is present.
  - **If the option is not available:** open a minimal public issue that asks
    for a private contact, without any details.
- **What to include:** affected version or commit, interface (browser, CLI, API
  or library), steps or a recording that reproduces it, and the impact.
- **Exclude:** real credentials or anyone's private data.

There is no bug bounty and no guaranteed response time. This is a volunteer
open-source project. Reports are handled as maintainers are available, and fixes
will be credited if you wish.

## Hardening notes

These are already in place:

- strict CSP;
- sanitisation of untrusted display strings;
- bounded requests and decoding;
- withholding of provider URLs and scrubbing of provider error text;
- trust of nothing forwarded by default (`TXSTORY_TRUST_PROXY`);
- a non-root container image;
- secret scanning in pre-commit and CI.
