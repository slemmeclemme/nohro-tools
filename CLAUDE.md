# Nohro Compliance Tools — china.nohro.dk

## Project Overview

Static HTML compliance checker hosted on GitHub Pages at `china.nohro.dk`. Used by Nohro's China office to validate supplier packaging paperwork and BOM/BOS documents before submission. All logic runs client-side in the browser (no backend except an Azure Function proxy for AI checks).

## Architecture

- **Frontend**: Single-file `index.html` (~1450 lines) — vanilla JS, no build step, no framework
- **Hosting**: GitHub Pages from `main` branch → custom domain `china.nohro.dk` (CNAME file)
- **AI Proxy**: Azure Function App `nohro-compliance-proxy` (West Europe) forwards requests to Anthropic API. Required because `api.anthropic.com` is blocked by China's Great Firewall. Endpoint: `https://nohro-compliance-proxy.azurewebsites.net/api/proxy`
- **Excel parsing**: SheetJS (XLSX library) vendored locally as `xlsx.full.min.js` (same-origin — CDN was unreliable from China), runs in browser

## Two Checker Tabs

### Tab 1: BOM/BOS Check
Validates Bill of Materials / Bill of Substances Excel files. Checks CAS numbers, SVHC substances, concentrations, REACH status. Includes TPR material-family guidance.

### Tab 2: Packaging Paperwork Check
Validates packaging paperwork Excel files against Nohro's template. Two phases:
1. **Rule-based checks** (instant): field completeness, recycling codes, material% sums, weight consistency, dimension fit, PVC policy, battery requirements
2. **AI check** (Claude claude-sonnet-4-6 via proxy): deeper contextual analysis

## Template Layout (current version)

The paperwork template has TWO sets of material columns:
- **Product materials** (cols F, G, H): Product materials, Material%, Weight pr. material
- **Packaging materials** (cols J–N): Component, Type, Recycling Code, Material%, Weight pr. material

Column detection uses `PW_LAST_MATCH` for `matpct`/`matwt` to ensure they map to the PACKAGING columns (last occurrence), while `prodmatpct`/`prodmatwt` map to the PRODUCT columns (first occurrence).

Merged cells are expanded after XLSX parsing (`ws['!merges']`) because item-level fields (carton info, NW, GW) span multiple component rows.

## Key Business Rules

- **PVC = ERROR**: PVC is not accepted in packaging (Nohro policy)
- **Batteries = Yes**: Requires type, pcs, changeable, weight — all four fields
- **Product material % must sum to 100%** per item
- **Packaging material % must sum to 100%** per item
- **Packaging weights must equal GW − NW** per item
- **Packaging must fit in master carton** (dimension check with 0.5cm tolerance)
- **Valid recycling codes**: PET(1), HDPE(2), PVC(3), LDPE(4), PP(5), PS(6), OTHER(7), PAP 20/21/22, NO LABEL
- **TPR is a material family**, not a single substance — guide suppliers to list individual polymers
- **Composite components** (cable/wire/cord, zipper, PCB, motor, switch, plug, speaker, battery, LED module — `COMPOSITE_RE`) physically consist of multiple materials; a single-material declaration (e.g. cable = 100% copper) is an ERROR. The BOM AI prompt has a matching condition 4 for cases outside the list.

## File Structure

```
index.html        — The entire application (HTML + CSS + JS)
xlsx.full.min.js  — Vendored SheetJS 0.18.5 (do not load from CDN)
CNAME             — Custom domain config for GitHub Pages
CLAUDE.md         — This file
```

## Development Workflow

1. Edit `index.html`
2. `git add index.html && git commit -m "..." && git push`
3. GitHub Pages deploys automatically (~60-90 seconds)
4. Hard-refresh browser (Cmd+Shift+R) to bypass cache
5. Test at https://china.nohro.dk

## Azure Function (proxy)

- Resource group: `nohro-compliance`
- Function App: `nohro-compliance-proxy` (West Europe, Linux, Node 20)
- Endpoint: `POST /api/proxy`
- App setting: `ANTHROPIC_KEY` (API key for Anthropic)
- Platform CORS: `*` (configured via `az functionapp cors add`)
- The proxy forwards POST body to `https://api.anthropic.com/v1/messages` with the API key

## Languages

UI supports English and Chinese (simplified). Language strings are in the `L` object at the top of the script section. Every user-facing string should have both `en` and `zh` entries.

## Known Patterns / Gotchas

- **Merged cells**: SheetJS only returns values in top-left cell of a merge. The code explicitly expands merges after `sheet_to_json`.
- **Duplicate column headers**: "Material %" and "Weight pr. material" appear twice (product + packaging). `PW_LAST_MATCH` set ensures packaging columns are used for checks.
- **Sheet selection**: Template has multiple sheets (Paperwork, Paperwork Reference, Recycling Code Reference, Supplier Guide). Parser prefers sheets matching `/paper|packaging|pack/i` but excludes `/reference|guide|example|template|sample/i`.
- **Row skip patterns**: Rows starting with `▸`, "example item", "add rows as needed", "your items" are skipped.
- **Forward-fill item numbers**: Rows without an item number inherit from the previous row (`lastItemNo`).
- **Product-only rows**: Rows with only product material data (no packaging component) are skipped in packaging validation.
- **Yes/No fields**: `isYesVal`/`isNoVal` require exact yes/no (en/zh) — the template placeholder "Yes/No" must NOT match yes (previously caused false PVC errors).
- **Weights**: `parseWt` understands "g" and "kg" suffixes and comma decimals; kg is converted to grams.
- **Recycling codes**: input is normalised (`normRecycCode`: parens→space, letter/digit split, leading zeros stripped) before lookup, so "PAP(20)"/"PET (01)" pass.
- **Photos**: downscaled to max 1568px JPEG in-browser before AI upload (API rejects images >5MB; also converts HEIC where the browser can decode it).
- **AI proxy calls**: shared `callAIProxy()` with 60s AbortController timeout; "No issues found"-style AI lines are filtered (`AI_NO_ISSUE_RE`); `stop_reason: max_tokens` appends a truncation notice.
- **Row cap**: parsing caps at 5000 rows (stray formatting can blow up `!ref`); the debug panel shows when capped.
- **Rule messages are escaped**: `s()` HTML-escapes interpolated vars (cell content goes into innerHTML).
