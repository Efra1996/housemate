# Housemate — Agent Guidelines

## Project
- Stack: Ionic 9, Angular Standalone, TypeScript, Capacitor, and npm.
- Firebase and Firebase Hosting are planned integrations.
- Initial scope: shared household calendar, chores, and expenses.
- Personal features are outside the initial scope.
- Support mobile layouts and modern browsers, including Chrome and Safari.

## Language
- Use English for code, identifiers, comments, documentation, and technical discussions.
- Use Spanish for user-facing text.

## Workflow and Approval
- Implement only the task explicitly requested.
- Before implementation, present a technical plan and wait for approval.
- Explain the approach and list files to create or modify.
- State relevant assumptions, risks, and dependencies.

### Major UI Changes
- First create a standalone HTML mockup for review.
- Creating this mockup is permitted before implementation approval.
- Keep it separate from production code and use mock data.
- Then present the technical implementation plan.
- Wait for approval before modifying the application.

### Business Logic
- Describe the proposed logic and affected files technically.
- Clarify ambiguous business rules before implementation.

## Architecture and Code Quality
- Prefer simple, professional, incremental solutions.
- Avoid overengineering, speculative abstractions, and unnecessary layers.
- Keep folders organized with clear responsibilities.
- Follow existing project conventions and Angular/Ionic standards.
- Use strict TypeScript; avoid `any`.
- Use standalone components.
- Reuse components when useful, without premature generalization.
- Prefer built-in Ionic components where appropriate.
- Write readable code with meaningful names and focused functions.
- Keep layouts responsive and interactions suitable for touch and desktop.
- Avoid browser-specific behavior unless a compatible fallback is provided.

## Validation and Tests
- Run build and lint after code changes when applicable.
- These checks do not require separate approval.
- Report failures and distinguish existing issues from newly introduced ones.
- Add tests only for complex business logic and with explicit user approval.
- Do not claim browser or device testing unless it was performed.

## Dependencies
- Request permission before adding or updating dependencies.
- Explain why the dependency is needed.
- Do not perform forced dependency upgrades or automatic breaking fixes.

## Scope and Safety
- Do not make unrelated changes or broad refactorings.
- Preserve user work.
- Do not configure Firebase without an explicit request.
- Do not commit, push, or deploy without explicit authorization.
- Never store credentials or secrets in source control.
- Do not treat a public URL or hidden tabs as access control.
- Raise security concerns before implementing public data access.

## Completion Report
- Summarize the changes and affected files.
- Report validation results and any remaining limitations.
