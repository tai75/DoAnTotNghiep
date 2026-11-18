# Job Connect frontend guidance

For tasks that design, review, or modify HTML, CSS, React components, or client-side JavaScript, consult the installed `modern-web-guidance` skill before implementation.

- Treat Modern Web Guidance as a technical reference, not as authorization for broad refactors or redesigns.
- Adapt relevant guidance to the existing React architecture and libraries; do not replace them mechanically.
- Check browser support and required fallbacks before adopting newer Web APIs.
- Run Modern Web Guidance queries with `DISABLE_TELEMETRY=1` unless the user explicitly opts in to telemetry.
- Prefer existing platform and project capabilities; do not add dependencies when they are unnecessary.
- Preserve functionality and tests that already pass.
- Keep all user-facing interface text in Vietnamese.
- Verify affected UI on desktop and mobile.
- Do not change authentication, authorization, sessions, Prisma, database behavior, or backend architecture solely because of frontend guidance.
