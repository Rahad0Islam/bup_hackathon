# GridWise LLM — Smart Campus Energy Optimization

**BUP CSE Fest 2026 Hackathon | Online Preliminary Round**

A production-grade backend service that interprets operator notes via LLM (Gemini), applies deterministic guardrails, solves a 24-hour energy dispatch using Linear Programming, and returns a cost-minimized valid schedule.

## System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    POST /optimize-energy                         │
│                         ↓                                        │
│              ┌─────────────────────┐                             │
│              │  Zod Request        │  ← Schema validation        │
│              │  Validation         │                             │
│              └────────┬────────────┘                             │
│                       ↓                                          │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │        PHASE 1: LLM Structured Extraction               │     │
│  │  System prompt + few-shot examples → JSON-mode output   │     │
│  └────────────────────┬────────────────────────────────────┘     │
│                       ↓                                          │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │        PHASE 2: Verification & Self-Correction           │     │
│  │  Check B: Semantic audit (factor inversion, etc.)       │     │
│  │  Secondary LLM critique prompt if issues detected       │     │
│  └────────────────────┬────────────────────────────────────┘     │
│                       ↓                                          │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │        CHECK C: Deterministic Guardrails                 │     │
│  │  Dedup hours, sort, clamp factor/reserve/grid caps      │     │
│  └────────────────────┬────────────────────────────────────┘     │
│                       ↓                                          │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │        CHECK A: Schema & Invariant Validation            │     │
│  │  Zod directive schemas + applies/no_op consistency      │     │
│  └────────────────────┬────────────────────────────────────┘     │
│                       ↓                                          │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │        LP Optimization (javascript-lp-solver)            │     │
│  │  Minimize grid cost subject to all constraints          │     │
│  └────────────────────┬────────────────────────────────────┘     │
│                       ↓                                          │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │        Physical Replay & Validation                      │     │
│  │  Step-by-step battery simulation, constraint checks     │     │
│  └────────────────────┬────────────────────────────────────┘     │
│                       ↓                                          │
│              ┌─────────────────────┐                             │
│              │  Metrics Recalc &   │                             │
│              │  JSON Response      │                             │
│              └─────────────────────┘                             │
└──────────────────────────────────────────────────────────────────┘
```

## Pipeline Flow

1. **Request Validation** — Zod validates the incoming JSON (24 unique hours, 1-3 operator notes, valid battery specs)
2. **LLM Extraction** — Gemini interprets each operator note into one of 6 directive types with structured parameters
3. **Semantic Verification** — Detects edge cases (inverted solar factors, empty hours) and runs a secondary LLM self-audit
4. **Deterministic Guardrails** — Deduplicates/sorts hours, clamps numeric values, enforces applies/no_op consistency
5. **Schema Validation** — Validates each directive against its Zod schema
6. **LP Optimization** — Builds and solves a linear program minimizing grid cost subject to all constraints
7. **Physical Replay** — Independently simulates the schedule hour-by-hour to verify all constraints
8. **Metrics Recalculation** — Computes total_grid_kwh, total_cost_bdt, peak_grid_kwh from the hourly plan

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `8000` | HTTP server port |
| `GEMINI_API_KEY` | **Yes** | — | Google Gemini API key |
| `GEMINI_MODEL` | No | `gemini-2.5-flash` | Gemini model name |
| `LLM_PROVIDER` | No | `gemini` | LLM provider (`gemini` \| `openai`) |
| `NODE_ENV` | No | `development` | Environment mode |

## Local Quickstart

```bash
# 1. Install dependencies
npm install

# 2. Set up environment variables
cp .env.example .env
# Edit .env and set your GEMINI_API_KEY

# 3. Start the development server
npm run dev

# 4. Test health endpoint
curl http://localhost:8000/health
# → {"status":"ok"}

