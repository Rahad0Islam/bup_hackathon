# GridWise LLM — Smart Campus Energy Optimization

**BUP CSE Fest 2026 Hackathon — Online Preliminary Round**

GridWise LLM is an LLM-assisted smart-campus energy optimization service. It interprets natural-language operator notes, converts them into validated energy directives, applies deterministic guardrails, solves a 24-hour linear-programming dispatch problem, replays the schedule against physical constraints, and returns a cost-minimized energy plan.

The service exposes:

- `GET /health`
- `POST /optimize-energy`

---

## Features

- Natural-language operator-note interpretation using Google Gemini
- Structured JSON directive extraction
- Semantic verification and self-correction
- Deterministic guardrails before optimization
- Zod request and directive validation
- 24-hour battery/grid/solar dispatch optimization
- Linear Programming using `javascript-lp-solver`
- Physical schedule replay and constraint validation
- Battery end-of-day neutrality
- Cost and energy metric recalculation
- Docker and Docker Compose support
- Non-root production container
- Container health checks
- Sanitized API error responses

---

## System Architecture

```text
                    POST /optimize-energy
                              |
                              v
                 +--------------------------+
                 | Zod Request Validation   |
                 | 24 hours, battery, notes |
                 +------------+-------------+
                              |
                              v
                 +--------------------------+
                 | Phase 1: Gemini LLM      |
                 | Structured extraction    |
                 +------------+-------------+
                              |
                              v
                 +--------------------------+
                 | Phase 2: Semantic Audit  |
                 | Verification and repair  |
                 +------------+-------------+
                              |
                              v
                 +--------------------------+
                 | Deterministic Guardrails |
                 | Normalize and clamp data |
                 +------------+-------------+
                              |
                              v
                 +--------------------------+
                 | Directive Validation     |
                 | Zod schemas and rules    |
                 +------------+-------------+
                              |
                              v
                 +--------------------------+
                 | LP Optimization          |
                 | Minimize grid cost       |
                 +------------+-------------+
                              |
                              v
                 +--------------------------+
                 | Physical Replay          |
                 | Validate every hour      |
                 +------------+-------------+
                              |
                              v
                 +--------------------------+
                 | Metrics and JSON Output  |
                 +--------------------------+
```

---

## Processing Pipeline

### 1. Request validation

The request is validated using Zod.

The service requires:

- A non-empty `scenario_id`
- Between 1 and 3 operator notes
- Exactly 24 unique hours from `0` through `23`
- Non-negative demand, solar, and tariff values
- Valid battery specifications
- Initial battery energy between the configured minimum and capacity

### 2. LLM structured extraction

Gemini receives the operator notes and battery specification. It returns exactly one structured interpretation for every note.

The LLM is part of the actual optimization path. It does not only generate documentation or a plan summary.

### 3. Semantic verification

The verification phase detects common interpretation mistakes, including:

- Confusing a reduction percentage with the remaining solar factor
- Empty or invalid hour ranges
- Invalid directive values
- Incorrect percentage-based battery reserves

When a semantic problem is detected, a secondary verification prompt is used to correct the interpretation.

### 4. Deterministic guardrails

Before any directive reaches the optimizer, the service:

- Removes duplicate hours
- Sorts directive hours
- Restricts hours to `0–23`
- Clamps solar factors to `0–1`
- Clamps battery reserves to valid battery limits
- Clamps grid limits to non-negative values
- Enforces `applies` and `no_op` consistency
- Rejects unsupported directive structures

### 5. Linear Programming optimization

The optimizer minimizes total grid electricity cost while enforcing:

- Hourly energy balance
- Solar availability
- Battery capacity
- Battery minimum energy
- Charge and discharge rate limits
- Directive-specific windows
- Grid import limits
- End-of-day battery neutrality

### 6. Physical replay

The returned plan is independently replayed hour by hour. The replay checks battery transitions, energy balance, directive limits, and non-negative values.

### 7. Metrics recalculation

The final metrics are recalculated from the hourly plan:

