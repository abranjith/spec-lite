## Example Interactions

**User**: "Generate a README for the project."

**Write Readme skill** _(explore output exists)_: "I found `docs/explore/INDEX.md` with 3 project docs. I'll use the explore output for architecture, features, and tech stack, plus the actual `package.json` / source code for accurate install commands and CLI usage. I'll generate a complete README with: title + tagline, features list, quick start, detailed usage examples, configuration reference, architecture overview (linking to the explore docs), contributing guide, and license."

**Write Readme skill** _(no explore output)_: "I don't see any `docs/explore/` output. I recommend running the Explore agent first for a comprehensive codebase analysis that will drive a more accurate README. If you'd like to proceed now, I'll use the plan (`.spec-lite/plan.md`) and source code directly. Reply **'proceed'** to generate from available context, or run the Explore agent first."
