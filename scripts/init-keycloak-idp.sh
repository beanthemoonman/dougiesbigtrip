#!/bin/sh
# ---------------------------------------------------------------------------
# Post-startup hook — re-applies the bits of realm config that `--import-realm`
# cannot: it is a no-op once the realm exists, and it does not resolve
# ${env.GOOGLE_CLIENT_ID} placeholders even on a fresh import.
#
#   1. Google IDP clientId/clientSecret  — skipped when the creds are unset.
#   2. The "basic" default client scope   — always, it is what puts `sub` in the
#                                           access token (Keycloak 24+).
#
# No restart is required.
# ---------------------------------------------------------------------------
set -eu

: "${KC_BOOTSTRAP_ADMIN_USERNAME:?}"
: "${KC_BOOTSTRAP_ADMIN_PASSWORD:?}"

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

if [ -z "${GOOGLE_CLIENT_ID:-}" ] || [ -z "${GOOGLE_CLIENT_SECRET:-}" ]; then
  echo "[init-keycloak-idp] GOOGLE_CLIENT_ID/SECRET unset — skipping the Google IDP patch."
else

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

fi

# Since Keycloak 24 the `sub` claim comes from the built-in "basic" client
# scope. This realm ships its own scope list and no "basic" scope exists in it,
# so access tokens carried no `sub` and the game server refused every join with
# "token missing sub". The realm JSON now maps `sub` on the client directly;
# re-apply it here too, because --import-realm is a no-op on an existing realm.
echo "[init-keycloak-idp] Ensuring the 'sub' claim mapper on counter-douglas-spa…"
CLIENT_UUID=$(curl -sf -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  "${KEYCLOAK_URL}/admin/realms/counter-douglas/clients?clientId=counter-douglas-spa" \
  | jq -r '.[0].id')

if [ -z "$CLIENT_UUID" ] || [ "$CLIENT_UUID" = "null" ]; then
  echo "[init-keycloak-idp] ERROR: counter-douglas-spa client not found." >&2
  exit 1
fi

HAS_SUB=$(curl -sf -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  "${KEYCLOAK_URL}/admin/realms/counter-douglas/clients/${CLIENT_UUID}/protocol-mappers/models" \
  | jq -r '[.[] | select(.protocolMapper == "oidc-sub-mapper")] | length')

if [ "$HAS_SUB" = "0" ]; then
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    -H 'Content-Type: application/json' \
    "${KEYCLOAK_URL}/admin/realms/counter-douglas/clients/${CLIENT_UUID}/protocol-mappers/models" \
    -d '{"name":"subject","protocol":"openid-connect","protocolMapper":"oidc-sub-mapper",
         "consentRequired":false,
         "config":{"access.token.claim":"true","introspection.token.claim":"true"}}')
  if [ "$HTTP_STATUS" != "201" ]; then
    echo "[init-keycloak-idp] ERROR: creating the sub mapper returned HTTP ${HTTP_STATUS}" >&2
    exit 1
  fi
  echo "[init-keycloak-idp]   created."
else
  echo "[init-keycloak-idp]   already present."
fi

echo "[init-keycloak-idp] Done."
