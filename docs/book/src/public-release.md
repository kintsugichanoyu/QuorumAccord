# Public release and launch checklist

Review date: **2026-10-05**. This review covers the proposed Quorum source tree
and existing local Git history. The checkout has no Git remote configured;
repository visibility, GitHub Actions execution, and registry visibility have
not been verified against a hosted repository. A local commit does not publish
the repository, containers, or website.

## What will be public

| Surface | Included information |
|---|---|
| GitHub source and history | Rust programs/workers/server, TypeScript assets/testing, configuration examples, documentation, public verification evidence, commit authorship metadata and historical project names |
| Research | `docs/research/solana-protocol-opportunities-2026-10-05.md` and its read-only mainnet RPC snapshot: documented program addresses, slots and sampled transaction activity |
| Web image and website | Landing page, fonts and their licenses, the complete mdBook, browser inspector and selected public devnet evidence |
| Worker image | Rust producer/consumer executables and runtime libraries; signing keys and operational configuration are supplied at runtime |
| Blockchain | Existing public test program/account IDs, transaction signatures, balances, samples and weights; future signed transactions are also public |

Public blockchain addresses and transaction signatures are retained. Historical
verification logs include original names and local file paths, and remain tied
to their tested revision. The research establishes read-only observations and
integration opportunities; it does not establish partnerships, working adapters,
current liquidity, financial safety or mainnet readiness. The research files
are included in the repository and excluded from the container build context.

The website's inspector performs read-only devnet RPC requests from the browser.
Its configured endpoint and account identifiers are visible to visitors. Do not
put a private RPC credential into browser assets; a credential-bearing service
requires a separately designed server-side integration.

## What stays private

- Operator and upgrade-authority signing keys, including `keys/`,
  `testing/devnet/.state/`, and `docker/secrets/`.
- Actual `.env` and `docker/*.env` configuration, credential-bearing RPC URLs,
  registry tokens, local ledgers, and generated runtime reports.
- Build output, installed dependencies, Playwright artifacts, and local graph
  output. Sanitized evidence is published explicitly in the evidence directories.

Git and Docker exclude the private paths above and private-key filename patterns
(`*keypair*.json`, `*.pem`, `*.key`). Examples ending in `.env.example` remain
public and contain placeholders. Ignore rules do not remove an already tracked
file or erase Git history; scan the staged tree and history before each release.
Compose worker secrets are readable runtime file mounts, not encrypted storage.

## Publication review

Gitleaks **8.30.1**, downloaded from its official release with its SHA-256
checksum verified, scanned the proposed public files and all local Git history
with redacted output: **no credentials detected** in the proposed public tree
or the 14 existing commits. A separate JSON review found no 64-byte Solana
keypair arrays in current files or the 19 historical JSON blobs, and no
private/generated paths in the proposed tree. The final **154-file staged tree**
also passed the full-tree and staged-diff credential scans and the JSON/path
checks. This review records detected credentials and exclusions; it does not
replace review of future changes or protocol security testing.

The **2026-10-06 SDK addition** was also checked as part of the 175-file proposed
public tree. Gitleaks reported no credentials, and JSON/path checks found no
Solana keypair arrays or private build/state paths. The SDK evidence contains
public addresses and transaction results; its signing keys and raw snapshots
remain in ignored `.state/` storage. This supplementary scan covers the proposed
files; the history and staged-tree review above describes the earlier release.

To repeat the scanner checks with Gitleaks installed:

```bash
gitleaks git . --log-opts=--all --redact --ignore-gitleaks-allow
gitleaks git . --pre-commit --staged --redact --ignore-gitleaks-allow
git diff --cached --check
```

Do not scan or copy the entire working directory into a public artifact: it
contains ignored signing state. Inspect the file list actually being committed.

The local release checks also covered Rust tests, TypeScript tests, documentation
builds, browser behavior, both Docker builds, Compose configuration, and workflow
syntax. Detailed test boundaries remain in the verification ledger. No new
mainnet deployment, fund transfer, or production worker run was performed.

The Rust worker and frontend manifests declare MIT. A repository-wide `LICENSE`
file is not present; the owner should settle its intended scope and copyright
notice before advertising a licensed open-source release. Font OFL notices are
included with the self-hosted font assets.

## Launch the website

1. Create the intended GitHub repository and choose its visibility. Add `origin`
   and push the committed branch using [the deployment commands](deployment.md).
   Confirm the actual hosted file list and that all CI jobs pass. GitHub Actions
   and package publication must be allowed by the repository/organization.
2. Tag the passing revision, for example `v0.1.0`, and push that tag to run the
   GHCR publication workflow. Verify both image digests. The workflow publishes
   `linux/amd64` images; use a compatible Docker host or build for its architecture.
3. Configure GHCR visibility separately from repository visibility. New packages
   default to private; public container packages allow anonymous pulls. See
   [GitHub's registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).
   Private pulls need the registry authentication described in the deployment guide.
4. On the host, run the published web image with Compose, using a version tag
   or immutable digest. The application serves HTTP on port 3000 and defaults
   to a loopback host binding. Configure DNS and an HTTPS reverse proxy for the
   chosen domain; allow public HTTP/HTTPS at the proxy and keep port 3000 private.
5. Verify the domain's certificate, `/`, `/book/workers.html`,
   `/book/deployment.html`, and `/book/public-release.html`. Check the inspector's
   read-only network behavior, health status, logs, host restart behavior, and
   external uptime monitoring. Retain the prior image digest for rollback.

The existing local container preview does not provide a public domain or HTTPS.
The website and handbook can be released as an MVP while accurately documenting
the remaining protocol work.

## Launch workers and the protocol

Begin with devnet operators using separate registered, funded signers and
validated feed configuration. Initialize feeds and allocation rounds, arrange
finalization, then verify independently submitted votes, published samples and
weights, staleness behavior, restarts, and transaction failures. The current
consumer does not discover/finalize rounds automatically; running its Docker
service alone does not operate the entire protocol.

Before mainnet use, resolve the [release blockers](blockers.md): typed protocol
decoders and source validation, coherent allocation snapshots, mandatory risk
coverage, the financial methodology, caps after aggregation, an insufficient
capacity policy, and daemon lifecycle/recovery. The current generated SDKs are
[verified on devnet](sdk.md); regenerate and verify them after program changes.
Complete broader multi-operator runtime tests and independent security review. Establish
upgrade/governance, membership, retention, monitoring and incident policies.

Quorum publishes feeds and target weights. Capital execution and Jito
NCN/restaking require separate implementation. Publishing the repository or
website does not resolve these protocol release requirements.
