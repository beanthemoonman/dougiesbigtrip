#!/bin/sh
# ---------------------------------------------------------------------------
# Post-startup hook — patches the Google identity provider clientId and
# clientSecret in the running Keycloak instance.
#
# Keycloak 26 does not resolve ${env.GOOGLE_CLIENT_ID} placeholders in
# realm JSON at import time, so we inject them via the Admin API after the
# realm has been created.  No restart is required.
# ---------------------------------------------------------------------------
set -eu

: "${KC_BOOTSTRAP_ADMIN_USERNAME:?}"
: "${KC_BOOTSTRAP_ADMIN_PASSWORD:?}"
: "${GOOGLE_CLIENT_ID:?}"
: "${GOOGLE_CLIENT_SECRET:?}"

KEYCLOAK_URL="http://auth:8080/auth"
MAX_RETRIES=60
RETRY_INTERVAL=2

echo "[init-keycloak-idp] Waiting for Keycloak…"
i=0
while [ "$i" -lt "$MAX_RETRIES" ]; do
  if curl -sf "${KEYCLOAK_URL}/realms/counter-douglas" > /dev/null 2>&1; then
    echo "[init-keycloak-idp] Keycloak is ready."
    break
  fi
  i=$((i + 1))
  sleep "$RETRY_INTERVAL"
done

if [ "$i" -ge "$MAX_RETRIES" ]; then
  echo "[init-keycloak-idp] ERROR: Keycloak did not become healthy after ${MAX_RETRIES} attempts." >&2
  exit 1
fi

echo "[init-keycloak-idp] Requesting admin token…"
ADMIN_TOKEN=$(curl -sf -X POST "${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d "client_id=admin-cli" \
  -d "username=${KC_BOOTSTRAP_ADMIN_USERNAME}" \
  -d "password=${KC_BOOTSTRAP_ADMIN_PASSWORD}" \
  -d "grant_type=password" | jq -r '.access_token')

if [ -z "$ADMIN_TOKEN" ] || [ "$ADMIN_TOKEN" = "null" ]; then
  echo "[init-keycloak-idp] ERROR: Failed to obtain admin token." >&2
  exit 1
fi

echo "[init-keycloak-idp] Fetching Google IDP config…"
IDP_JSON=$(curl -sf -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  "${KEYCLOAK_URL}/admin/realms/counter-douglas/identity-provider/instances/google")

if [ -z "$IDP_JSON" ]; then
  echo "[init-keycloak-idp] ERROR: Google IDP not found." >&2
  exit 1
fi

echo "[init-keycloak-idp] Merging OAuth credentials…"
# updateProfileFirstLoginMode=missing + trustEmail: Google already gives us a
# verified email, first and last name, so the "Update Account Information"
# review screen has nothing to ask for. Re-applied here because --import-realm
# is a no-op once the realm exists.
UPDATED=$(echo "$IDP_JSON" | jq --arg cid "${GOOGLE_CLIENT_ID}" --arg cs "${GOOGLE_CLIENT_SECRET}" \
  '.config.clientId = $cid | .config.clientSecret = $cs
   | .updateProfileFirstLoginMode = "missing" | .trustEmail = true
   | del(.internalId)')

echo "[init-keycloak-idp] Pushing updated config…"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H 'Content-Type: application/json' \
  "${KEYCLOAK_URL}/admin/realms/counter-douglas/identity-provider/instances/google" \
  -d "$UPDATED")

if [ "$HTTP_STATUS" != "204" ]; then
  echo "[init-keycloak-idp] ERROR: PUT returned HTTP ${HTTP_STATUS}" >&2
  exit 1
fi

# The old realm shipped two hardcoded-attribute mappers that stamped the
# literal string "email" onto every brokered user's email/username, which is
# what made Keycloak stop and demand valid account information. Google's own
# claims already populate those fields.
echo "[init-keycloak-idp] Removing legacy hardcoded IDP mappers…"
curl -sf -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  "${KEYCLOAK_URL}/admin/realms/counter-douglas/identity-provider/instances/google/mappers" \
  | jq -r '.[] | select(.identityProviderMapper == "hardcoded-attribute-idp-mapper") | .id' \
  | while read -r MAPPER_ID; do
      echo "[init-keycloak-idp]   deleting mapper ${MAPPER_ID}"
      curl -sf -X DELETE -H "Authorization: Bearer ${ADMIN_TOKEN}" \
        "${KEYCLOAK_URL}/admin/realms/counter-douglas/identity-provider/instances/google/mappers/${MAPPER_ID}"
    done

echo "[init-keycloak-idp] Done — Google IDP credentials updated."
