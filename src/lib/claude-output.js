export function parseClaudeStreamOutput(stdout) {
  const lines = String(stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const textParts = [];
  const errors = [];

  for (const line of lines) {
    let payload;
    try {
      payload = JSON.parse(line);
    } catch {
      continue;
    }

    if (payload.type === "assistant" && Array.isArray(payload.message?.content)) {
      for (const part of payload.message.content) {
        if (part?.type === "text" && typeof part.text === "string" && part.text.trim()) {
          textParts.push(part.text.trim());
        }
      }
      if (payload.error) {
        errors.push(String(payload.error));
      }
    }

    if (payload.type === "result") {
      if (payload.is_error && payload.result) {
        errors.push(String(payload.result));
      }
      continue;
    }

    if (payload.error) {
      errors.push(String(payload.error));
    }
  }

  return {
    summaryText: textParts.join("\n\n").trim(),
    errorText: errors.join("\n").trim(),
  };
}