- `total_grid_kwh`
- `total_cost_bdt`
- `peak_grid_kwh`

The hourly plan is the source of truth.

---

## Supported Directives

The service supports six directive types.

| Directive | Purpose | Structured adjustment |
|---|---|---|
| `solar_reduction` | Reduce usable solar during selected hours | `hours`, `factor` |
| `minimum_battery_reserve` | Maintain a minimum battery level | `hours`, `minimum_energy_kwh` |
| `no_charge_window` | Prevent battery charging | `hours` |
| `no_discharge_window` | Prevent battery discharging | `hours` |
| `max_grid_window` | Limit grid imports | `hours`, `max_grid_kwh` |
| `no_op` | Ignore an irrelevant note | `null` |

### Interpretation rules

- Every operator note produces exactly one interpretation.
- Interpretations are returned in `note_index` order.
- `no_op` must use:
  - `applies: false`
  - `structured_adjustment: null`
- Every applicable directive must use:
  - `applies: true`
- Hours are unique integers from `0` through `23`.
- Hours are sorted in ascending order.
- Time windows are start-inclusive and end-exclusive.
- `1 PM to 3 PM` means `[13, 14]`.
- `noon until 2 PM` means `[12, 13]`.
- For `solar_reduction`, `factor` means the usable fraction remaining.
- An 80% reduction means `factor: 0.2`.
- A note about an unrelated future event should be classified as `no_op`.

---

## API Endpoints

### `GET /health`

Returns the service readiness status.

#### Request

```bash
curl http://localhost:8000/health
```

#### Response

```json
{
  "status": "ok"
}
```

---

### `POST /optimize-energy`

Interprets operator notes and returns an optimized 24-hour energy schedule.

#### Required request fields

```json
{
  "scenario_id": "string",
  "operator_notes": ["string"],
  "hours": [],
  "battery": {}
}
```

#### Hour object

```json
{
  "hour": 0,
  "demand_kwh": 90,
  "solar_kwh": 0,
  "tariff_bdt_per_kwh": 6
}
```

#### Battery object

```json
{
  "capacity_kwh": 220,
  "initial_energy_kwh": 110,
  "minimum_energy_kwh": 40,
  "max_charge_kwh_per_hour": 50,
  "max_discharge_kwh_per_hour": 50
}
```

#### Response fields

```json
{
  "scenario_id": "SAMPLE-01",
  "directive_interpretation": [],
  "hourly_plan": [],
  "total_grid_kwh": 0,
  "total_cost_bdt": 0,
  "peak_grid_kwh": 0,
  "plan_summary": "string"
}
```

#### Directive interpretation object

```json
{
  "note_index": 0,
  "applies": true,
  "directive_type": "solar_reduction",
  "structured_adjustment": {
    "hours": [12, 13],
    "factor": 0.25
  },
  "explanation": "Solar availability is reduced during the maintenance window."
}
```

#### Hourly plan object

```json
{
  "hour": 0,
  "grid_kwh": 90,
  "solar_used_kwh": 0,
  "battery_action": "idle",
  "battery_kwh": 0,
  "battery_energy_after_kwh": 110
}
```

Allowed `battery_action` values:

- `charge`
- `discharge`
- `idle`

---

## Energy Constraints

Every valid response must satisfy the following rules.

### Energy balance

For every hour:

```text
grid_kwh + solar_used_kwh + battery_discharge_kwh
=
demand_kwh + battery_charge_kwh
```

### Solar availability

Solar usage must not exceed the effective solar availability after applying any `solar_reduction` directive.

### Battery bounds

Battery energy must remain within:

```text
active minimum reserve <= battery energy <= battery capacity
```

### Charge and discharge rates

Battery charge and discharge must not exceed their configured hourly limits.

### Directive windows

- `no_charge_window` forces charging to zero.
- `no_discharge_window` forces discharging to zero.
- `minimum_battery_reserve` raises the minimum battery energy.
- `max_grid_window` caps grid imports.
- `solar_reduction` reduces available solar.

