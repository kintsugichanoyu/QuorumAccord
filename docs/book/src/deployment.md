# Run from GitHub with Docker

The GitHub repository contains the source, Dockerfiles, Compose configuration,
and GitHub Actions workflows. A Docker host runs the application; GHCR can store
the built images. The frontend image includes the Rust server, landing page,
and complete mdBook at `/book/`.

See [Public release and launch checklist](public-release.md) for the publication
review, website launch sequence, and remaining protocol release requirements.

## Run a fresh checkout

Install Docker Engine or Docker Desktop with **Docker Compose 2.24 or newer**.
Rust, Node, mdBook, and Solana tools are not required on the host to build the
frontend image. Run these commands from a checkout of the repository:

```bash
git clone https://github.com/YOUR_OWNER/quorum.git
cd quorum
docker compose up --build --detach --wait web
```

Replace `YOUR_OWNER` and the repository name with your GitHub location. Open
`http://127.0.0.1:3000` and `http://127.0.0.1:3000/book/workers.html`.
The first build compiles pinned Rust 1.96 and mdBook 0.5.4 and installs locked
Node dependencies. Later builds reuse Docker layers.

```bash
docker compose ps
docker compose logs --follow web
docker compose down
```

The root `compose.yaml` starts only the web service. It binds the host's loopback
interface, uses a non-root container, and serves a read-only filesystem. Its
health check verifies both the landing page and worker handbook.

## Publish with GitHub Pages

The project website URL is
<https://kintsugichanoyu.github.io/QuorumAccord/>, with the complete handbook at
<https://kintsugichanoyu.github.io/QuorumAccord/book/>.

GitHub Pages is enabled for this public repository with GitHub Actions as the
publishing source.

`.github/workflows/pages.yaml` builds the landing page and handbook with Node
24.16.0, locked npm dependencies, and checksum-verified mdBook 0.5.4. It uploads
only `frontend/dist/` and deploys after pushes to `main`. Pull requests build
the same output without publishing. Relative asset and handbook links support
the repository path on Pages and the existing local Docker server.

For a fork, enable **Settings → Pages → Build and deployment → Source → GitHub
Actions**, then push to `main` or run **Publish project website and handbook**
from the Actions tab. Update the branch filter if your default branch differs.
The site URL follows `https://OWNER.github.io/REPOSITORY/`; the deployment's
`github-pages` environment links to the actual URL.

