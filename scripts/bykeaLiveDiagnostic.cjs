#!/usr/bin/env node
// Deliberately requires an explicit flag. This script never prints secrets or
// raw response data; it is for one manually approved diagnostic request.
if (process.argv[2] !== "--confirm-live") {
  console.error("Refusing live request. Re-run with --confirm-live after explicit approval.");
  process.exitCode = 2;
  return;
}

require("dotenv").config({ path: ".env", quiet: true });
const { getConfig } = require("../src/providers/bykea/bykea.constants");
const { createBykeaHttpTransport, summarizeBykeaRequest } = require("../src/providers/bykea/bykea.client");
const { createBykeaRequestContract } = require("../src/providers/bykea/bykea.request-contract");
const { createBykeaProvider } = require("../src/providers/bykea.provider");
const { summarizeBykeaResponse } = require("../src/providers/bykea/bykea.mapper");

process.env.BYKEA_MODE = "authorized_live";
process.env.BYKEA_AUTHORIZED_LIVE = "true";
const config = getConfig(process.env);
const diagnostics = { httpStatus: null, contentType: null, jsonParsed: false, responseShape: null, requestContract: null };
if (!config.endpointContractConfigured || !config.mandatoryHeadersConfigured) {
  console.error(JSON.stringify({ stage: "configuration", error: config.configError || "incomplete Bykea configuration" }));
  process.exitCode = 1;
  return;
}

const requestContract = createBykeaRequestContract(config);

async function requestImpl(url, options) {
  diagnostics.requestContract = summarizeBykeaRequest(url, options);
  const response = await fetch(url, options);
  diagnostics.httpStatus = response.status;
  diagnostics.contentType = response.headers.get("content-type");
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
    diagnostics.jsonParsed = true;
    diagnostics.responseShape = summarizeBykeaResponse(body);
  } catch {
    diagnostics.responseShape = { stage: "non_json_response" };
  }
  return { ok: response.ok, status: response.status, async json() { if (!diagnostics.jsonParsed) throw new Error("non-json response"); return body; } };
}

const transport = createBykeaHttpTransport({ config, requestContract, requestImpl });
const provider = createBykeaProvider({ config, mode: "authorized-live", transport });
const started = Date.now();
provider.getFareEstimates({
  pickup: { latitude: 31.431384, longitude: 74.3484833 },
  destination: { latitude: 31.4640061, longitude: 74.4426299 },
}).then((result) => {
  console.log(JSON.stringify({
    elapsedMs: Date.now() - started,
    httpStatus: diagnostics.httpStatus,
    contentType: diagnostics.contentType,
    jsonParsed: diagnostics.jsonParsed,
    responseShape: diagnostics.responseShape,
    applicationError: diagnostics.responseShape?.applicationError || null,
    result: { status: result.status, errorCode: result.error?.code || null, estimateCount: result.estimates.length },
  }));
}).catch((error) => {
  console.log(JSON.stringify({ elapsedMs: Date.now() - started, ...diagnostics, result: { status: "script_error", errorCode: error.code || "UNKNOWN" } }));
  process.exitCode = 1;
});
