# Testing-first CI/CD for Dive Centre Manager

Prepared for the existing two-server deployment on 2 November 2026.

This setup is **prepared in the repository, not installed or enabled remotely**.
Both deployment workflows are disabled until their repository variables are set.
It builds only committed code. Local, uncommitted edits never enter a release.

## 1. What happens when you change code

```text
Your Mac → feature branch → pull request → Application checks
    → merge to main → Application checks succeeds
    → build two Linux/amd64 images on GitHub
    → push images to GHCR and save their immutable digests
    → private SSH deployment to testing
    → your acceptance testing
    → select that release run and manually promote it
    → production backup, migration rehearsal and deployment
```

CI means automated validation: tests, builds, container startup, proxy behavior
and backup restoration. CD means shipping the validated images to a server.
A passing CI run does not mean the product is ready for production; you still
check the business behavior on testing before promoting it.

### Existing resources stay separate

| | Testing | Production |
|---|---|---|
| LAN address | `192.168.130.3` | `192.168.135.39` |
| Application directory | `/srv/dive-centre-testing-independent` | `/srv/dive-centre-prod` |
| Compose project | `dive-centre-testing-standalone` | `dive-centre-prod` |
| Database | `dive_center_testing` | `dive_center` |
| Expected data volume | `dive-centre-testing-standalone_testing_data` | `dive-centre-prod_postgres_data_live_20261101` |
| NPM upstream | HTTP `192.168.130.3:8080` | HTTP `192.168.135.39:18080` |
| Public hostname | `diving-staging.ssrsys.com` | `diving.ssrsys.com` |

The installer refuses to enroll a different database volume. If production uses
a different final volume, report the actual value before changing the guard.
Do not select the old rehearsal database volume.

Database passwords, JWT keys, authenticator keys, proxy configuration and PMS
settings remain on their respective servers. No database is copied between
production and testing. Existing testing accounts are retained, not reseeded.
The pipeline does not update PostgreSQL, other applications, DNS or NPM.

### Why image digests matter

A release contains two image references such as:

```text
ghcr.io/masyyhh/dive_center-backend@sha256:<64-character-digest>
ghcr.io/masyyhh/dive_center-web@sha256:<64-character-digest>
```

A digest identifies the exact built image. Production receives the images that
passed deployment to testing. It does not rebuild them or pull the current
`main` branch. A newer testing release does not change an older release manifest.
Tags such as `sha-<commit>` are convenience labels; deployment uses digests.

The same web image uses normal independent `/api` login in both environments.
Do not build it with `VITE_DEPLOYMENT_MODE=testing`: that is the archived parallel
SSO mode. The server mounts a small public `environment.js` to show the testing
banner. `AUTHENTICATOR_ISSUER` preserves the testing OTP label. Neither setting
contains a secret or switches which database is used.

## 2. Files supplied

| File | Purpose |
|---|---|
| `.github/workflows/ci.yml` | Existing application checks plus deployment-tool tests |
| `.github/workflows/release.yml` | Publish images after successful main CI; deploy testing |
| `.github/workflows/promote-production.yml` | Select a successful testing run and promote its images |
| `scripts/cd/install.py` | Enroll an existing server without restarting it |
| `scripts/cd/deploy.py` | Fixed-scope backup, rehearsal, migration, deployment and recovery |
| `scripts/cd/ssh-entry.py` | Run deployment under systemd, independently of the SSH session |
| `scripts/cd/test_deploy.py` | Registry, scope and recovery checks |

Both workflows assume the default release branch is `main` and the repository
is `masyyhh/dive_center`. Update all explicit guards together if either changes.

## 3. Accounts and services you need

1. Administrator access to the GitHub repository.
2. Your existing sudo/SSH access to both Ubuntu servers.
3. A Tailscale account with permission to manage its access policy and OAuth clients.
4. Outbound internet access from GitHub and both servers for GHCR and Tailscale.
5. Enough GitHub Actions minutes and GHCR storage for your plan.

We use GitHub-hosted runners for builds and deployments. Tailscale connects the
short-lived deployment job privately to each server. You do not need to expose
SSH to the internet or install GitHub runners on your production server.

Check GitHub environment support for your plan. For private repositories,
environments and required-reviewer protections have plan restrictions. If you
cannot configure required reviewers, the supplied workflow still requires a
manual dispatch with `DEPLOY PRODUCTION`, but this is **not an independent
reviewer gate**: anyone permitted to run/edit that workflow may promote a release.
If independent approval is required, enable a supported GitHub plan/protection
before enabling production deployment.