GitHub Pages serves the static website and browser handbook, including the
read-only devnet inspector. The Docker fleet continues to run on its own host.
The workflow does not deploy containers or require operator wallets. The book
builder bundles committed public evidence and does not read `.state/` files.
See [GitHub's custom workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Configure the web service

No environment file is required for the default build. Optionally copy
`.env.example` to `.env` at the repository root and edit:

| Variable | Default | Purpose |
|---|---|---|
| `QUORUM_HTTP_BIND` | `127.0.0.1` | Host interface that exposes the HTTP port |
| `QUORUM_HTTP_PORT` | `3000` | Host HTTP port |
| `QUORUM_WEB_IMAGE` | `quorum-web:local` | Local image name or published GHCR image |

For example, use another local port:

```bash
QUORUM_HTTP_PORT=8080 docker compose up --build --detach --wait web
```

For a Docker server reached directly from another machine, set
`QUORUM_HTTP_BIND=0.0.0.0`. For a domain, place an HTTPS reverse proxy in front of
the web service and forward to port 3000; the Rust server itself serves HTTP.
The container binds `0.0.0.0:3000` internally regardless of the host port.

## Publish the repository and images

Create a GitHub repository, commit the project files, and push your branch to it.
For a checkout that does not already have a remote:

```bash
git remote add origin https://github.com/YOUR_OWNER/quorum.git
git push --set-upstream origin HEAD
```

The checked-in `.github/workflows/ci.yaml` runs on pushes and pull requests. It
tests both Rust workspaces and TypeScript packages, validates Compose, builds
both images, starts the frontend container, and checks worker executable startup
without network access or keys. GitHub Actions must be enabled for the repository.

After CI passes, create and push a version tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

`.github/workflows/publish-images.yaml` publishes:

```text
ghcr.io/your_owner/quorum-web:0.1.0
ghcr.io/your_owner/quorum-workers:0.1.0
```

Image names follow the lowercase GitHub owner and repository, with `-web` or
`-workers` appended. Releases also get commit SHA tags and stable semantic
versions get `latest`. The Actions UI can trigger a manual build, which receives
`manual` and SHA tags. Published images target `linux/amd64`; a local Docker
build uses the host's supported architecture.

The publication workflow uses the repository's automatically supplied
`GITHUB_TOKEN` with `packages: write`. No Docker Hub credentials or worker
signing keys are needed. Organization policy must allow the workflow to publish
packages. Set the GHCR packages to public if you want anonymous pulls; private
packages require a registry login. See
[GitHub's publishing guide](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)
and [container registry authentication](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

For a private image, create a GitHub personal access token (classic) with
`read:packages`, authorize it for organization SSO when required, and load it
into `GHCR_TOKEN` on the Docker host. Authenticate before pulling:

```bash
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io --username YOUR_OWNER --password-stdin
```

To run a published frontend image using the same checkout:

```bash
export QUORUM_WEB_IMAGE=ghcr.io/your_owner/quorum-web:0.1.0
docker compose pull web
docker compose up --no-build --detach --wait web
```

To run it without a source checkout:

```bash
docker run --detach --name quorum-web \
  --publish 127.0.0.1:3000:3000 \
  --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --restart unless-stopped \
  ghcr.io/your_owner/quorum-web:0.1.0
```

## Configure Rust worker containers

The separate `docker/docker-compose.yaml` defines producer and consumer
profiles. These workers submit signed transactions, so first deploy the Quorum
program, register each operator, initialize its feed, and open the consumer's
allocation round. Follow [Integrate Quorum workers](workers.md) for the contract
and required configuration. The web container does not need any of these keys.

For a producer:

```bash
cp docker/producer.env.example docker/producer.env
mkdir -p docker/secrets
chmod 700 docker/secrets
install -m 600 /absolute/path/to/registered-producer.json docker/secrets/producer.json
export QUORUM_WORKER_UID="$(id -u)" QUORUM_WORKER_GID="$(id -g)"
```

Edit `docker/producer.env`, replacing `PROGRAM_ID` and `TARGET_ACCOUNT` with
the deployed program and validated source account. Set the pool, metric, byte
offset, scale, and polling interval for that initialized feed. Then:

```bash
docker compose -f docker/docker-compose.yaml --profile producer up --build --detach producer
docker compose -f docker/docker-compose.yaml logs --follow producer
```

For an allocation consumer:

```bash
cp docker/consumer.env.example docker/consumer.env
install -m 600 /absolute/path/to/registered-consumer.json docker/secrets/consumer.json
```

Set the deployed `PROGRAM_ID`, `FEEDS` mapping, and an already opened `ROUND`
in `docker/consumer.env`. With the key directory and UID/GID configuration above:

```bash
docker compose -f docker/docker-compose.yaml --profile consumer up --build --detach consumer
docker compose -f docker/docker-compose.yaml logs --follow consumer
```

To start both configured roles, enable both profiles. To stop them:

```bash
docker compose -f docker/docker-compose.yaml --profile producer --profile consumer up --build --detach
docker compose -f docker/docker-compose.yaml --profile producer --profile consumer down
```

For published worker images, set `QUORUM_WORKERS_IMAGE` to
`ghcr.io/your_owner/quorum-workers:0.1.0`, pull it with both profiles enabled,
and use `up --no-build` with the selected profile(s).

Each service mounts its own Solana JSON keypair as
`/run/secrets/operator-keypair.json`; the Rust worker reads `KEYPAIR_FILE`.
Set exactly one of `KEYPAIR_FILE` or the older `KEYPAIR` value. Compose file
secrets preserve host ownership on Linux, so `QUORUM_WORKER_UID` and
`QUORUM_WORKER_GID` must match the owner of the readable key files. Keep the
files at mode 600 rather than making them world-readable.

Local `.env` files, `docker/*.env`, and `docker/secrets/` are excluded from Git
and the Docker build context. Keys are supplied at runtime and are not baked
into either image. See [Docker Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/).

The example feed mapping is illustrative. The implemented producer is the
generic `offset_u64` decoder; named lending-protocol adapters remain unfinished.
The consumer does not discover or finalize rounds automatically. Multiple
replicas of one service share its signer and do not create independent votes.
For another operator or feed, use a separate Compose project/configuration and
the appropriate registered signer; see [allocation consumers](consumers.md).

## Troubleshooting

| Symptom | Check |
|---|---|
| Port 3000 already in use | Set `QUORUM_HTTP_PORT` to an unused host port |
| Frontend build cannot find an included chapter | Build from the repository root with the checked-in `.dockerignore` |
| GHCR pull denied | Confirm the package name/visibility and registry login for private packages |
| `KEYPAIR_FILE could not be read` | Check the mounted file and matching host UID/GID |
| `set exactly one of KEYPAIR or KEYPAIR_FILE` | Remove the conflicting signing configuration |
| Worker rejects program/source ID | Replace public-key placeholders in its per-role env file |
| Worker runs but no feed is published | Check operator registration, windows, quorum, triggers, and transaction logs |

Container health proves the website responds. Worker startup checks verify the
executables and missing-configuration errors; they do not certify consensus
publication or resolve the documented [release blockers](blockers.md).
