/**
 * Feature-ID parsing shared by migrations, feature discovery, and hooks.
 *
 * `FEAT-###` is the current canonical format. `FEAT-FP-###` is retained as a
 * legacy input format because older Plan Feature agents emitted those IDs and
 * existing projects must keep their stable identifiers during migration.
 */
const FEATURE_ID_RE = /^FEAT-(?:FP-)?\d+$/i;
const FEATURE_DIR_RE = /^(FEAT-(?:FP-)?(\d+))-(.+)$/i;

export interface ParsedFeatureDirectory {
  id: string;
  number: number;
  name: string;
}

/** Normalize a full supported ID, or the CLI's numeric shorthand. */
export function normalizeFeatureId(value: string): string | undefined {
  if (FEATURE_ID_RE.test(value)) return value.toUpperCase();
  if (/^\d+$/.test(value)) return `FEAT-${value.padStart(3, "0")}`;
  return undefined;
}

/** Extract a supported ID from the `**ID**:` field of a feature spec. */
export function extractFeatureId(content: string): string | undefined {
  const match = /\*\*ID\*\*:\s*(FEAT-(?:FP-)?\d+)\b/i.exec(content);
  return match?.[1]?.toUpperCase();
}

/** Parse an ID-prefixed feature directory into its stable ID and name. */
export function parseFeatureDirectory(entry: string): ParsedFeatureDirectory | undefined {
  const match = FEATURE_DIR_RE.exec(entry);
  if (!match) return undefined;
  return {
    id: match[1].toUpperCase(),
    number: parseInt(match[2], 10),
    name: match[3],
  };
}

/** Return numeric suffixes from canonical and legacy feature IDs in text. */
export function featureNumbersInText(content: string): number[] {
  return Array.from(content.matchAll(/\bFEAT-(?:FP-)?(\d+)\b/gi), (match) =>
    parseInt(match[1], 10)
  );
}
