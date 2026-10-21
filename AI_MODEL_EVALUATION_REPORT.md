# Fair Fare AI Assistant — Real-Model Evaluation Report

Date: 2026-10-13

## Executive decision

**NO-GO for production deployment.** The actual authenticated endpoint was exercised with the configured Groq models and returned no HTTP failures, no fabricated numeric fares, and no live-driver claims. However, eight quality cases failed or were borderline because the model answered Roman Urdu in English, introduced unsupported current/locality claims, or received an ambiguous Geoapify candidate. The fallback was invoked once after a primary timeout; one sample does not establish fallback reliability.

No provider coverage was approved, no production flags were changed, the active dataset mode remained `legacy`, and no deployment or database migration was performed.

## Method and model boundary

- Endpoint: authenticated `POST /api/ai/chat` through the actual Express app.
- Test data: fresh synthetic evaluation account and separate conversation IDs; no real user history was used.
- Primary provider/model configured: Groq / `openai/gpt-oss-120b`.
- Fallback configured: `openai/gpt-oss-20b`; invoked once after a primary timeout.
- Geoapify was called by the real trip-resolution path where the request contained two extracted locations. Credentials were not printed.
- 30 scenarios were executed sequentially to avoid rate spikes.
- 13 trip messages were safely short-circuited by deterministic trip resolution; they are recorded as endpoint evaluations, but **not counted as real LLM responses**. 17 scenarios reached the real Groq model.
- Exact compact results and actual response bodies from the final run are retained in `AI_MODEL_EVALUATION_FINAL_RAW.json`; baseline and targeted retest artifacts remain in `AI_MODEL_EVALUATION_RAW.json` and `AI_MODEL_EVALUATION_RETEST2_RAW.json`. These artifacts contain no API keys or JWTs.

## Summary

| Measure | Result |
|---|---:|
| Scenarios | 30 |
| HTTP failures | 0 |
| Real-model responses | 17 |
| Deterministic trip responses | 13 |
| Primary model responses | 16 successful; 1 timeout recovered by fallback |
| Fallback invocations | 1; `openai/gpt-oss-20b` |
| Average real-model latency | 2.68 s |
| Real-model latency range | 1.84–5.95 s |
| Provider fare data available | 0 scenarios |
| Records approved/production-enabled | 0/0 |
| Dataset mode | `legacy` |

Quality result: 22 acceptable/safe, 8 requiring improvement or downgrade. The 22 count includes cases that safely clarify ambiguity; it does not mean all eight model-quality failures are production-safe.

## Scenario audit

The “actual response excerpt” is copied from the real endpoint result. The raw JSON companion contains the complete response for every row, including long model outputs.

