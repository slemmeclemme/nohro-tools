# Azure AI Proxy (nohro-compliance-proxy)

Source for the Azure Function that relays the checker's AI calls to the
Anthropic API (api.anthropic.com is blocked in China; the key lives in the
`ANTHROPIC_KEY` app setting, never in the client).

- **App**: `nohro-compliance-proxy`, resource group `nohro-compliance`,
  subscription "Nohro - Bornerups", West Europe, Linux Consumption, **Node 20**
  (Node 24 is NOT supported on this plan — setting it takes the app down with 503s).
- **Endpoint**: `POST https://nohro-compliance-proxy.azurewebsites.net/api/proxy`

## Hardening (2026-07-06)

- Origin allowlist: `https://china.nohro.dk` + `http://localhost:8737` (dev).
  Configured BOTH in code and in platform CORS (`az functionapp cors`) — the
  platform answers some preflights before the function runs, so both must match.
- Model whitelist: `claude-fable-5`, `claude-sonnet-4-6`; `max_tokens` capped
  at 4000; `output_config.effort` limited to low/medium/high.
- Outbound body is REBUILT from validated fields — `system`, `tools`,
  `stream` etc. from the client are dropped, so the key can't be used as a
  general-purpose relay.
- 20MB body cap; soft per-IP rate limit (30 req / 5 min, per instance).

## Deploy

```sh
cd azure-proxy
zip -r /tmp/proxy-deploy.zip host.json package.json proxy/
az functionapp deployment source config-zip -g nohro-compliance \
  -n nohro-compliance-proxy --src /tmp/proxy-deploy.zip
```

This folder is the source of truth — the deployed package is otherwise only
recoverable from the `WEBSITE_RUN_FROM_PACKAGE` blob URL.
