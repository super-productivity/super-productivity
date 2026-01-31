# AI/Developer Architecture Documentation

This directory contains architectural documentation, design patterns, and guides specifically written for AI assistants and developers working on the Super Productivity codebase.

## Core Patterns & Architecture

### Task Scheduling & Date Management

- **[dueDay/dueWithTime Mutual Exclusivity Pattern](dueDay-dueWithTime-mutual-exclusivity.md)** ⭐ CRITICAL
  - Explains how `dueDay` and `dueWithTime` fields interact on tasks
  - **Why it matters**: These fields are mutually exclusive; setting one clears the other
  - **When to read**: Before working with task scheduling, planner, or date selectors
  - **Related commit**: `400ca8c1` (2026-01-29)

- **[TODAY_TAG Architecture](today-tag-architecture.md)** ⭐ CRITICAL
  - Explains the virtual tag pattern for the TODAY_TAG
  - **Why it matters**: TODAY_TAG behaves fundamentally differently from regular tags
  - **When to read**: Before working with today's task list, planner, or tag operations
  - **Related**: Uses the dueDay/dueWithTime mutual exclusivity pattern

## Entity Management

- **[Adding New Entity Type Checklist](adding-new-entity-type-checklist.md)**
  - Step-by-step guide for adding new entity types to the app
  - **When to use**: When adding a new feature that requires persistent state

## Sync & Operation Log

- **[File-Based OpLog Sync Implementation Plan](file-based-oplog-sync-implementation-plan.md)**
  - Technical plan for file-based sync implementation
  - **Related**: See also `docs/sync-and-op-log/` for comprehensive sync documentation

## Plugin System

- **[Issue Providers to Plugins Evaluation](issue-providers-to-plugins-evaluation.md)**
  - Analysis of migrating issue providers to plugin architecture

- **[Plugin UI Consistency Plan](plugin-ui-consistency-plan.md)**
  - Design plan for consistent plugin UI/UX

## Documentation Conventions

### Document Types

1. **Architecture Docs** - Explain fundamental patterns (e.g., virtual tags, mutual exclusivity)
2. **Implementation Plans** - Detailed technical plans for features
3. **Checklists** - Step-by-step guides for common tasks
4. **Evaluations** - Analysis of technical decisions

### Criticality Markers

- ⭐ **CRITICAL**: Must read before working in related areas
- 📋 **REFERENCE**: Useful reference material
- 📝 **DRAFT**: Work in progress, may be incomplete

### When to Update

- **After architectural changes**: Document new patterns immediately
- **When patterns emerge**: If you notice repeated code patterns, document them
- **When questions arise**: If developers ask the same question twice, document the answer
- **After major refactors**: Especially when behavior changes (like `400ca8c1`)

## Related Documentation

- [`docs/sync-and-op-log/`](../sync-and-op-log/) - Comprehensive operation log and sync documentation
- [`docs/wiki/`](../wiki/) - User-facing wiki documentation
- [`docs/long-term-plans/`](../long-term-plans/) - Future technical plans and proposals

## Contributing

When adding new documentation to this directory:

1. **Use clear titles** that describe the pattern/feature
2. **Add a summary section** explaining what, why, and when to read
3. **Include code examples** showing correct and incorrect usage
4. **Link related files** using relative paths
5. **Update this README** with your new document
6. **Reference related commits** when documenting a specific change
