# OpenLoomi Marketing

The Marketing app uses Fumadocs for both product documentation and blog content.

- Docs live in `content/` and are served under `/docs`.
- Blog posts live in `blogs/` and are served under `/blogs`.
- Navigation order for docs is controlled by `content/meta.json` and nested `meta.json` files.
- Fumadocs collections are configured in `source.config.ts`, with loaders in `lib/source.ts`.

Run `pnpm test` from this directory to validate the content conventions that Fumadocs depends on.