## 4. First: inspect the current servers

On your Mac:

```bash
ssh user@192.168.130.3
```

On testing:

```bash
hostname -I
df -h /
sudo docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
sudo docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql"}}{{.Name}}{{end}}{{end}}' dive-centre-testing-standalone-db-1
exit
```

Repeat from your Mac for production:

```bash
ssh user@192.168.135.39
```

On production:

```bash
hostname -I
df -h /
sudo docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
sudo docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql"}}{{.Name}}{{end}}{{end}}' dive-centre-prod-db-1
exit
```

Only paste commands, not their printed output, back into a terminal.
Enrollment is read-only with respect to containers. Deployment requires at least
4 GiB free before downloading images and 2 GiB after downloading. These are
minimum guards, not a promise that a growing database fits. Allow extra space for
two database dumps, two application versions and logs. Your production disk was
last reported around 6 GiB free, so inspect it before enabling production.
Do not use a blanket Docker image/volume/system prune; other apps and retained
recovery volumes exist on that server.

## 5. Configure Tailscale access first

In the Tailscale admin console, open **Access controls**. For a new dedicated
tailnet, the following minimal policy permits each CI identity to SSH only to
its own environment, and tailnet administrators to administer both servers:

```json
{
  "tagOwners": {
    "tag:dive-ci-testing": ["autogroup:admin"],
    "tag:dive-ci-production": ["autogroup:admin"],
    "tag:dive-server-testing": ["autogroup:admin"],
    "tag:dive-server-production": ["autogroup:admin"]
  },
  "grants": [
    {"src": ["tag:dive-ci-testing"], "dst": ["tag:dive-server-testing"], "ip": ["tcp:22"]},
    {"src": ["tag:dive-ci-production"], "dst": ["tag:dive-server-production"], "ip": ["tcp:22"]},
    {"src": ["autogroup:admin"], "dst": ["tag:dive-server-testing", "tag:dive-server-production"], "ip": ["tcp:22"]}
  ]
}
```

For an existing tailnet, merge the needed entries with its policy; do not replace
other access rules blindly. Remove/narrow any existing allow-all rule that also
grants these CI identities broader access, or the two isolation rules above will
not restrict them. Validate the policy in the console before saving it.
This uses ordinary OpenSSH, not Tailscale SSH, so no Tailscale SSH policy is needed.

Create **two OAuth clients** in Tailscale's trust/OAuth client settings:

- Testing client: permission to create auth keys (`auth_keys`, write), with only
  `tag:dive-ci-testing`.
- Production client: same scope, with only `tag:dive-ci-production`.

Save each client ID and secret privately. GitHub uses these to register ephemeral
nodes for a deployment. The Tailscale action removes its temporary connection
when the job ends. A later improvement is workload identity federation to avoid
long-lived OAuth secrets; the initial implementation uses the documented OAuth flow.

### Install on testing

From the Mac, SSH to `user@192.168.130.3`, then run:

```bash
curl -fsSL https://tailscale.com/install.sh -o /tmp/install-tailscale.sh
less /tmp/install-tailscale.sh
sudo sh /tmp/install-tailscale.sh
sudo tailscale up --accept-dns=false --accept-routes=false --advertise-tags=tag:dive-server-testing
tailscale ip -4
```

Open the authentication URL printed by `tailscale up` and approve the server in
your tailnet. Save the returned `100.x.x.x` address as the testing Tailscale IP.
If the official installer reports that your Ubuntu version is unsupported, stop
and report that output rather than substituting another distribution's packages.

### Install on production

SSH from the Mac to `user@192.168.135.39`, then run:

```bash
curl -fsSL https://tailscale.com/install.sh -o /tmp/install-tailscale.sh
less /tmp/install-tailscale.sh
sudo sh /tmp/install-tailscale.sh
sudo tailscale up --accept-dns=false --accept-routes=false --advertise-tags=tag:dive-server-production
tailscale ip -4
```

Approve it and save the separate production `100.x.x.x` address. These options
leave existing DNS and advertised subnet routes alone. Do not configure an exit
node or replace the servers' current default gateway. Review tagged-device key
expiry and access policy in your tailnet administration settings.

## 6. Generate separate deployment SSH keys on your Mac

Run in the Mac terminal:

```bash
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
ssh-keygen -t ed25519 -N '' -C dive-cd-testing -f "$HOME/.ssh/dive_cd_testing"
ssh-keygen -t ed25519 -N '' -C dive-cd-production -f "$HOME/.ssh/dive_cd_production"
```

