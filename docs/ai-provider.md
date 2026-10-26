# Fair Fare AI provider policy

Verified 2026-10-06 against the official Groq documentation:

Sources: [Groq rate limits](https://console.groq.com/docs/rate-limits),
[supported models](https://console.groq.com/docs/models), [chat API reference](https://console.groq.com/docs/api-reference),
and [data controls](https://console.groq.com/docs/your-data).

- Primary: `groq` / `openai/gpt-oss-120b`
- Same-provider fallback: `groq` / `openai/gpt-oss-20b`
- Secondary provider: opt-in xAI Grok model chain
- Groq endpoint: `https://api.groq.com/openai/v1/chat/completions`
- Groq free-plan base limits for both GPT-OSS models: 30 RPM, 1,000 RPD,
  8,000 TPM, and 200,000 TPD. These are documented base limits, not a
  permanent guarantee; the account limits page is authoritative.
- Groq supports `reasoning_effort=low|medium|high` for both models. Fair Fare
  uses `low` by default and requests hidden reasoning.

The backend reads `GROQ_API_KEY` only. It is never exposed to the mobile app,
`EXPO_PUBLIC_*`, source literals, tests, or logs. On a Groq 429, the adapter
uses `Retry-After` when present for an in-memory model cooldown, then proceeds
to the next eligible provider without holding the user's request for a full
rate window. If every eligible provider fails, the existing `UNAVAILABLE`
contract is preserved.

Grounding remains bounded and owner-scoped. The assistant must treat current
comparison data as authoritative, must not invent fares/ETAs/availability, and
must return the decision first in a concise response.