# 5. Test with a sample scenario
curl -X POST http://localhost:8000/optimize-energy \
  -H "Content-Type: application/json" \
  -d '{
    "scenario_id": "TEST-01",
    "operator_notes": [
      "Solar output will drop to about 20% from 1 PM to 3 PM.",
      "The cafeteria menu changes tomorrow."
    ],
    "hours": [
      {"hour":0,"demand_kwh":90,"solar_kwh":0,"tariff_bdt_per_kwh":6},
      {"hour":1,"demand_kwh":85,"solar_kwh":0,"tariff_bdt_per_kwh":6},
      {"hour":2,"demand_kwh":80,"solar_kwh":0,"tariff_bdt_per_kwh":5},
      {"hour":3,"demand_kwh":80,"solar_kwh":0,"tariff_bdt_per_kwh":5},
      {"hour":4,"demand_kwh":85,"solar_kwh":0,"tariff_bdt_per_kwh":5},
      {"hour":5,"demand_kwh":95,"solar_kwh":0,"tariff_bdt_per_kwh":6},
      {"hour":6,"demand_kwh":110,"solar_kwh":5,"tariff_bdt_per_kwh":8},
      {"hour":7,"demand_kwh":130,"solar_kwh":20,"tariff_bdt_per_kwh":10},
      {"hour":8,"demand_kwh":150,"solar_kwh":50,"tariff_bdt_per_kwh":12},
      {"hour":9,"demand_kwh":165,"solar_kwh":90,"tariff_bdt_per_kwh":14},
      {"hour":10,"demand_kwh":175,"solar_kwh":130,"tariff_bdt_per_kwh":16},
      {"hour":11,"demand_kwh":180,"solar_kwh":160,"tariff_bdt_per_kwh":16},
      {"hour":12,"demand_kwh":185,"solar_kwh":180,"tariff_bdt_per_kwh":15},
      {"hour":13,"demand_kwh":180,"solar_kwh":170,"tariff_bdt_per_kwh":14},
      {"hour":14,"demand_kwh":170,"solar_kwh":140,"tariff_bdt_per_kwh":13},
      {"hour":15,"demand_kwh":165,"solar_kwh":90,"tariff_bdt_per_kwh":14},
      {"hour":16,"demand_kwh":170,"solar_kwh":45,"tariff_bdt_per_kwh":18},
      {"hour":17,"demand_kwh":185,"solar_kwh":10,"tariff_bdt_per_kwh":22},
      {"hour":18,"demand_kwh":205,"solar_kwh":0,"tariff_bdt_per_kwh":28},
      {"hour":19,"demand_kwh":215,"solar_kwh":0,"tariff_bdt_per_kwh":30},
      {"hour":20,"demand_kwh":205,"solar_kwh":0,"tariff_bdt_per_kwh":26},
      {"hour":21,"demand_kwh":175,"solar_kwh":0,"tariff_bdt_per_kwh":18},
      {"hour":22,"demand_kwh":135,"solar_kwh":0,"tariff_bdt_per_kwh":10},
      {"hour":23,"demand_kwh":105,"solar_kwh":0,"tariff_bdt_per_kwh":7}
    ],
    "battery": {
      "capacity_kwh": 220,
      "initial_energy_kwh": 110,
      "minimum_energy_kwh": 40,
      "max_charge_kwh_per_hour": 50,
      "max_discharge_kwh_per_hour": 50
    }
  }'
```

## Docker Build & Run

```bash
# Build the image
docker build -t gridwise-llm .

# Run the container
docker run -d \
  --name gridwise-llm \
  -p 8000:8000 \
  -e GEMINI_API_KEY="your-api-key-here" \
  -e GEMINI_MODEL="gemini-2.5-flash" \
  gridwise-llm

# Or use docker-compose
docker-compose up -d

# Test
curl http://localhost:8000/health
```

## Ambiguous Note Strategy & LLM Verification

### Two-Phase Verification Pipeline

1. **Phase 1 (Extraction)**: The LLM receives a detailed system prompt with few-shot examples for all 6 directive types. It uses JSON mode to output structured interpretations.

2. **Phase 2 (Verification)**:
   - **Check A (Syntactic)**: Validates array length, note_index ordering, applies/no_op consistency
   - **Check B (Semantic)**: Detects inverted solar factors (80% reduction → factor should be 0.2 not 0.8), empty hours, impossible values. If issues are found, a secondary LLM prompt self-corrects.
   - **Check C (Deterministic)**: Deduplicates hours, sorts ascending, clamps factor to [0,1], clamps reserves to battery bounds, clamps grid caps ≥ 0

### Key Edge Cases Handled
- **Solar factor inversion**: "80% reduction" → factor = 0.2 (remaining fraction)
- **Percentage reserves**: "50% of capacity" → computed as absolute kWh from battery spec
- **Time window convention**: "1 PM to 3 PM" → hours [13, 14] (start-inclusive, end-exclusive)
- **Distractor notes**: Menu changes, registration deadlines → no_op

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | Node.js 20+ / TypeScript (strict) |
| Framework | Express.js |
| LLM SDK | @google/genai (Gemini) |
| LP Solver | javascript-lp-solver |
| Validation | Zod v4 |
| Container | Multi-stage Docker |

## Project Structure

```
src/
├── app.ts                         # Express app assembly & middleware
├── server.ts                      # Server entry point & graceful shutdown
├── config/
│   └── config.ts                  # Zod-validated environment config
├── controllers/
│   ├── health.controller.ts       # GET /health
│   └── energy.controller.ts       # POST /optimize-energy orchestration
├── routes/
│   └── api.routes.ts              # Route declarations
├── schemas/
│   ├── request.schema.ts          # Zod schema for incoming request
│   ├── response.schema.ts         # Zod schema for outgoing response
│   └── directive.schema.ts        # Internal directive schemas
├── services/
│   ├── llm/
│   │   ├── llm.client.ts          # Unified Gemini client wrapper
│   │   ├── extractor.service.ts   # Phase 1: LLM structured extraction
│   │   └── verifier.service.ts    # Phase 2: LLM self-audit / critic
│   ├── guardrails/
│   │   ├── guardrail.service.ts   # Deterministic sanitization
│   │   └── validator.service.ts   # Schema & invariant validation
│   ├── optimizer/
│   │   ├── model.builder.ts       # LP model construction
│   │   └── lp.solver.ts           # LP execution & solution extraction
│   └── simulation/
│       ├── replay.service.ts      # Physical step-by-step replay
│       └── metrics.service.ts     # Summary metrics recalculation
├── types/
│   └── domain.types.ts            # Shared TypeScript interfaces
└── utils/
    ├── logger.ts                  # Structured JSON logging
    └── errors.ts                  # Domain error classes
```