If a key already exists at either path, do not overwrite it. These dedicated keys
have no passphrase because GitHub must use them noninteractively. The server
restricts each to a root-owned deployment entry point: no general shell,
forwarding, arbitrary sudo, Docker-group access or application-secret access.

Never commit the private keys. Only each public `.pub` key is copied to its server.

## 7. Copy and enroll the deployment tooling

On the Mac, from the repository:

```bash
cd /Users/administrator/Documents/dive_center
ssh user@192.168.130.3 'mkdir -p "$HOME/dive-cd-setup"'
scp scripts/cd/deploy.py scripts/cd/ssh-entry.py scripts/cd/install.py \
  "$HOME/.ssh/dive_cd_testing.pub" user@192.168.130.3:dive-cd-setup/
```

On testing:

```bash
ssh user@192.168.130.3
sudo python3 "$HOME/dive-cd-setup/install.py" testing \
  "$HOME/dive-cd-setup/dive_cd_testing.pub"
exit
```

Then on the Mac:

```bash
ssh user@192.168.135.39 'mkdir -p "$HOME/dive-cd-setup"'
scp scripts/cd/deploy.py scripts/cd/ssh-entry.py scripts/cd/install.py \
  "$HOME/.ssh/dive_cd_production.pub" user@192.168.135.39:dive-cd-setup/
```

On production:

```bash
ssh user@192.168.135.39
sudo python3 "$HOME/dive-cd-setup/install.py" production \
  "$HOME/dive-cd-setup/dive_cd_production.pub"
exit
```

Enrollment checks the project, volume, IP, ports, database URL and disabled
legacy-auth mode. It installs the deployment scripts, a root-owned configuration,
a `dive-deploy` account and one narrow sudo rule. It does not restart any service.
If a guard fails, report it; do not bypass it or point at the old production volume.

The scripts installed under `/usr/local/lib/dive-cd` are intentionally **not**
automatically replaced from a release. Update them through your normal administrator
SSH account after reviewing changes. Repeat installation commands will refuse an
existing enrollment; they will not overwrite it.

## 8. Give each server read-only GHCR access

In GitHub, create a **personal access token (classic)** with `read:packages`.
Use an account that can read the repository's packages; authorize organization
SSO if applicable. Prefer separate tokens for testing and production. Do not give
these tokens `write:packages` or `delete:packages`.

On each server, in its Bash shell:

```bash
read -r -p 'GitHub username for GHCR: ' registry_user
read -r -s -p 'GHCR read:packages token: ' registry_token
printf '\n'
printf '%s' "$registry_token" | sudo docker login ghcr.io \
  --username "$registry_user" --password-stdin
unset registry_token registry_user
```

Do not paste a token directly into a command or send it in this chat. Root Docker
needs this login because the deployment worker runs as root. Docker normally stores
its login in root's Docker config unless you install a credential helper; protect
that config. Rotate/revoke the token when needed.

Build publication on GitHub uses its short-lived `GITHUB_TOKEN` with
`packages:write`; no publishing PAT is required. After first publication, check
both GHCR package pages: keep the desired visibility, link them to this repository,
and grant this repository's Actions workflow access.

## 9. Capture SSH host keys from the existing trusted server session

On testing, substitute its actual Tailscale IP:

```bash
read -r -p 'Testing Tailscale 100.x.x.x address: ' server_tailnet_ip
printf '%s %s\n' "$server_tailnet_ip" "$(cut -d ' ' -f 1,2 /etc/ssh/ssh_host_ed25519_key.pub)"
unset server_tailnet_ip
```

Copy the single output line privately; this is `TEST_SSH_KNOWN_HOSTS`.
Repeat on production with its Tailscale IP to obtain `PROD_SSH_KNOWN_HOSTS`.
These are public host keys, not the private `/etc/ssh/..._key` files.

The workflow verifies the host key rather than trusting whichever server answers
on first connection. If host keys change, verify the change through administrator
access before replacing the corresponding GitHub secret.

## 10. Configure the repository in GitHub

Open `https://github.com/masyyhh/dive_center` → **Settings**.

### Repository variables

Under **Secrets and variables → Actions → Variables**, create:

| Name | Initial value |
|---|---|
| `CD_ENABLED` | `false` |
| `PRODUCTION_CD_ENABLED` | `false` |
| `TEST_TAILSCALE_IP` | Testing server's actual `100.x.x.x` address |
| `PROD_TAILSCALE_IP` | Production server's actual `100.x.x.x` address |

