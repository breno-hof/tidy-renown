#!/usr/bin/env bash
# Sends a payload to the Foundry VTT Package Release API.
# Usage: FOUNDRY_TOKEN=fvttp_... foundry-release.sh payload.json
# Honors Retry-After on 429 and fails on anything other than {"status": "success"}.
set -euo pipefail

PAYLOAD_FILE="${1:?usage: foundry-release.sh <payload.json>}"
API="${FOUNDRY_API:-https://foundryvtt.com/_api/packages/release_version/}"
: "${FOUNDRY_TOKEN:?FOUNDRY_TOKEN is not set}"

send() {
  curl -sS -o response.json -D headers.txt -w '%{http_code}' \
    -X POST "$API" \
    -H 'Content-Type: application/json' \
    -H "Authorization: ${FOUNDRY_TOKEN}" \
    --data @"$PAYLOAD_FILE"
}

CODE=$(send)

if [ "$CODE" = "429" ]; then
  WAIT=$(grep -i '^retry-after:' headers.txt | tr -dc '0-9' || true)
  echo "Rate limited by Foundry; waiting ${WAIT:-60}s"
  sleep "${WAIT:-60}"
  CODE=$(send)
fi

echo "HTTP $CODE"
cat response.json
echo

STATUS=$(jq -r '.status // empty' response.json 2>/dev/null || true)
if [ "$CODE" != "200" ] || [ "$STATUS" != "success" ]; then
  echo "::error::Foundry Package Release API failed (HTTP $CODE)"
  exit 1
fi
