#!/bin/bash
# Runs only on the GitHub runner. Credentials are supplied through environment.
set -euo pipefail
set +x
[[ $# -ge 1 && $# -le 2 && -f $1 ]]
[[ $# -eq 1 || $2 == --upload-only ]]
archive=$1
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
diagnostics="$script_dir/transfer-log.py"
for name in DEPLOY_SSH_KEY DEPLOY_HOST DEPLOY_USER DEPLOY_PORT DEPLOY_KNOWN_HOSTS IMAGE_SHA CONFIG_DIGEST; do
  [[ -n ${!name} ]] || { echo "::error::Missing setting: $name"; exit 1; }
done
[[ $DEPLOY_USER == ekiden-deploy ]]
[[ $DEPLOY_PORT =~ ^[0-9]{1,5}$ ]] && (( 10#$DEPLOY_PORT >= 1 && 10#$DEPLOY_PORT <= 65535 ))
[[ $IMAGE_SHA =~ ^[0-9a-f]{40}$ && $CONFIG_DIGEST =~ ^sha256:[0-9a-f]{64}$ ]]
size=$(stat -c %s -- "$archive")
(( size > 0 && size <= 536870912 )) || { echo '::error::Archive exceeds 512 MiB upload limit.'; exit 1; }
python3 - "$size" <<'SIZE'
import sys
size = int(sys.argv[1])
print(f"Compressed image: {size} bytes ({size/1_000_000:.2f} MB; {size/1_048_576:.2f} MiB)", flush=True)
SIZE
checksum=$(sha256sum -- "$archive")
checksum=${checksum%% *}
umask 077
ssh_dir=$(mktemp -d "$RUNNER_TEMP/ekiden-transfer.XXXXXX")
trap 'rm -rf -- "$ssh_dir"' EXIT
printf '%s\n' "$DEPLOY_SSH_KEY" > "$ssh_dir/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$ssh_dir/known_hosts"
chmod 600 "$ssh_dir/key" "$ssh_dir/known_hosts"
ssh_options=(
  -F /dev/null -T -i "$ssh_dir/key" -p "$DEPLOY_PORT" -l "$DEPLOY_USER"
  -o BatchMode=yes -o IdentitiesOnly=yes -o IdentityAgent=none
  -o PreferredAuthentications=publickey -o PasswordAuthentication=no
  -o KbdInteractiveAuthentication=no -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=$ssh_dir/known_hosts" -o GlobalKnownHostsFile=/dev/null
  -o UpdateHostKeys=no -o ConnectTimeout=10 -o ConnectionAttempts=1
  -o ServerAliveInterval=15 -o ServerAliveCountMax=4
  -o ForwardAgent=no -o ForwardX11=no -o ClearAllForwardings=yes
)
# Upload stdin stays a pipe. Only validated numeric/status frames reach Actions.
# Capture PIPESTATUS immediately; do not collapse sender/SSH/logger failures.
set +e
cat -- "$archive" 2> "$ssh_dir/sender.err" | \
  timeout --kill-after=15s 2700s ssh "${ssh_options[@]}" -- "$DEPLOY_HOST" \
    "upload $IMAGE_SHA $checksum $CONFIG_DIGEST $size" 2> "$ssh_dir/upload.err" | \
  python3 "$diagnostics" stream "$ssh_dir/upload.json" "$size" upload
upload_status=("${PIPESTATUS[@]}")
set -e
python3 "$diagnostics" result "$ssh_dir/upload.json" "${upload_status[1]}" "${upload_status[0]}" "${upload_status[2]}" || exit 1
echo 'Ekiden image upload and integrity checks passed.'
if [[ ${2:-} == --upload-only ]]; then
  echo 'Upload-only test completed; no container was updated.'
  exit 0
fi
# Deployment is a separate operation, with its own timeout and closed stdin.
set +e
timeout --kill-after=15s 600s ssh "${ssh_options[@]}" -n -- "$DEPLOY_HOST" \
  "deploy $IMAGE_SHA $CONFIG_DIGEST" 2> "$ssh_dir/deploy.err" | \
  python3 "$diagnostics" stream "$ssh_dir/deploy.json" "$size" deploy
deploy_status=("${PIPESTATUS[@]}")
set -e
python3 "$diagnostics" result "$ssh_dir/deploy.json" "${deploy_status[0]}" 0 "${deploy_status[1]}" || exit 1
echo 'Ekiden deployment passed health checks.'