The workflow checks the literal lowercase string `true`. Missing variables keep
publication/deployment disabled. `PRODUCTION_CD_ENABLED=false` does not disable CI
or automatic testing releases.

### Environments and secrets

Create the `testing` and `production` environments under **Settings → Environments**
if your GitHub plan supports them. Restrict deployment branches to `main`.
Put the following secrets in the corresponding environment:

| Testing secret | Value |
|---|---|
| `TEST_TS_CLIENT_ID` | Testing OAuth client ID |
| `TEST_TS_CLIENT_SECRET` | Testing OAuth client secret |
| `TEST_DEPLOY_SSH_KEY` | Full contents of Mac `~/.ssh/dive_cd_testing` |
| `TEST_SSH_KNOWN_HOSTS` | Verified testing host-key line |

| Production secret | Value |
|---|---|
| `PROD_TS_CLIENT_ID` | Production OAuth client ID |
| `PROD_TS_CLIENT_SECRET` | Production OAuth client secret |
| `PROD_DEPLOY_SSH_KEY` | Full contents of Mac `~/.ssh/dive_cd_production` |
| `PROD_SSH_KNOWN_HOSTS` | Verified production host-key line |

On your Mac, copy a private key directly to the clipboard instead of printing it:

```bash
pbcopy < "$HOME/.ssh/dive_cd_testing"
```

Paste into the testing key secret, then use the production key only for its secret:

```bash
pbcopy < "$HOME/.ssh/dive_cd_production"
```

If your plan cannot use environment secrets, repository secrets with the exact
names work, but they have broader workflow access and do not create a reviewer
barrier. Keep production disabled until that access model is acceptable.

### Approval and repository protection

- Enable a required reviewer on `production` where supported.
- If you are the only administrator and must approve your own deployment, do not
  enable “prevent self-review.” For a two-person process, enable it and select
  another reviewer.
- Protect `main`: require pull requests and the `checks` CI job; disallow force pushes.
- Review workflow and deployment-script changes carefully. Repository write access
  is powerful because workflow authors can use deployment credentials.
- The workflows use upstream major action versions, consistent with the existing
  workflow. For stronger supply-chain control, resolve and pin full action commit
  SHAs and use Dependabot to propose reviewed updates.
- Enable Actions and allow `actions/checkout`, `actions/upload-artifact`,
  `docker/setup-buildx-action` and `tailscale/github-action` under your Actions policy.

## 11. Commit the implementation on your Mac

First finish and verify any separate application changes in the workspace.
Backend schema generation, tests and builds must all pass for the final committed
source. Do not hide a failure or disable a check to publish a release.

Inspect all local changes before staging; this workspace contains previous
application work as well as this deployment setup:

```bash
cd /Users/administrator/Documents/dive_center
git status --short
git diff
```

Stage the deployment files explicitly:

```bash
git add .github/workflows/ci.yml \
  .github/workflows/release.yml .github/workflows/promote-production.yml \
  scripts/cd/deploy.py scripts/cd/ssh-entry.py scripts/cd/install.py \
  scripts/cd/test_deploy.py deploy/CI-CD.md README.md \
  backend/src/services/authenticatorService.ts backend/tests/deployment-issuer.test.cjs \
  frontend/index.html frontend/public/environment.js \
  frontend/src/components/TestingBanner.tsx frontend/src/main.tsx
```

Review and include the separate feature changes only when they are ready.
Do not add migration captures, temporary credentials, `.env` files, databases,
private keys or the entire `outputs/` directory.

```bash
git diff --cached
git commit -m "Add testing-first container release and production promotion"
git push origin HEAD
```

Use your normal feature-branch / pull-request process. The new workflow files must
exist on the default branch before GitHub can trigger them correctly. Keep both
flags false for the initial merge. Confirm **Application checks** succeeds first.

## 12. Enable testing first

Set `CD_ENABLED=true`; keep `PRODUCTION_CD_ENABLED=false`.
Make a small reviewed commit or merge the next ready feature to `main`.

Open **Actions** and follow:

1. **Application checks** runs and must succeed.
2. **Release to testing** starts after that successful push-to-main check.
3. `publish` builds images and uploads `release-manifest`.
4. `testing` connects to the testing server and submits that manifest.
5. The server downloads images while the existing testing site stays available.
6. It validates the new Caddy binary and rehearses migrations on a temporary clone.
7. It verifies account fingerprints and authenticator decryption.
8. It stops testing web/backend, takes the final backup and applies migrations.
9. It starts the new backend, checks readiness, then starts web.
10. GitHub checks public HTTPS readiness and the testing environment marker.

