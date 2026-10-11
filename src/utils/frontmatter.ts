import { parse } from "yaml";

/** Extract YAML metadata while preserving the Markdown body and its line endings. */
export function parseFrontmatter(raw: string): {
  data: unknown;
  content: string;
} {
  const content = raw.replace(/^\uFEFF/, "");
  const opening = /^---(?:ya?ml)?[ \t]*(?:\r?\n|$)/.exec(content);
  if (!opening) return { data: {}, content };

  const remainder = content.slice(opening[0].length);
  const closing = /^---[ \t]*(?:\r?\n|$)/m.exec(remainder);
  const metadata = closing ? remainder.slice(0, closing.index) : remainder;

  return {
    // Keep js-yaml's timestamp, binary, and merge-key support alongside YAML 1.2 scalars.
    data: parse(metadata, { customTags: ["timestamp", "binary"], merge: true }) ?? {},
    content: closing ? remainder.slice(closing.index + closing[0].length) : "",
  };
}
