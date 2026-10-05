# Quorum on GitHub and Docker

From a fresh GitHub checkout, the frontend and its bundled mdBook require only
Docker with Compose 2.24 or newer:

```bash
# Run from the repository root:
docker compose up --build --detach --wait web
```

Open `http://127.0.0.1:3000`. Use `docker compose logs --follow web` for logs and
`docker compose down` to stop it.

The full [GitHub and Docker guide](../docs/book/src/deployment.md) covers cloning,
configuration, image publication to GHCR, running a published release, host
ports, operator key files, producer/consumer profiles, and troubleshooting.

| File | Purpose |
|---|---|
| `../compose.yaml` | Runnable frontend and handbook; no worker keys required |
| `frontend.Dockerfile` | Pinned Rust/mdBook/Node builds and non-root Rust web runtime |
| `Dockerfile` | Rust producer and consumer image |
| `docker-compose.yaml` | Explicit worker profiles and per-operator secret mounts |
| `producer.env.example`, `consumer.env.example` | Required worker configuration templates |
| `test-workers.sh` | No-network worker executable startup check |
| `../.github/workflows/ci.yaml` | Tests, container builds, and smoke checks |
| `../.github/workflows/publish-images.yaml` | Version-tag/manual publication to GHCR |

Worker services require a deployed program, configured sources/feeds, and
registered funded operators. Follow the full guide before starting those profiles.
