export type UnknownRecord = Record<string, unknown>;

function describeValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function expectRecord(value: unknown, label: string): UnknownRecord {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object, got ${describeValue(value)}`);
  }
  return value;
}

export function expectArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array, got ${describeValue(value)}`);
  }
  return value;
}

export function expectString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string, got ${describeValue(value)}`);
  }
  return value;
}

export function expectBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean, got ${describeValue(value)}`);
  }
  return value;
}

export function expectNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`${label} must be a number, got ${describeValue(value)}`);
  }
  return value;
}

export function expectOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  const text = expectString(value, label);
  for (const candidate of allowed) {
    if (candidate === text) {
      return candidate;
    }
  }
  throw new Error(`${label} must be one of ${allowed.join(", ")}, got ${text}`);
}

export function readField(record: UnknownRecord, key: string): unknown {
  return record[key];
}

export function readOptionalString(
  record: UnknownRecord,
  key: string,
  label: string,
): string | null {
  const value = readField(record, key);
  if (value === undefined || value === null) {
    return null;
  }
  return expectString(value, `${label}.${key}`);
}

export function readString(
  record: UnknownRecord,
  key: string,
  label: string,
): string {
  return expectString(readField(record, key), `${label}.${key}`);
}

export function readBoolean(
  record: UnknownRecord,
  key: string,
  label: string,
): boolean {
  return expectBoolean(readField(record, key), `${label}.${key}`);
}

export function readOptionalBoolean(
  record: UnknownRecord,
  key: string,
  label: string,
): boolean | null {
  const value = readField(record, key);
  if (value === undefined || value === null) {
    return null;
  }
  return expectBoolean(value, `${label}.${key}`);
}

export function readNumber(
  record: UnknownRecord,
  key: string,
  label: string,
): number {
  return expectNumber(readField(record, key), `${label}.${key}`);
}

export function readOptionalNumber(
  record: UnknownRecord,
  key: string,
  label: string,
): number | null {
  const value = readField(record, key);
  if (value === undefined || value === null) {
    return null;
  }
  return expectNumber(value, `${label}.${key}`);
}

export function readEnum<T extends string>(
  record: UnknownRecord,
  key: string,
  allowed: readonly T[],
  label: string,
): T {
  return expectOneOf(readField(record, key), allowed, `${label}.${key}`);
}

export function readArray<T>(
  record: UnknownRecord,
  key: string,
  label: string,
  parseItem: (value: unknown, index: number) => T,
): T[] {
  const value = expectArray(readField(record, key), `${label}.${key}`);
  return value.map((item, index) => parseItem(item, index));
}

export function readOptionalArray<T>(
  record: UnknownRecord,
  key: string,
  label: string,
  parseItem: (value: unknown, index: number) => T,
): T[] {
  const value = readField(record, key);
  if (value === undefined || value === null) {
    return [];
  }
  return expectArray(value, `${label}.${key}`).map((item, index) =>
    parseItem(item, index),
  );
}

export function readStringArray(
  record: UnknownRecord,
  key: string,
  label: string,
): string[] {
  return readArray(record, key, label, (value, index) =>
    expectString(value, `${label}.${key}[${String(index)}]`),
  );
}

export function readOptionalStringArray(
  record: UnknownRecord,
  key: string,
  label: string,
): string[] {
  return readOptionalArray(record, key, label, (value, index) =>
    expectString(value, `${label}.${key}[${String(index)}]`),
  );
}

export function readObject<T>(
  record: UnknownRecord,
  key: string,
  _label: string,
  parse: (value: unknown) => T,
): T {
  return parse(readField(record, key));
}

export function readOptionalObject<T>(
  record: UnknownRecord,
  key: string,
  _label: string,
  parse: (value: unknown) => T,
): T | null {
  const value = readField(record, key);
  if (value === undefined || value === null) {
    return null;
  }
  return parse(value);
}

export function parseStringRecord(
  value: unknown,
  label: string,
): Record<string, string> {
  const record = expectRecord(value, label);
  const parsed: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    parsed[key] = expectString(entry, `${label}.${key}`);
  }
  return parsed;
}

export function parseUnknownRecord(
  value: unknown,
  label: string,
): UnknownRecord {
  return expectRecord(value, label);
}