When green, open `https://diving-staging.ssrsys.com` and refresh with **⌘⇧R**.
Verify login with the existing testing password and authenticator, property
permissions, catalogue, Photo pricing, bills, attendance, commissions, reports,
exports and the TESTING banner. Test actual workflows; readiness alone does not
prove that billing calculations are correct.

The run summary includes the release commit, both image digests, and the
**release run ID**. The ID is also the numeric part of the URL:

```text
https://github.com/masyyhh/dive_center/actions/runs/123456789
                                                     ^^^^^^^^^
```

Save that ID with the testing results. The manifest artifact is kept for 90 days;
promotion refuses an expired/deleted artifact. Keep the GHCR images for every
release you might promote or recover to. Do not delete them in an unrelated
registry cleanup policy.

## 13. Promote the accepted release to production

After one or more successful testing deployments, configure production approval
and set `PRODUCTION_CD_ENABLED=true`.

1. Open **Actions → Promote tested release to production → Run workflow**.
2. Select branch **main**.
3. Enter the successful **Release to testing** run ID.
4. Enter exactly `DEPLOY PRODUCTION`.
5. Start the workflow.
6. Review the selected commit and digests in the validation job summary.
7. Approve the production environment deployment if reviewer protection is enabled.

The validation job rejects unrelated workflows, failed/incomplete testing runs,
wrong branches, expired manifests and non-digest image references. It does not
select `latest`, rebuild source or copy testing data into production.

Production rehearses pending migrations against a private clone of its own
current database before stopping the application. During the short maintenance
window, users may see a proxy error. This initial design is not zero-downtime.
Database migrations are applied only after the final backup. Existing user
credentials and authenticator records are checked before and after migration.

After success, open `https://diving.ssrsys.com`. Check login, normal branding and
the important business flows. Do not use real customer transactions merely as
smoke-test data; use your established operational verification process.
NPM ports/upstreams do not change during releases.

The pipeline serializes testing deployments and serializes production deployments.
The server additionally holds a file lock. Do not run old migration/update helpers
concurrently with these jobs; they do not participate in that lock.

## 14. What changes on a server during deployment

The existing Compose files are retained. An additional override supplies only:

- Backend and web image digests.
- Explicitly disabled legacy live-auth mode.
- Environment-specific authenticator issuer.
- A public environment marker mounted into the frontend.

The active override and release records are stored privately in:

```text
/var/lib/dive-cd/testing/
/var/lib/dive-cd/production/
```

Only the appropriate directory exists on each server. Each release directory
contains its manifest, previous image IDs, candidate override, backup archives,
checksums and a success marker. Database/config backups contain private data;
keep this directory root-only. Copy required backups to separate protected storage
as part of your backup policy. Local deployment backups alone do not protect
against loss of the whole server/disk.

**After adopting this pipeline, service-management commands must include its
active override.** Running the original bare Compose command can switch the
application back to old image references on the next recreation.

Testing example (only after the first pipeline deployment):

```bash
cd /srv/dive-centre-testing-independent
sudo docker compose -p dive-centre-testing-standalone --env-file .env.testing \
  -f compose.yaml -f /var/lib/dive-cd/testing/active.override.json ps
```

Production example:

```bash
cd /srv/dive-centre-prod
sudo docker compose -p dive-centre-prod --env-file /dev/null \
  -f compose.migration.yaml -f compose.app.yaml \
  -f /var/lib/dive-cd/production/active.override.json ps
```

No deployment runs `down --volumes`, upgrades the DB image or prunes Docker.
Previous images receive rollback tags. Retained releases and backups consume disk;
review and archive them deliberately rather than automatically deleting recovery data.

## 15. Failures, logs and recovery

### Failure before maintenance

A build, image download, configuration check, clone migration or account check
failure leaves the existing application serving requests. The temporary database
is removed when possible. Inspect the log before retrying.

### Failure during maintenance, before web startup

The worker stops application services, validates the final backup, restores only
that environment's database if migrations began, and restarts the previous images.
It never restores an online rehearsal dump over a database that continued accepting
traffic: the recovery point is the dump taken after web/backend stopped.
If automatic recovery itself fails, keep that application offline and use its
private recovery directory with administrator assistance.

### Failure once web startup begins

