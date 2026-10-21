# Fair Fare AI Assistant V3 — Implementation and Real-Model Evaluation

Date: 2026-10-13

## Decision

**NO-GO for production; GO for controlled staging validation only.** The authenticated AI endpoint is working, V3 safety checks are passing, dataset mode remains `legacy`, and coverage approvals remain zero. Production still requires a real fallback canary, deployment review, and human-controlled coverage activation.

## Actual end-to-end flow

`POST /api/ai/chat` is registered once by `src/routes/tripAwareAi.routes.js`, protected by the existing authentication middleware, and handled by `src/controllers/tripAwareAi.controller.js`.

The controller calls `tripAwareAiAssistant.service.js`, which loads recent conversation messages, extracts and resolves explicit routes, builds server-owned structured trip context, and either returns a deterministic route/clarification response or calls `qualityAwareAssistant.service.js`. The quality layer supplies authoritative fare/comparison grounding to the existing LLM client. Groq never calculates provider fares. The existing bounded primary/fallback logic and response grounding remain in force.

Therefore an HTTP 200 is not automatically an LLM result. In the final run, 17 responses were deterministic backend responses and 23 used a real Groq response.

## V3 changes

- Added structured server-owned conversation context for confirmed pickup, destination, administrative context, location IDs/coordinates, route, vehicle preference, intent, and pending clarification.
- Preserved context for fare, cheapest, vehicle, weather-hypothetical, and comparison follow-ups; partial pickup/destination changes update only the requested endpoint.
- Added Roman Urdu/mixed-language intent and vehicle detection.
- Added safe no-comparison responses for fare and vehicle questions and verified mode with zero approved coverage.
- Kept Geoapify candidate scoring strict; unrelated POIs still fail closed.
- Fixed `I want to go to LGU from Gulberg III`: the `to … from …` extractor now removes the filler `go to` and extracts `destination=LGU`.
- Canonicalized `Lahore Garission University` to `Lahore Garrison University` without inventing coordinates.

## Real-model evaluation

Artifacts:

- `AI_MODEL_EVALUATION_V3_RAW.json` — baseline.
- `AI_MODEL_EVALUATION_V3_FINAL_RAW.json` — final 40-scenario run.
- `AI_MODEL_EVALUATION_V3_RETEST2_RAW.json` and `AI_MODEL_EVALUATION_V3_RETEST3_RAW.json` — targeted safety retests.
- `src/tests/realAiModelEvaluationV3.runner.cjs` — authenticated endpoint runner.

| Measure | Result |
|---|---:|
| Final scenarios | 40 |
| HTTP successes | 40/40 |
| Real Groq responses | 23 |
| Deterministic responses | 17 |
| Fallbacks in final run | 0 |
| Targeted retest HTTP successes | 10/10 |
| Coverage approvals | 0 |

The primary model observed was `openai/gpt-oss-120b`. No V3 scenario required fallback. Fallback behavior is covered by controlled failure-injection tests, but a small real fallback canary remains outstanding.

Representative responses include:

- Resolved route: `I found Gulberg 3 to Lahore Garrison University. The approximate map-based road route is 15 km and about 18 minutes. Fair Fare does not have a verified provider comparison for this message yet, so I will not invent a fare or availability.`
- No comparison, bike follow-up: `Fair Fare does not have a verified comparison for this route or vehicle yet, so I will not invent a fare.`
- Verified mode with zero coverage: the assistant refuses to recommend a provider until exact approved coverage exists.

## Safety and quality findings

The final run and targeted retests confirm that resolvable trips are acknowledged without unnecessary street-address requests; follow-ups retain the server-resolved route; unsupported fares, live quotes, driver availability, ETAs, weather, traffic, protests, closures, and guaranteed future prices are not fabricated; Roman Urdu safety/no-data replies are handled safely; and cross-city mismatches fail closed unless explicitly intercity.

Accepted limitations:

- Bare `Gulberg` remains ambiguous and may require `Gulberg 3, Lahore`.
- `Saddar` → `airport` remains city-ambiguous without context.
- Geoapify candidate availability varies; the resolver may ask one targeted clarification.
- Route distances/durations are approximate unless an authoritative comparison is supplied.
- No public provider comparison is available while legacy mode and zero approved coverage remain active.

## Regression results

Passed with supported Windows single-process execution:

- Trip context: 4/4.
- Trip extraction/resolution: 10/10.
- Public trip-aware endpoint: 1/1.
- AI grounding policy: 7/7.
- AI quality policy: 3/3.
- AI intent grounding: 13/13.
- Fallback/error classification: 15/15.
- Fare API: 13/13.
- Dataset/mode behavior: 8/8.
- Coverage approval: 8/8.
- Coverage evidence intake: 3/3.
- Coverage activation dry run: 4/4.
- Geoapify maps/routing: 16/16.

Fare tests emitted expected non-critical Windows `spawn EPERM` prediction warnings; assertions passed. No production data or environment variables were changed.

## Files changed for V3

`src/services/tripContext.service.js`, `src/services/tripAwareAiAssistant.service.js`, `src/services/tripExtraction.service.js`, `src/services/tripResolution.service.js`, `src/services/qualityAwareAssistant.service.js`, `src/tests/tripContext.test.js`, `src/tests/tripExtraction.test.js`, `src/tests/realAiModelEvaluationV3.runner.cjs`, and this report.

Earlier coverage, geocoding, mobile-route, and deployment-readiness changes remain in the working tree and were preserved. `D:\ride\mobile` and `D:\ride\frontend` were not modified.

## Recommendation and rollback

Controlled staging is acceptable with a dedicated test account, legacy mode, zero provider approvals, and monitoring of model ID, fallback, latency, route status, and grounding flags without logging secrets or message contents.

Production is **NO-GO** until the real fallback canary, deployment packaging/runtime review, and human coverage approvals are complete. Rollback is to restore the prior backend revision while retaining `FAIR_FARE_DATASET_MODE=legacy`; no coverage activation is needed to roll back.
