# 4. Deploy from CI on every push to main

Status: accepted. Replaces the "Manual deploy, no CD" point of [ADR 0001](0001-cloud-run-single-container.md).

## Context

Deploys were one manual `gcloud run deploy --source .` command, so the live site fell behind `main` whenever nobody ran it. The live URL must stay the same, the deploy must not ship code that failed tests, and GitHub must not hold a long-lived cloud credential. `main` is not branch-protected, so a gate has to live in the pipeline itself.

## Decision

- **A `deploy` job in the existing CI workflow**, after the `test` job (`needs: test`), on pushes to `main` only. It runs the same `gcloud run deploy --source .` command as before, so the deployed revision passed tests, the build and the secret scan first. The Cloud Run service URL does not change; each deploy adds a revision. It takes production traffic when the service is configured to follow the latest revision.
- **Workload Identity Federation, no key.** GitHub's short-lived OIDC token is exchanged for a short-lived Google token for a `github-deployer` service account. Nothing is stored in GitHub secrets. The identity provider accepts only tokens whose repository id is this repository's, whose ref is `refs/heads/main`, and whose event is `push`, so pull requests and forks cannot obtain credentials.
- **Least privilege.** The deployer holds `roles/run.sourceDeveloper` and `roles/serviceusage.serviceUsageConsumer`, and may act as the service's runtime account. It cannot change IAM.
- **No overlapping deploys.** Runs on `main` are never cancelled, and deploys share one concurrency group, so a second merge waits instead of interrupting the first.
- **Image cleanup.** Artifact Registry keeps the 3 most recent images; older ones are deleted. Each image is about 200 MB and the free tier is 0.5 GB.

A Cloud Build trigger was the alternative. It runs in parallel with GitHub Actions and cannot see its result, so it would need its own copy of the tests, plus a GitHub app installation.

## Consequences

- A merge to `main` goes live within a few minutes when production traffic follows the latest revision. A pinned traffic target can keep an older revision live even when the deploy and health check succeed.
- `--min-instances` is left out of the CI command. `gcloud run deploy` keeps settings it is not given, so a temporary `--min-instances 1` survives later deploys. `--max-instances 1` stays explicit, because stream cancel depends on a single instance (ADR 0001).
- Rollback is a traffic switch to an earlier revision, limited to revisions whose image is still kept (the last two before the current one). A later deploy does not necessarily undo a pinned traffic target. After rollback or a no-traffic deployment, inspect the service's traffic and latest ready revision; when the new version is ready for production, restore latest-revision routing as described in the README.
- Docs-only commits also deploy. That costs a few build minutes, well inside the free allowance, and avoids a path filter.
- The manual command still works as a fallback when Actions is unavailable.
