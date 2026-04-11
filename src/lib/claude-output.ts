interface ClaudeTextPart {
  type?: unknown;
  text?: unknown;
}

interface ClaudeAssistantMessage {
  content?: unknown;
}

interface ClaudeOutputRecord {
  type?: unknown;
  message?: ClaudeAssistantMessage;
  error?: unknown;
  is_error?: unknown;
  result?: unknown;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTextPart(value: unknown): ClaudeTextPart | null {
  if (!isObjectRecord(value)) {
    return null;
  }
  return {
    type: value["type"],
    text: value["text"],
  };
}

export function parseClaudeStreamOutput(stdout: string): {
  summaryText: string;
  errorText: string;
} {
  const lines = String(stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const textParts: string[] = [];
  const errors: string[] = [];

  for (const line of lines) {
    let payload: unknown;
    try {
      payload = JSON.parse(line);
    } catch {
      continue;
    }

    if (!isObjectRecord(payload)) {
      continue;
    }

    const record: ClaudeOutputRecord = payload;

    if (record.type === "assistant" && Array.isArray(record.message?.content)) {
      for (const item of record.message.content) {
        const part = parseTextPart(item);
        if (!part) {
          continue;
        }
        if (
          part.type === "text" &&
          typeof part.text === "string" &&
          part.text.trim()
        ) {
          textParts.push(part.text.trim());
        }
      }
      if (record.error) {
        errors.push(String(record.error));
      }
    }

    if (record.type === "result") {
      if (record.is_error && record.result) {
        errors.push(String(record.result));
      }
      continue;
    }

    if (record.error) {
      errors.push(String(record.error));
    }
  }

  return {
    summaryText: textParts.join("\n\n").trim(),
    errorText: errors.join("\n").trim(),
  };
}
