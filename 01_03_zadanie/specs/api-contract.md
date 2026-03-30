# API Contract — External Packages API

## Endpoint

```
POST https://hub.ag3nts.org/api/packages
Content-Type: application/json
```

All actions share the same endpoint. The `action` field selects the operation.

---

## Action: check

Request:
```json
{
  "apikey": "<AG3NTS_API_KEY>",
  "action": "check",
  "packageid": "PKG12345678"
}
```

Response: package status object (status, location, estimated delivery, etc.)

---

## Action: redirect

Request:
```json
{
  "apikey": "<AG3NTS_API_KEY>",
  "action": "redirect",
  "packageid": "PKG12345678",
  "destination": "WRO-01",
  "code": "<security-code-from-operator>"
}
```

Response: includes `confirmation` field — this code must be returned verbatim to the operator.

---

## Error handling

- Non-2xx status → throw with `data.message` or `API error (status)`
- HTML response → wrong URL or endpoint — check `PACKAGES_API_URL` env var
