# Fair Fare AI knowledge source

`SHEET KNOWLEDGE SOURCE NOT FOUND` in the current repository. No `.xlsx`,
`.xls`, `.csv`, or Google-Sheets export containing Fair Fare knowledge was
found, so no spreadsheet facts are sent to third-party model providers.

The retrieval extension is `src/services/ai/fairFareKnowledge.service.js`.
When a reviewed, sanitized export is available, load entries with this shape:

```json
{
  "topic": "ETA",
  "question": "What is ETA?",
  "answer": "A concise verified explanation.",
  "keywords": "eta pickup time"
}
```

Only `topic`, `question`, and `answer` are sent to the model, with at most
three deterministic keyword matches. Do not include credentials, tokens,
passwords, account identifiers, or private provider data. Dynamic ride data,
preferences, history, and this static knowledge section remain separate in the
grounding payload.