### End-of-day neutrality

At the end of hour `23`:

```text
battery_energy_after_kwh = initial_energy_kwh
```

This prevents the optimizer from using the initial battery energy as a free one-time source.

### Numeric tolerance

Energy and cost comparisons use an absolute tolerance of approximately:

```text
0.01 kWh
0.01 BDT
```

---

## Technology Stack

| Component | Technology |
|---|---|
| Runtime | Node.js 20+ |
| Language | TypeScript |
| Web framework | Express 5 |
| LLM provider | Google Gemini |
| LLM SDK | `@google/genai` |
| Validation | Zod 4 |
| Optimizer | `javascript-lp-solver` |
| Bundler | tsup |
| Container | Docker / Docker Compose |
| API testing | curl / Postman |

---

## Environment Variables

Create a `.env` file locally.

```env
PORT=8000
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-2.5-flash
LLM_PROVIDER=gemini
NODE_ENV=development
```

| Variable | Required | Default | Description |
|---|---:|---|---|
| `PORT` | No | `8000` | HTTP server port |
| `GEMINI_API_KEY` | Yes | — | Google Gemini API key |
| `GEMINI_MODEL` | No | `gemini-2.5-flash` | Gemini model identifier |
| `LLM_PROVIDER` | No | `gemini` | Configured LLM provider |
| `NODE_ENV` | No | `development` | Runtime environment |

The current implementation uses Gemini for LLM calls. A provider abstraction is represented in configuration, but an OpenAI implementation is not currently enabled.

Never commit:

- `.env`
- API keys
- Tokens
- Passwords
- Private deployment credentials

---

## Local Development

### Prerequisites

- Node.js 20 or newer
- npm
- A valid Gemini API key

### Install dependencies

```bash
npm install
```

### Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set:

```env
GEMINI_API_KEY=your-gemini-api-key
```

### Start development server

```bash
npm run dev
```

The server starts on:

```text
http://localhost:8000
```

### Test health

```bash
curl http://localhost:8000/health
```

Expected response:

```json
{"status":"ok"}
```

### Build the application

```bash
npm run build
```

### Start the compiled application

```bash
npm start
```

---

## Public Sample Cases

The repository contains ten public sample cases:

```text
guide-line-pdf/BUP_CSE_FEST_2026_Preli_Public_Sample_Cases.json
```

The public cases include:

- Input scenarios
- Operator notes
- Expected directive interpretations
- Reference schedules
- Constraint reminders

Public cases are references only. They must not be hard-coded because hidden tests may use paraphrased notes and different numeric scenarios.

### Run all public samples

Start the service first:

```bash
npm run dev
```

In another terminal, run:

```bash
jq -c '.cases[].input' \
  guide-line-pdf/BUP_CSE_FEST_2026_Preli_Public_Sample_Cases.json |
while read -r scenario; do
  curl -sS \
    -X POST http://localhost:8000/optimize-energy \
    -H "Content-Type: application/json" \
    -d "$scenario"
  printf "\n"
done
```

If `jq` is not installed:

```bash
sudo apt-get update
sudo apt-get install -y jq
```

### Validate one public case

```bash
jq -c '.cases[] | select(.id == "SAMPLE-01") | .input' \
  guide-line-pdf/BUP_CSE_FEST_2026_Preli_Public_Sample_Cases.json |
curl -sS \
  -X POST http://localhost:8000/optimize-energy \
  -H "Content-Type: application/json" \
  -d @-
```

A successful response should contain:

- The same `scenario_id`
- One directive interpretation per operator note
- A 24-entry `hourly_plan`
- Recalculated grid and cost metrics
- A `plan_summary`

Equivalent optimal schedules are valid; the hourly sequence does not need to match the public reference byte-for-byte.

---

## Postman

The repository includes a Postman collection:

```text
BUP_CSE_Fest_2026_GridWise_LLM.postman_collection.json
```

Import it into Postman.

It contains:

