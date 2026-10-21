# Fair Fare Provider Recommendation Grounding

## Root cause

The assistant prompt referred to inDrive, Yango, and Bykea but did not make the supported-provider boundary explicit enough to prevent a model from adding familiar external brands such as Uber or Careem. In addition, comparison context could contain legacy labels such as `QuickRide` and `UrbanCab`, and the comparison-ID branch of the trip-aware assistant bypassed the quality-aware response path.

## Enforcement strategy

- `src/providers/provider.registry.js` is now the canonical public-name registry while preserving the existing IDs `indrive`, `quickride`, and `urbancab`.
- `src/services/providerRecommendationGuard.service.js` canonicalizes comparison labels, removes unknown providers from assistant grounding, rejects unsupported or generic ride-hailing recommendations, and returns a deterministic supported-only response when a generated answer violates the boundary.
- `src/services/qualityAwareAssistant.service.js` attaches the provider policy to the model grounding context and validates the final candidate response.
- `src/services/tripAwareAiAssistant.service.js` routes comparison-backed conversations through the same guarded quality-aware path.
- Existing model instructions remain applicable; the supplied grounding context now explicitly states the provider boundary. The server-side check is authoritative and does not depend on prompt compliance.

Unsupported providers may still be named when the user explicitly asks about them, but only to explain that Fair Fare does not compare or recommend them.

## Canonical mapping

| Internal ID | Public name |
|---|---|
| `indrive` | inDrive |
| `quickride` | Yango |
| `urbancab` | Bykea |

No provider IDs, fare-model keys, dataset modes, coverage approvals, or production flags were changed.

## Before and after

Before, a model response such as “If you have more budget, use Uber or Careem” could pass through when no deterministic fare rule replaced it.

After, the same response is replaced with a bounded response naming only Fair Fare-supported providers. Raw `QuickRide` and `UrbanCab` labels are presented as `Yango` and `Bykea`; they are not renamed internally.

## Verification

Passed in serial/single-process mode:

- Provider recommendation guard: 6/6.
- AI grounding, intent, quality, and fallback tests: 44/44 combined.
- Public trip-aware AI endpoint regression: 1/1.
- Fare, dataset, coverage approval, trip context, and extraction regression assertions passed in the combined run.
- Syntax checks passed for the changed provider registry, guard, quality-aware assistant, and trip-aware assistant.

The fare suite logs non-critical Windows `spawn EPERM` warnings from optional prediction work. Those warnings are pre-existing and did not fail the fare assertions.

## Limitations

- This is a server-side safety boundary, not proof of live provider availability. Fare outputs remain subject to the existing legacy dataset and coverage policy.
- The fallback response intentionally avoids ranking providers when authoritative comparable data is unavailable.
- No real model calls, production data, deployment, commit, or push were performed for this change.
