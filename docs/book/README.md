# Quorum integration handbook

Searchable protocol-integration documentation with a read-only TypeScript devnet
inspector. No signing keys, price backend access or transactions in the browser.
Named protocol pages explicitly distinguish planned adapters from implemented
generic decoding and fictional fixture data.

The [project frontend](../../frontend/README.md) serves this book at `/book/`
alongside the Quorum landing page. Begin with
[Integrate Quorum workers](src/workers.md) for Rust producer and consumer setup.

Requirements: Node >=22.12, npm and **mdBook 0.5.4**. Install that pinned release
from the [official release](https://github.com/rust-lang/mdBook/releases/tag/v0.5.4)
or `cargo install mdbook --version 0.5.4 --locked`. Set `MDBOOK_BIN` to an absolute
binary path when it is not on PATH. The build also discovers the task-owned
`~/.local/share/quorum-toolchains/mdbook-v0.5.4/mdbook` binary.
It also recognizes installations under the previous `reflect-toolchains`
directory; see [rename and compatibility](src/migration.md).

```bash
npm --prefix docs/book ci
npm --prefix docs/book test        # TypeScript tests, not mdBook Rust doctests
npm --prefix docs/book exec -- playwright install chromium
npm --prefix docs/book run test:browser # TypeScript desktop/mobile browser checks
npm --prefix docs/book run test:live # opt-in actual browser -> public devnet reads
npm --prefix docs/book run build   # static frontend in docs/book/build/
npm --prefix docs/book run serve   # http://127.0.0.1:4100
```

The build bundles the TypeScript reader, invokes mdBook and copies only the latest
committed **public** devnet report. No `.state/` or wallet file is read by the book
builder. Generated browser assets, snapshots and HTML remain ignored; sources
and dependency lockfiles are committed. No website publishing is performed.

The live reader verifies devnet identity and confirmed account ownership/layout,
shows stale/unset/future data explicitly and uses exact bigint fixed-point prices.
It performs three read-only JSON-RPC calls per manual refresh. Public RPC/CORS
errors are shown, not replaced with mock prices. No automatic polling or wallet
connection is present. Allocation values do not certify risk methodology or
freshness. Source account addresses are pinned to the dedicated test deployment.

The default CLI serve command binds loopback only. If changing TypeScript/CSS,
rerun the build before restarting serve; Markdown changes are watched by mdBook.
