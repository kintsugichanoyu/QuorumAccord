# Quorum frontend

A responsive project landing page explaining Quorum's Solana consensus feeds
and allocation signals. The linked mdBook handbook is bundled at `/book/`,
including a dedicated [Rust worker integration guide](../docs/book/src/workers.md).

The static files are served by **Rust** (`quorum-web`, Axum). **TypeScript** adds
an illustrative quorum example, accessible worker tabs, command copying, and
mobile navigation. The consensus example runs locally using invented values;
real devnet reads are available in the handbook's existing read-only inspector.

## Run

For a fresh GitHub checkout, Docker builds the frontend and mdBook without a
host Rust/Node installation:

```bash
docker compose up --build --detach --wait web
```

See [GitHub and Docker deployment](../docs/book/src/deployment.md) for build
configuration, GHCR images, ports, and operation. The following commands are for
running directly on the host.

Requirements: Rust, Node >=22.12, npm, and pinned **mdBook 0.5.4**.
See [mdBook installation](../docs/book/README.md) for `MDBOOK_BIN` and local
toolchain discovery.

```bash
# From the repository root:
npm --prefix docs/book ci
npm --prefix frontend ci
npm --prefix frontend run serve
```

Visit `http://127.0.0.1:3000`. The build type-checks TypeScript, builds the mdBook,
bundles browser code, and verifies the landing page's handbook links. Built
files are in ignored `frontend/dist/`.

To serve a completed build:

```bash
cargo run --locked -p quorum-web
```

`QUORUM_WEB_ADDR` overrides the loopback bind address; `QUORUM_WEB_ROOT` selects
an alternate built site directory. The directory must contain both the landing
page and bundled worker handbook. The default asset path is resolved from the
crate location, so serving does not depend on the shell's working directory.
For a relocated binary, set `QUORUM_WEB_ROOT` to the deployed `dist` directory.
The static output can also be served by an existing static host.

## Verify

```bash
npm --prefix frontend exec -- playwright install chromium
npm --prefix frontend test
cargo check --locked -p quorum-web
```

Browser tests run against the actual Rust server and check desktop/mobile
layout, quorum scenarios, keyboard tabs, copying, and the bundled handbook.
They do not send transactions or require signing keys. The separate handbook
package retains its own unit and browser tests. Generated screenshots and
Playwright results remain ignored.

DM Sans and Space Grotesk are self-hosted Latin fonts under the SIL Open Font
License; their license files are included in `public/fonts/`. The landing page
requires no external font service or network data source.
