# Feature Development Workflow

## When Adding New Functionality

Before implementing a new feature, assess its scope and determine the appropriate workflow:

### Small Changes (no spec update needed)
- UI tweaks, styling adjustments
- Adding/removing a column in an existing grid
- Bug fixes
- Copy changes

→ Implement directly.

### Medium Changes (update existing spec)
- New filter or sort option
- New export format
- New bulk action
- New UI component within an existing page

→ Steps:
1. Add new requirement(s) to the relevant `requirements.md`
2. Update `design.md` if the change affects data flow or component structure
3. Append new task group to `tasks.md` (don't rewrite completed tasks)
4. Implement the tasks

### Large Changes (full spec cycle)
- New page or major view
- New data model or storage layer
- New background process or API integration
- Cross-extension shared feature

→ Steps:
1. Create a new spec folder under `.kiro/specs/<feature-name>/`
2. Write `requirements.md` with user stories and acceptance criteria
3. Write `design.md` with architecture, components, and data flow
4. Write `tasks.md` with implementation steps
5. Implement task by task

## Spec Maintenance Rules

- Specs are living documents — update them when features evolve
- Completed tasks stay in `tasks.md` as history (marked done)
- New tasks are appended at the bottom in a new group with a date heading
- Keep requirements atomic: one behavior per requirement
- Design docs reference file paths so they stay navigable

## When Unsure About Scope

If the user describes a feature and the scope is ambiguous, ask:
> "This sounds like a [small/medium/large] change. Want me to go straight to implementation, or should I update the spec first?"

## Commit Conventions

- Stage and commit after completing a logical unit of work
- Use conventional commit messages: `feat:`, `fix:`, `refactor:`, `docs:`
- Commit spec updates separately from implementation when both change
