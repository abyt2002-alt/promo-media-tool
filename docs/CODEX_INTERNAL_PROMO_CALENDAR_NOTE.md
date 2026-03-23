# Promo Calendar Optimisation - Internal Build Note

## Repository
- Name: `promo-media-tool`
- URL: `https://github.com/abyt2002-alt/promo-media-tool.git`
- Branch: `main`

## Why this app exists
This standalone app was created from the earlier **pricing demo tool** work, specifically from **Step 4 (Promo Calendar)**, so promo planning can run independently.

## Lineage (what happened)
1. Base app work started in pricing workflow (Brand Ladder -> Insights -> Base Ladder Detection).
2. Promo Calendar logic was built as Step 4 in that workflow.
3. Then a separate standalone app was created in this folder:
   - `C:\Users\abqua\QuantMatrix AI Solutions\Quant Matrix Master - Documents\General\Client Engagement\ABFRL\promo demo tool`
4. Routing was simplified so this app opens Promo Calendar directly.
5. Backend/Frontend ports were separated from the original tool.
6. Baseline source was changed from Step-3 localStorage dependency to saved base-ladder file input logic.

## Current standalone behavior

### Baseline source
- Primary source: latest `base_ladder_saved_scenarios_*.xls/.xlsx`
- Search order:
  1. current folder only (`promo demo tool`)

### What is read from saved file
- `Product`
- `Recommended Price` (used as promo anchor/base price)
- `Base Volume` (if present)
- `Month` (if present)

### Input contract (source-of-truth view)
- Required from saved scenario file:
  - `Product`
  - `Recommended Price`
- Optional from saved scenario file:
  - `Base Volume`
  - `Month`
- If optional fields are missing:
  - `Base Volume` fallback = computed from model conversion pipeline
  - `Month` fallback = latest available month in backend dataset

### Elasticity/model flow (exact)
For each run:
1. Load rows for selected month from backend data.
2. Apply base-price overrides from saved scenario file (`Recommended Price`).
3. Build own and cross elasticities:
   - `own_current = build_own_elasticities(rows)`
   - `cross_current = build_cross_elasticity_matrix(rows)`
4. Scale cross effect globally (`CROSS_IMPACT_GLOBAL_SCALE`).
5. Convert to base-reference context:
   - `own_base, cross_base, base_volumes = convert_to_base_reference(...)`
6. If file has `Base Volume`, override converted base volumes product-wise.
7. Build model coefficients:
   - `beta_ppu, gamma_matrix = build_beta_and_gamma(...)`
8. Run promo scenario generation and weekly evaluation with own + subtle cross terms.

This means **elasticity inputs are recomputed in promo backend each run**, while anchor prices (and optional base volumes) come from saved base-ladder file.

### What is persisted locally each run
File: `promo_calendar_context_latest.json`

Stored model context:
- base prices
- base volumes
- own elasticity at base
- cross elasticity matrix
- beta (PPU)
- gamma matrix
- product list
- selected month

This makes the promo tool reusable independently.

## Step 4 promo model summary (current)
- Horizon: 27 weeks
- Promo window: W16-W27
- Allowed discount levels: `0, 10, 20, 30, 40`
- Monotonic non-decreasing promo path once promo starts
- Min/Max promo-week constraints enforced
- Bucket generation:
  - Max Volume (500)
  - Max Revenue (500)
  - Max Profit (500)
  - target total: 1500 unique scenarios (if feasible)
- Weekly demand evaluation uses:
  - own-price term
  - subtle cross-price term (scaled)

## Ports (separate from pricing app)
- Frontend (Vite): `5174`
- Backend (FastAPI): `8012`

## Run commands

### Backend
```powershell
cd "C:\Users\abqua\QuantMatrix AI Solutions\Quant Matrix Master - Documents\General\Client Engagement\ABFRL\promo demo tool"
pip install -r backend/requirements.txt
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8012 --reload
```

### Frontend
```powershell
cd "C:\Users\abqua\QuantMatrix AI Solutions\Quant Matrix Master - Documents\General\Client Engagement\ABFRL\promo demo tool"
npm install
npm run dev
```

## Key files (high-signal)
- `src/pages/PromoCalendarPage.jsx`
- `src/pages/PromoCalendarOptimisationApp.jsx`
- `src/App.jsx`
- `src/components/layout/AppLayout.jsx`
- `backend/services/promo_calendar_service.py`
- `backend/routers/promo_calendar.py`
- `backend/schemas/promo_calendar.py`
- `backend/main.py`

## Notes for future reuse
- This app intentionally keeps promo logic focused; no full multi-step workflow dependency.
- If saved base-ladder file format changes, update parser in backend service first.
- `promo_calendar_context_latest.json` can be used as a stable handoff artifact for future optimization/reporting workflows.

## If Step 4 becomes the only truth (full decouple checklist)
To make this app the only source of truth permanently:
1. Keep and version-control `promo_calendar_context_latest.json` generation format.
2. Keep baseline file read scoped to current folder only.
3. Keep only promo routes in backend (already done in `backend/main.py`).
4. Remove non-promo UI/pages/components if not needed.
5. Freeze saved-file schema for `base_ladder_saved_scenarios_*.xls/.xlsx` and document it separately.
6. Add a startup validation check that required file columns exist (`Product`, `Recommended Price`).