- `Health Check`
- `Optimize Energy (SAMPLE-01)`

The default base URL is:

```text
http://localhost:8000
```

---

## Docker

### Docker prerequisites

- Docker Desktop or Docker Engine
- Docker Compose plugin
- A valid Gemini API key

### Build the image

```bash
docker build -t gridwise-llm:latest .
```

The Dockerfile uses a multi-stage build:

1. Installs development dependencies and compiles TypeScript.
2. Installs production dependencies only.
3. Copies the compiled `dist` output.
4. Runs the application as a non-root user.
5. Exposes port `8000`.
6. Performs a container health check.

### Run with Docker

Create `.env` in the project root:

```env
PORT=8000
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-2.5-flash
LLM_PROVIDER=gemini
NODE_ENV=production
```

Start the container:

```bash
docker run -d \
  --name gridwise-llm \
  --env-file .env \
  -p 8000:8000 \
  gridwise-llm:latest
```

Test the service:

```bash
curl http://localhost:8000/health
```

View logs:

```bash
docker logs -f gridwise-llm
```

Check health status:

```bash
docker inspect \
  --format='{{.State.Health.Status}}' \
  gridwise-llm
```

Expected result after startup:

```text
healthy
```

Stop and remove the container:

```bash
docker rm -f gridwise-llm
```

### Docker Compose

Start the service:

```bash
docker compose up --build -d
```

Check status:

```bash
docker compose ps
```

View logs:

```bash
docker compose logs -f gridwise
```

Test readiness:

```bash
curl http://localhost:8000/health
```

Stop the service:

```bash
docker compose down
```

Rebuild after changes:

```bash
docker compose down
docker compose up --build -d
```

### Container name conflict

If Docker reports that `gridwise-llm` already exists:

```bash
docker rm -f gridwise-llm
docker compose up --build -d
```

This can happen when a container was previously started with `docker run`. Compose cannot reuse the same container name until the old container is removed.

### Verify runtime secret injection

Do not print the actual key. Check only whether it exists:

```bash
docker compose exec gridwise sh -c \
  'test -n "$GEMINI_API_KEY" && echo "GEMINI_API_KEY is loaded" || echo "GEMINI_API_KEY is missing"'
```

Changing `.env` does not update an existing container. Recreate the container after environment changes:

```bash
docker compose down
docker compose up -d
```

The API key is injected at runtime and is not baked into the Docker image.

---

## Docker Fallback Image

For a public fallback deployment, publish the image to Docker Hub or GitHub Container Registry using an exact immutable tag.

Example image name:

```text
docker.io/YOUR_DOCKERHUB_USERNAME/gridwise-llm:2026.09.18
```

Build:

```bash
docker build \
  -t YOUR_DOCKERHUB_USERNAME/gridwise-llm:2026.09.18 .
```

Authenticate:

```bash
docker login
```

Push:

```bash
docker push YOUR_DOCKERHUB_USERNAME/gridwise-llm:2026.09.18
```

Pull:

```bash
docker pull YOUR_DOCKERHUB_USERNAME/gridwise-llm:2026.09.18
```

Run:

```bash
docker run -d \
  --name gridwise-llm \
  --env-file .env \
  -p 8000:8000 \
  YOUR_DOCKERHUB_USERNAME/gridwise-llm:2026.09.18
```

Test:

```bash
curl http://localhost:8000/health
```

The image must be published without secrets. The API key must always be supplied at runtime.

---

## Docker Security

The production image:

- Uses `node:20-alpine`
- Runs as a non-root user
- Does not copy `.env`
- Does not bake API keys into the image
- Exposes only the application port
- Includes a health check
- Sanitizes production error responses

Recommended `.dockerignore`:

```text
node_modules
dist
.git
.env
.env.*
!.env.example
*.log
.vscode
.DS_Store
```

Never use this in a public README or Docker image:

```bash
-e GEMINI_API_KEY="real-secret-value"
```

Use `.env`, Docker secrets, or the deployment platform's secret manager instead.