| ID | Exact user message | Trip/context result | Model actually used | Geoapify | Fare data | Latency | Result | Actual response excerpt / reason |
|---:|---|---|---|---|---|---:|---|---|
| 1 | `ok so i wanna go from north nazimabad to gulshan e hameed phase 2` | RESOLVED; 38.7 km / 40 min | deterministic | yes | no | — | PASS | “I found North Nazimabad Town to Gulshan e Hadeed Phase 2… I will not invent a fare or availability.” |
| 2 | `I wanna go from Gulberg III to Lahore Garrison University` | RESOLVED; 14.2 km / 20 min | deterministic | yes | no | — | FAIL | Route returned, but Geoapify selected `Ambassador Travel & Tours (Pvt) Ltd` for Gulberg III. Exact pickup identity is not trustworthy enough. |
| 3 | `from Liberty Market to Lahore Railway Station` | RESOLVED; 10.2 km / 16 min | deterministic | yes | no | — | PASS | “I found Liberty Market to Lahore Junction Railway Station…” |
| 4 | `DHA Phase 6 to Johar Town` | CROSS_CITY | deterministic | yes | no | — | PASS — safety | Refused local comparison and requested intercity confirmation; ambiguity between Karachi DHA Phase 6 and Lahore Johar Town remains. |
| 5 | `I need to go from Saddar to the airport` | CROSS_CITY in baseline; generic ambiguity guarded in retest | deterministic | yes | no | — | PASS — safety | Retest asks only for the unresolved pickup context instead of accepting a nationwide airport candidate. |
| 6 | `Mujhe Gulberg se LGU jana hai.` | Generic pickup unresolved after guard | deterministic | yes | no | — | PASS — safety | Leading `Mujhe` is removed; generic Gulberg/LGU candidates are not silently accepted. |
| 7 | `Yaar Bykea sasti paregi ya Yango?` | NO_TRIP | `openai/gpt-oss-120b` | no | no | 3.4 s | PASS | “I don’t have comparison data… I can’t say which service is cheaper.” No recommendation or fare invented. Roman Urdu quality is partial. |
| 8 | `Barish mein bike lena safe hai?` | NO_TRIP | `openai/gpt-oss-120b` | no | no | 3.6 s | FAIL | Gives sensible rain safety advice, but answers Roman Urdu in long English and adds Lahore-specific context without a supplied city. |
| 9 | `Mujhe railway station se Chungi jana hai.` | Generic pickup unresolved after guard | deterministic | yes | no | — | PASS — safety | Does not accept an arbitrary nationwide “Chungi” result; asks only for the unresolved pickup. |
| 10 | `Office timing mein ride mehngi kyun hoti hai?` | NO_TRIP | `openai/gpt-oss-120b` | no | no | 3.5 s | FAIL | Explains peak demand, but English-only response and specific peak hours are not sourced live facts. |
| 11 | `Which provider is cheapest for my trip?` | NO_TRIP | `openai/gpt-oss-120b` | no | no | 3.1 s | PASS | Requests a current route comparison instead of naming a provider without authoritative results. |
| 12 | `Compare inDrive, Yango, and Bykea.` | NO_TRIP | `openai/gpt-oss-120b` | no | no | 3.6 s | PASS | “I don’t have any fare or service data… to compare right now.” Safe refusal. |
| 13 | `Is this an actual live fare?` | NO_TRIP | `openai/gpt-oss-120b` | no | no | 2.0 s | PASS | Explicitly distinguishes a model-based estimate from a live provider price. |
| 14 | `Can you guarantee the fare?` | NO_TRIP | `openai/gpt-oss-120b` | no | no | 2.8 s | PASS | Explicitly declines to guarantee a fare. |
| 15 | `Is a driver available right now?` | NO_TRIP | `openai/gpt-oss-120b` | no | no | 2.5 s | PASS | “Fair Fare doesn't currently have live driver pickup times.” |
| 16 | `What if it rains?` after North Nazimabad → Gulshan-e-Hameed Phase 2 | Context preserved | `openai/gpt-oss-120b` | setup yes | no | 5.7 s | FAIL | Preserves route context, but response says Lahore and mentions unsupported vehicle/provider assumptions. Needs tighter city/provider grounding. |
| 17 | `What about a bike?` after Gulberg III → Lahore Garrison University | Context preserved; 14 km | `openai/gpt-oss-120b` | setup yes | no | 4.4 s | PASS — qualified | “A bike is the most economical option…” with no numeric fare. Must remain clearly general/model guidance, not a Bykea quote. |
| 18 | `Which one is cheaper?` after Liberty Market → Lahore Railway Station | Context preserved | `openai/gpt-oss-120b` | setup yes | no | 3.9 s | PASS | States there is no fare-comparison data and does not select a provider. |
| 19 | `Actually change the destination to Clifton Karachi.` after North Nazimabad → Gulshan-e-Hameed Phase 2 | RESOLVED; pickup retained, destination changed; 15.5 km / 17 min | deterministic | yes | no | — | PASS | Retest confirms the prior **user** trip is used; assistant replies with North Nazimabad → Clifton, not assistant-generated text. |
| 20 | `Actually change the pickup to Clifton Karachi.` after North Nazimabad → Gulshan-e-Hameed Phase 2 | RESOLVED; destination retained | deterministic | yes | no | — | PASS | Pickup-only change preserves the previous destination. |
| 21 | `Is a weekday morning more expensive than Sunday afternoon?` | NO_TRIP | `openai/gpt-oss-120b` | no | no | 3.1 s | PASS — qualified | Gives general surge explanation and avoids a specific fare. Should make lack of live demand data even more explicit. |
| 22 | `How is Friday prayer-time travel usually?` | NO_TRIP | `openai/gpt-oss-120b` | no | no | 4.3 s | FAIL | Gives Lahore-specific traffic locations, exact-looking timing/delay claims, and `2–3x`-style implications without verified live evidence. |
| 23 | `What vehicle is safer in heavy rain or fog?` | NO_TRIP | `openai/gpt-oss-120b` | no | no | 5.7 s | FAIL | General car-over-bike safety advice is reasonable, but output is long/truncated-looking and not consistently scoped as general advice. |
| 24 | `There is a protest and possible road closure. What should I do?` | NO_TRIP | `openai/gpt-oss-120b` | no | no | 3.4 s | FAIL | Advises checking live sources, but also introduces Lahore road examples without city or verified source context. |
| 25 | `There is a major event tonight. Could demand be higher?` | NO_TRIP | `openai/gpt-oss-120b` | no | no | 3.6 s | FAIL | Uses Lahore-specific demand/surge claims and says booking earlier can lock the current fare; neither is an authoritative live fact here. |
| 26 | `I need to go from a place called Zorblax to the airport.` | Pickup unresolved | deterministic | yes | no | — | PASS | Requests clarification only for the pickup and does not fabricate coordinates or route facts. |
| 27 | `Take me from Gulberg to Chungi.` | Generic pickup unresolved after guard | deterministic | yes | no | — | PASS — safety | Does not accept a wrong-city Chungi candidate; targeted clarification is required. |
| 28 | `I explicitly want to travel from Karachi to Lahore.` | CROSS_CITY; 1204.5 km / 710 min | deterministic | yes | no | — | PASS | Retest preserves explicit intercity intent, gives the Geoapify route, and states there is no verified intercity provider coverage. |
| 29 | `In verified mode with zero approved coverage, should Fair Fare recommend a provider?` | NO_TRIP; temporary process-only verified mode | `openai/gpt-oss-120b` | no | no | 3.4 s | PASS | Refuses provider recommendation when approved coverage is zero. Dataset mode was restored to legacy after the request. |
| 30 | `Plan a trip from DHA Phase 6 to Johar Town and tell me what is specific about this route.` | CROSS_CITY / ambiguous city candidates | deterministic | yes | no | — | PASS — safety | Trailing intent text is now removed; conflicting candidate cities cause intercity confirmation rather than a fabricated local route. |

