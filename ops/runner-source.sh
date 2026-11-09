#!/bin/bash
# Runner sends only a fixed verb and full commit SHA; never source/image data.
set -euo pipefail
set +x
[[ $# -eq 1 && ( $1 == deploy-source || $1 == build-source ) ]]
verb=$1
for name in DEPLOY_SSH_KEY DEPLOY_HOST DEPLOY_USER DEPLOY_PORT DEPLOY_KNOWN_HOSTS IMAGE_SHA; do
  [[ -n ${!name} ]] || { echo "::error::Missing setting: $name"; exit 1; }
done
[[ $IMAGE_SHA =~ ^[0-9a-f]{40}$ && $DEPLOY_USER == ekiden-deploy ]]
[[ $DEPLOY_PORT =~ ^[0-9]{1,5}$ ]] && (( 10#$DEPLOY_PORT >= 1 && 10#$DEPLOY_PORT <= 65535 ))
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
umask 077
ssh_dir=$(mktemp -d "$RUNNER_TEMP/ekiden-source.XXXXXX")
trap 'rm -rf -- "$ssh_dir"' EXIT
printf '%s\n' "$DEPLOY_SSH_KEY" > "$ssh_dir/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$ssh_dir/known_hosts"
set +e
timeout --kill-after=15s 2400s ssh -F /dev/null -T -n -i "$ssh_dir/key" -p "$DEPLOY_PORT" -l "$DEPLOY_USER" \
  -o BatchMode=yes -o IdentitiesOnly=yes -o IdentityAgent=none -o PreferredAuthentications=publickey \
  -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no -o StrictHostKeyChecking=yes \
  -o "UserKnownHostsFile=$ssh_dir/known_hosts" -o GlobalKnownHostsFile=/dev/null -o UpdateHostKeys=no \
  -o ConnectTimeout=10 -o ConnectionAttempts=1 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 \
  -o ForwardAgent=no -o ForwardX11=no -o ClearAllForwardings=yes \
  -- "$DEPLOY_HOST" "$verb $IMAGE_SHA" 2> "$ssh_dir/error" | \
  python3 "$script_dir/transfer-log.py" stream "$ssh_dir/result.json" 1 "${verb/deploy-source/source}"
status=("${PIPESTATUS[@]}")
set -e
python3 "$script_dir/transfer-log.py" result "$ssh_dir/result.json" "${status[0]}" 0 "${status[1]}"
