export interface RequestExecutionControls {
  cleanedRequest: string;
  testScenario: "retry-once" | null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function parseRequestExecutionControls(
  request: string,
): RequestExecutionControls {
  const retryToken = /\[\[co:e2e-retry\]\]/giu;
  const hasRetryToken = retryToken.test(request);
  const cleanedRequest = normalizeWhitespace(request.replace(retryToken, " "));
  return {
    cleanedRequest,
    testScenario: hasRetryToken ? "retry-once" : null,
  };
}
