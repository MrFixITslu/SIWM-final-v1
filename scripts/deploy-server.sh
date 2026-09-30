#!/usr/bin/env bash
set -euo pipefail

sha="${1:?Missing validated commit SHA}"
root="${2:?Missing absolute deployment directory}"
project="${3:?Missing existing Compose project name}"

[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid commit SHA' >&2; exit 1; }
[[ "$root" = /* && "$root" != / && "$root" != *'..'* ]] || {
  echo 'DEPLOY_ROOT must be a safe absolute app directory' >&2
  exit 1
}
[[ "$project" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo 'Invalid Compose project' >&2; exit 1; }

for executable in docker rsync tar; do
  command -v "$executable" >/dev/null || { echo "Missing $executable" >&2; exit 1; }
done

archive="$HOME/v79-release-${sha}.tar.gz"
test -f "$archive" || { echo 'Release bundle missing' >&2; exit 1; }
test -d "$root" && test -f "$root/.env" || {
  echo "Existing SIWM app directory and .env required: $root" >&2
  exit 1
}

docker network inspect proxy_network >/dev/null
docker compose version >/dev/null

stage="$(mktemp -d "$root/.incoming.XXXXXXXX")"
trap 'rm -rf -- "$stage"' EXIT
tar -xzf "$archive" -C "$stage" --no-same-owner

for required in docker-compose.yml Dockerfile.backend Dockerfile.frontend nginx.conf; do
  test -f "$stage/$required" || { echo "Release missing $required" >&2; exit 1; }
done

rsync -a   --exclude='/.env' --exclude='/.env.*'   --exclude='/node_modules/' --exclude='/dist/'   --exclude='/.git/' "$stage/" "$root/"

cd "$root"
services="$(docker compose --project-name "$project" config --services)"
grep -Fx 'siwm-backend' <<<"$services" >/dev/null
grep -Fx 'siwm-frontend' <<<"$services" >/dev/null

docker compose --project-name "$project" up -d --build --wait --wait-timeout 180 siwm-backend siwm-frontend

for attempt in {1..18}; do
  backend_ok=0
  frontend_ok=0

  if docker compose --project-name "$project" exec -T siwm-backend       node -e "fetch('http://127.0.0.1:4001/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"; then
    backend_ok=1
  fi

  if docker compose --project-name "$project" exec -T siwm-frontend       wget -q -O /dev/null http://127.0.0.1:4000/api/health; then
    frontend_ok=1
  fi

  if [[ "$backend_ok" -eq 1 && "$frontend_ok" -eq 1 ]]; then
    printf '%s\n' "$sha" > .deployed_sha
    rm -f -- "$archive"
    echo "Deployed and checked SIWM frontend/backend: $sha"
    exit 0
  fi
  sleep 5
done

echo 'SIWM health checks failed after deployment' >&2
docker compose --project-name "$project" ps >&2
docker compose --project-name "$project" logs --tail=100 siwm-backend siwm-frontend >&2
exit 1