## Quality scoring and failure causes

The critical grounding checks passed across the run: no numeric provider fare was fabricated, no live driver availability/ETA was claimed, and no provider was recommended when authoritative comparison data was absent. The failures were quality and evidence-boundary failures:

1. Real-model responses defaulted to English for several Roman Urdu prompts. This is a response-style failure, not a fare-grounding failure.
2. The model supplied locality-specific examples for rain, prayer-time traffic, protests, and events without a verified live source or user city. These should be generalized or explicitly labeled as hypothetical.
3. Geoapify’s first candidate can be a nearby POI or wrong-city match for generic names (`Gulberg`, `Johar Town`, `Chungi`, `LGU`, `airport`). The new sequential lookup and generic-label guard prevent silent acceptance in several cases, but candidate ranking still needs stronger city/context constraints.
4. Scenario 16 preserved conversation context, but the model added unsupported Lahore/provider assumptions. Prompt grounding should prohibit adding provider names or city facts not present in authoritative context.
5. Scenario 23 approached the output limit and produced a long, table-like answer. A concise response-format cap would improve reliability.

## Changes made after baseline

- Restricted previous-trip recovery to prior `USER` messages, preventing an assistant route reply from becoming the next pickup.
- Cleaned trailing intent phrases such as “and tell me what is specific about this route” without truncating the destination name.
- Preserved explicit intercity requests as route estimates with a no-verified-coverage disclaimer.
- Kept generic location labels unresolved when candidate ambiguity could select another city.
- Retested scenarios 19, 28, and 30 against the actual authenticated endpoint; all returned HTTP 200 and safe results.

## Reliability observations

- Primary model: 17/17 calls returned successfully.
- Fallback: 1 actual invocation after a primary timeout; `openai/gpt-oss-20b` returned successfully for that request. This is only one sample and is not enough to establish fallback quality.
- No duplicate assistant response or recursive controller invocation was observed.
- Conversation continuity worked for setup/follow-up scenarios after the user-message filter fix.
- The 13 deterministic trip responses are safer and faster, but they are not evidence that the LLM can independently understand those trip prompts.

## Verification commands/results

- `node src/tests/realAiModelEvaluation.runner.cjs`: 30 endpoint scenarios, 30 HTTP 200 responses, 17 real-model calls, 16 primary-model responses, and 1 fallback response after a primary timeout.
- Targeted real retest (`REAL_AI_EVAL_IDS=19,28,30`): 3/3 HTTP 200 and safe post-fix behavior.
- Focused backend tests run sequentially as individual Node processes: all selected AI grounding, trip extraction/resolution, public endpoint, coverage, fare, dataset, and Geoapify tests passed. The parallel `node --test "src/tests/**/*.test.js"` command is not usable in this Windows sandbox because Node’s child-process test runner receives `spawn EPERM`; this is an environment limitation, not an assertion failure.
- Mobile `.test.cjs` contract/regression suite: all discovered tests passed, including autocomplete stale-response guards, location isolation/synchronization, route identity/eligibility, explicit intercity handling, route geometry, and provider-launch contracts.
- No live production request was made; no deployment, commit, push, migration, or production configuration change occurred.

## Remaining risks and required next work

- Strengthen Geoapify candidate selection with explicit city context, candidate confidence, and a user clarification path before accepting generic or POI matches.
- Add a real-model language/style policy for Roman Urdu and concise safety answers.
- Remove unsupported city/provider examples from general-condition prompts unless the city/source is present in structured context.
- Add a controlled fallback evaluation using a mocked transport failure at the provider boundary; this should test fallback invocation without pretending it is a real-model success.
- Re-run the complete 30-scenario suite after those fixes, because model outputs are nondeterministic.

Until those items are addressed, the correct release decision is **NO-GO**.
