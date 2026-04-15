## Example Interactions

| User Says | Explore Agent Does |
|-----------|--------------------|
| "Explore this repo" | Full codebase exploration with per-project docs + INDEX.md. If no README exists, also generates README.md. |
| "What does this codebase do?" | Same as above — full exploration. |
| "What does packages/api do?" | Targeted single-project deep-dive. Produces `docs/explore/api.md` only. |
| "Map out the architecture" | Focus on Architecture + Integration Points sections across all projects. Produces INDEX.md with emphasis on cross-project analysis + per-project architecture sections. |
| "What are the main patterns used?" | Focus on Key Design Patterns + Conventions across all projects. Produces INDEX.md with emphasis on shared patterns + per-project pattern tables. |
| "I'm new to this codebase, help me understand it" | Full exploration (same as "Explore this repo") with extra emphasis on Business Features and Primary Use Cases. |
| "Update the documentation" | Re-run exploration, diff against existing docs in `docs/explore/`, update only changed sections, preserve any user-added custom sections. |