Requests may already have written new records. The worker **does not automatically
restore a database after this point**. A later proxy failure or smoke-test failure
also does not restore data. Investigate logs and choose a schema-compatible image
rollback or forward fix; do not blindly restore an older database over new writes.

A failed public HTTPS check may mean the application deployed correctly but NPM,
DNS, certificate or external access is failing. It blocks promotion until a new
successful testing release run exists; it does not silently undo the server update.

### Logs and current release

On the affected server:

```bash
sudo systemctl list-units --all 'dive-cd-*'
sudo journalctl --since '2 hours ago' --no-pager | tail -n 200
```

To inspect one unit, copy its exact name from the first command:

```bash
sudo journalctl -u REPLACE_WITH_EXACT_UNIT_NAME --no-pager
```

Current release on testing:

```bash
sudo cat /var/lib/dive-cd/testing/current.json
sudo docker logs --tail 100 dive-centre-testing-standalone-backend-1
```

Current release on production:

```bash
sudo cat /var/lib/dive-cd/production/current.json
sudo docker logs --tail 100 dive-centre-prod-backend-1
```

An SSH disconnect or GitHub job cancellation does not necessarily stop the
server deployment: it runs as a systemd service. Inspect the unit and current
release before retrying. Do not kill Docker or restart the host during migration.
The file lock prevents a second pipeline worker from modifying the same app while
one is active. The worker records success locally before GitHub's public checks;
check both places if a connection drops.

### Disable deployment

Set `CD_ENABLED=false` and/or `PRODUCTION_CD_ENABLED=false` to block new releases.
This does not cancel a worker already running. To revoke future server access,
remove the relevant deployment public key from its root-owned authorized_keys
through the administrator account, revoke its Tailscale OAuth client, and rotate
the corresponding GitHub secrets. Preserve recovery files until investigated.

### Common problems

| Output / symptom | Check |
|---|---|
| No release job after CI | Both workflows on main, `CD_ENABLED=true`, CI came from a main push and succeeded |
| Production job skipped | Main selected and `PRODUCTION_CD_ENABLED=true` |
| Production awaiting review | Required reviewer must approve the environment |
| Tailscale authentication denied | Correct client scope/tag, separate environment secrets, device approval |
| SSH timeout | Actual Tailscale IP, access policy, server SSH service and host firewall |
| Host-key verification failed | Compare current public host key over trusted administrator access |
| Permission denied (publickey) | Correct environment key, forced authorized_keys entry and SSH logs |
| GHCR denied | Root Docker read login, token scope/expiry, package access/visibility |
| Wrong volume/port guard | Stop and compare actual state; do not bypass the environment guard |
| Migration or Prisma build fails | Complete/fix the feature migration; do not seed/reset production |
| Account fingerprint changes | Review migration contract; the pipeline deliberately refuses account mutations |
| Insufficient disk | Inspect named app images/backups; archive reviewed old data without global pruning |
| Site shows old assets | Hard refresh; verify current.json, public environment.js and correct NPM upstream |

## 16. Migration rules for future development

- Add a new migration for each schema change; never rewrite an already applied migration.
- Use expand-and-contract changes when older/newer application versions must coexist.
- Include a safe data backfill and test it against representative existing data.
- Destructive table/column removals and credential migrations need a dedicated rollout.
- Account-changing migrations are intentionally blocked by the fingerprint check;
  review and update that policy explicitly when such a release is required.
- Migrations must not call live PMS/email/payment systems. Rehearsal executes migrations
  on a clone; it does not run an API or external integration tasks.
- Keep environment-specific data/secrets out of Dockerfiles and build arguments.
- Preserve database backups and verify restoration regularly, independently of CD.

## 17. Validation boundaries and official references

Local checks cover deployment input validation, application-only overrides,
recovery guards, authenticator issuer behavior and build compatibility. Full
Docker/systemd/Tailscale/GitHub deployment still needs the first testing-server run;
no claim is made that those remote checks have already passed. The workflows remain
disabled until you finish setup.

- [GitHub environments and approval availability](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
- [GitHub Container Registry authentication](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [GitHub Actions security guidance](https://docs.github.com/en/actions/reference/security/secure-use)
- [Tailscale GitHub Action and OAuth setup](https://tailscale.com/kb/1276/tailscale-github-action)
- [Tailscale private CI/CD connectivity](https://tailscale.com/docs/solutions/connect-github-cicd-workflows-to-private-infrastructure-without-public-exposure)
- [Docker build and publish with GitHub Actions](https://docs.docker.com/build/ci/github-actions/)
