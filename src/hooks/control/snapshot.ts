import path from "node:path";
import fs from "fs-extra";
import { loadAllSources } from "../../utils/prompts.js";
import { loadRegistry } from "../registry.js";
import { resolveTemplate } from "../interpolation.js";
import { hash } from "./store.js";
import {
  ControlError,
  type Choice,
  type FileSnapshot,
  type Snapshot,
  type TargetIdentity,
} from "./types.js";
import { logicalTarget, instrumented } from "./validation.js";
import type { HookPayload, ResolvedHook } from "../types.js";
import { getAllProviders } from "../../providers/index.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { repository } from "../builtins/git-workflow.js";

const forbidden =
  /(^|\/)(\.git|\.ssh|\.aws|\.azure|\.gnupg|node_modules)(\/|$)|(^|\/)(\.env(?:\..*)?|\.npmrc|\.netrc|\.git-credentials|\.pypirc|credentials(?:\.[^/]*)?|id_rsa|id_ed25519|id_ecdsa|id_dsa|feedback\.md|hooks\.log\.jsonl|debug\.log)$|\.(?:pem|key)$|(^|\/)spec-lite\/(decisions|actions|tmp|logs|executions|events|chains)\//i;
export async function safeFile(
  workspace: string,
  raw: string,
  publish = false
): Promise<FileSnapshot> {
  const root = await fs.realpath(workspace);
  const absolute = path.resolve(root, raw);
  const relative = path.relative(root, absolute).split(path.sep).join("/");
  if (
    !relative ||
    relative.startsWith("../") ||
    path.isAbsolute(relative) ||
    forbidden.test(relative)
  )
    throw new ControlError(
      "unsafe-path",
      `Input/attachment ${raw} is outside the workspace or disallowed.`
    );
  let real: string;
  try {
    real = await fs.realpath(absolute);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    // Existing ancestor must be safe too (a missing leaf under an external symlink is unsafe).
    let parent = path.dirname(absolute);
    while (!(await fs.pathExists(parent))) parent = path.dirname(parent);
    const realParent = await fs.realpath(parent);
    const containment = path.relative(root, realParent);
    const gitCommon = (await repository(root)).commonDir;
    if (
      containment.startsWith("..") ||
      path.isAbsolute(containment) ||
      forbidden.test(containment.split(path.sep).join("/")) ||
      realParent === gitCommon ||
      realParent.startsWith(gitCommon + path.sep)
    )
      throw new ControlError(
        "unsafe-path",
        `Input ${raw} traverses an external or disallowed symlink.`
      );
    if (publish)
      throw new ControlError(
        "missing-attachment",
        `Attachment ${raw} does not exist.`
      );
    return {
      path: relative,
      realPath: absolute,
      hash: hash("missing"),
      missing: true,
      publish,
    };
  }
  const inside = path.relative(root, real).split(path.sep).join("/");
  const gitCommon = (await repository(root)).commonDir;
  if (
    inside.startsWith("../") ||
    path.isAbsolute(inside) ||
    forbidden.test(inside) ||
    real === gitCommon ||
    real.startsWith(gitCommon + path.sep) ||
    !(await fs.stat(real)).isFile()
  )
    throw new ControlError(
      "unsafe-path",
      `Input/attachment ${raw} resolves to a disallowed path.`
    );
  return {
    path: relative,
    realPath: real,
    hash: hash(await fs.readFile(real)),
    publish,
  };
}
export async function targetIdentity(
  workspace: string,
  choice: Choice
): Promise<TargetIdentity | undefined> {
  if (choice.continue || choice.stop) return undefined;
  if (choice.prompt)
    return {
      logical: "prompt",
      kind: "prompt",
      canonical: hash(choice.prompt),
      effective: {},
      completion: "reported",
    };
  const logical = logicalTarget(choice)!;
  const source = (await loadAllSources()).find(
    (s) => s.name.replace(/_/g, "-") === logical
  );
  if (!source && instrumented.has(logical))
    throw new ControlError(
      "target-unavailable",
      `Bundled target ${logical} is unavailable; reissue after restoring it.`
    );
  const effective: Record<string, string> = {};
  if (source)
    for (const provider of getAllProviders()) {
      const paths = provider.getOutputPaths(source.name);
      const meta = {
        name: source.promptName,
        title: source.title,
        description: source.description,
      };
      const candidates = [
        {
          file: paths.prompt,
          expected: provider.transformPrompt(source.content, meta),
        },
        ...(paths.agent && provider.transformAgent
          ? [
              {
                file: paths.agent,
                expected: provider.transformAgent(source.content, meta),
              },
            ]
          : []),
        ...(provider.getSkillOutputDir
          ? [
              {
                file: path.join(
                  provider.getSkillOutputDir(source.name),
                  "SKILL.md"
                ),
                expected: source.content,
              },
            ]
          : []),
      ];
      for (const { file, expected } of candidates)
        if (await fs.pathExists(path.join(workspace, file))) {
          const actual = await fs.readFile(path.join(workspace, file), "utf8");
          if (instructionBody(actual) !== instructionBody(expected))
            effective[file.split(path.sep).join("/")] = hash(
              instructionBody(actual)
            );
        }
    }
  return {
    logical,
    kind: choice.skill ? "skill" : "agent",
    canonical: hash(source ? source.content : `${logical}:external-reported`),
    effective,
    completion: instrumented.has(logical) ? "lifecycle" : "reported",
  };
}
export async function takeSnapshot(
  workspace: string,
  hook: ResolvedHook,
  payload: HookPayload,
  choices: Record<string, Choice>
): Promise<Snapshot> {
  workspace = await fs.realpath(workspace);
  const options = hook.options as
    { attach?: string[]; inputs?: string[] } | undefined;
  const files = new Map<string, FileSnapshot>();
  const resolve = (value: string) =>
    resolveTemplate(value, { payload }, "none").value;
  const relevant = [
    typeof payload.plan === "string" ? payload.plan : undefined,
    typeof payload.report === "string" ? payload.report : undefined,
    payload.feature?.spec,
  ].filter((v): v is string => !!v);
  for (const file of [...relevant, ...(options?.inputs ?? []).map(resolve)]) {
    const snap = await safeFile(workspace, file);
    files.set(snap.path, snap);
  }
  for (const template of options?.attach ?? []) {
    const snap = await safeFile(workspace, resolve(template), true);
    // A path supplied through payload variables is caller-controlled: publish it only inside the
    // project's .spec-lite artifacts. Elsewhere it still binds the approval but is withheld from GitHub.
    if (/\$\{/.test(template) && !snap.path.startsWith(".spec-lite/")) {
      snap.publish = false;
      snap.withheld = true;
    }
    files.set(snap.path, snap);
  }
  const targets: Record<string, TargetIdentity> = {};
  for (const [key, choice] of Object.entries(choices)) {
    const target = await targetIdentity(workspace, choice);
    if (target) targets[key] = target;
  }
  return {
    workspace,
    hook: structuredClone(hook),
    registryHash: hash(JSON.stringify(hook)),
    files: [...files.values()],
    targets,
    payload: structuredClone(payload),
  };
}
export async function snapshotChanged(
  snapshot: Snapshot
): Promise<string | undefined> {
  if (
    !(await fs.pathExists(snapshot.workspace)) ||
    (await fs.realpath(snapshot.workspace)) !== snapshot.workspace
  )
    return "Saved worktree is unavailable or changed.";
  for (const file of snapshot.files) {
    let current: FileSnapshot;
    try {
      current = await safeFile(snapshot.workspace, file.path, file.publish);
    } catch (e) {
      return (e as Error).message;
    }
    if (current.hash !== file.hash || current.realPath !== file.realPath)
      return `Approval input ${file.path} changed.`;
  }
  const { hooks, issues } = await loadRegistry(snapshot.workspace);
  const hook = hooks.find((h) => h.name === snapshot.hook.name);
  if (!hook || hash(JSON.stringify(hook)) !== snapshot.registryHash)
    return `Checkpoint/routing definition ${snapshot.hook.name} changed; reissue it.`;
  if (issues.some((i) => i.level === "error" && i.hook === snapshot.hook.name))
    return "Relevant routing configuration is invalid.";
  for (const [key, target] of Object.entries(snapshot.targets)) {
    const declared = (
      snapshot.hook.options?.choices as Record<string, Choice> | undefined
    )?.[key] ?? {
      description: snapshot.hook.description ?? snapshot.hook.name,
      skill: snapshot.hook.skill,
      agent: snapshot.hook.agent,
      prompt: snapshot.hook.prompt,
      args: snapshot.hook.args,
      completion: snapshot.hook.completion,
    };
    const choice = freezeChoice(declared, snapshot.payload);
    const current = await targetIdentity(snapshot.workspace, choice);
    const fingerprints = (identity: TargetIdentity) =>
      JSON.stringify({
        logical: identity.logical,
        kind: identity.kind,
        canonical: identity.canonical,
        completion: identity.completion,
        overrides: [...new Set(Object.values(identity.effective))].sort(),
      });
    if (!current || fingerprints(current) !== fingerprints(target))
      return `Target instructions for ${target.logical} changed; reissue/adopt explicitly.`;
  }
  return undefined;
}
function instructionBody(content: string): string {
  const literal =
    /developer_instructions\s*=\s*'''\r?\n?([\s\S]*?)'''\s*$/.exec(content);
  const toml = /developer_instructions\s*=\s*"""\r?\n?([\s\S]*?)"""\s*$/.exec(
    content
  );
  let body = content;
  if (literal) body = literal[1];
  else if (toml) {
    try {
      body = JSON.parse(`"${toml[1].replace(/\r?\n/g, "\\n")}"`);
    } catch {
      body = toml[1];
    }
  }
  body = parseFrontmatter(body).content;
  return body
    .replace(/<!-- spec-lite \|[^]*?-->/g, "")
    .replace(/<!-- To update:[^]*?-->/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
}
/** Resolve ambient values once; preserve only declared decision slots until acceptance. */
export function freezeChoice(choice: Choice, payload: HookPayload): Choice {
  const frozen = structuredClone(choice);
  for (const field of ["args", "prompt", "description"] as const) {
    const template = frozen[field];
    if (!template) continue;
    const slots: string[] = [];
    const protectedTemplate = template.replace(
      /\$\{decision\.[^{}]+\}/g,
      (slot) => {
        slots.push(slot);
        return `\u0001${slots.length - 1}\u0002`;
      }
    );
    // eslint-disable-next-line no-control-regex -- Match the temporary sentinels inserted above.
    const sentinelPattern = /\u0001(\d+)\u0002/g;
    frozen[field] = resolveTemplate(
      protectedTemplate,
      { payload },
      "none"
    ).value.replace(sentinelPattern, (_, index) => slots[Number(index)]);
  }
  return frozen;
}
export function fillChoice(
  choice: Choice,
  decision: Record<string, string>
): Choice {
  const filled = structuredClone(choice);
  for (const field of ["args", "prompt", "description"] as const)
    if (filled[field])
      filled[field] = filled[field]!.replace(
        /\$\{decision\.([^{}:]+)(?::-([^{}]*))?\}/g,
        (_, name, fallback) => {
          const value = decision[name] ?? fallback;
          if (value === undefined)
            throw new ControlError(
              "decision-slot",
              `Unresolved decision.${name}.`,
              2
            );
          return value;
        }
      );
  return filled;
}