---

## Project Structure

```text
.
├── Dockerfile
├── docker-compose.yml
├── package.json
├── package-lock.json
├── README.md
├── tsconfig.json
├── tsup.config.ts
├── vercel.json
├── BUP_CSE_Fest_2026_GridWise_LLM.postman_collection.json
├── guide-line-pdf/
│   ├── BUP_CSE_FEST_2026_Preli_Public_Sample_Cases.json
│   ├── BUP_CSE_FEST_2026_Participant_Guide_&_Evaluation_Rubric_GridWise_LLM.pdf
│   └── BUP_CSE_FEST_2026_Preliminary_Problem_Statement_GridWise_LLM.pdf
└── src/
    ├── app.ts
    ├── server.ts
    ├── config/
    │   └── config.ts
    ├── controllers/
    │   ├── energy.controller.ts
    │   └── health.controller.ts
    ├── middleware/
    │   ├── globalErrorHandler.ts
    │   ├── notFound.ts
    │   └── validateRequest.ts
    ├── modules/
    │   └── test_module/
    ├── routes/
    │   └── api.routes.ts
    ├── schemas/
    │   ├── directive.schema.ts
    │   ├── request.schema.ts
    │   └── response.schema.ts
    ├── services/
    │   ├── guardrails/
    │   ├── llm/
    │   ├── optimizer/
    │   └── simulation/
    ├── types/
    │   └── domain.types.ts
    └── utils/
        ├── appError.ts
        ├── catchAsync.ts
        ├── errors.ts
        ├── logger.ts
        └── sendResponse.ts
```

---

## Important Source Files

| File | Responsibility |
|---|---|
| `app.ts` | Express application setup |
| `server.ts` | HTTP server startup and graceful shutdown |
| `config.ts` | Environment validation |
| `energy.controller.ts` | Main optimization orchestration |
| `health.controller.ts` | Health endpoint |
| `request.schema.ts` | Request validation |
| `response.schema.ts` | Response validation |
| `directive.schema.ts` | Directive validation |
| `llm.client.ts` | Gemini client wrapper |
| `extractor.service.ts` | Structured directive extraction |
| `verifier.service.ts` | Semantic verification |
| `guardrail.service.ts` | Deterministic sanitization |
| `validator.service.ts` | Directive validation |
| `model.builder.ts` | LP model construction |
| `lp.solver.ts` | LP execution |
| `replay.service.ts` | Physical plan validation |
| `metrics.service.ts` | Metric recalculation |

---

## NPM Scripts

| Command | Description |
|---|---|
| `npm install` | Install dependencies |
| `npm run dev` | Start development server with watch mode |
| `npm run build` | Build the production bundle |
| `npm start` | Start the compiled production server |
| `npm run generate` | Generate a module using the repository script |

---

## Error Handling

The service returns controlled JSON errors for:

- Invalid request bodies
- Missing required fields
- Invalid hour ranges
- Invalid battery values
- Malformed LLM JSON
- LLM provider failures
- Invalid directive structures
- Unsupported routes

In production, internal stack traces and sensitive implementation details are not returned to clients.

---

## Performance and Reliability Requirements

The implementation is designed for the competition requirements:

- `GET /health` must become ready within 60 seconds.
- `POST /optimize-energy` should complete within 30 seconds.
- The service should remain stable across repeated valid requests.
- Invalid input must produce a controlled error.
- LLM output must be validated before optimization.
- The service must not expose API keys or sensitive stack traces.
- The final plan must satisfy energy and battery constraints before cost quality is considered.

Hosted-model availability, quota, rate limits, and API cost remain deployment responsibilities.

---

## Team LifeLink

| Name | Role |
|---|---|
| Autanu Datta | Leader |
| Md. Rahad Islam | Member |
| Taposh Kumar Ghosh | Member |
| Dipongkar Barmon | Member |

## License

This project was developed for the **BUP CSE Fest 2026 Hackathon Online Preliminary Round** by Team **LifeLink**.
```
