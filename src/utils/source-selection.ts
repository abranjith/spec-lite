import chalk from "chalk";
import inquirer from "inquirer";
import type { SourceItem } from "../providers/base.js";

export type SourceCheckboxChoice =
  | { name: string; value: string; checked: boolean }
  | inquirer.Separator;

/** Build the shared Agents / Skills / References checkbox used by update and export. */
export function buildGroupedSourceChoices(
  sources: SourceItem[],
  state: (source: SourceItem) => { checked: boolean; tag?: string } = () => ({ checked: false }),
): SourceCheckboxChoice[] {
  const choices: SourceCheckboxChoice[] = [];
  for (const [label, group] of [
    ["Agents", sources.filter((source) => source.kind === "agent")],
    ["Skills", sources.filter((source) => source.kind === "skill")],
    ["References", sources.filter((source) => source.kind === "reference")],
  ] as [string, SourceItem[]][]) {
    if (group.length === 0) continue;
    choices.push(new inquirer.Separator(`── ${label} ──`));
    for (const source of group) {
      const itemState = state(source);
      choices.push({
        name: `${source.title}${itemState.tag ?? ""}${chalk.dim(" — " + source.description)}`,
        value: source.name,
        checked: itemState.checked,
      });
    }
  }
  return choices;
}
