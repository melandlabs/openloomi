# Contributing to OpenLoomi

Thank you for your interest in contributing to OpenLoomi!

## Development Setup

### Prerequisites

- Node.js 22+
- pnpm 9+
- Rust (for Tauri desktop app development)
- Git

### Platform-Specific Prerequisites

#### Windows

Developing on Windows requires additional C++ build tools for native modules like `better-sqlite3`.

**Required Visual Studio Build Tools components:**

- **Desktop development with C++**
- **ARM64/ARM64EC MSVC build tools** (matching your device architecture)
- **clang-related tooling** (LLVM)

**Node.js:** Node.js 22+ is recommended. Node 24 may have compatibility issues with some native modules on Windows devices.

**Installation steps:**

1. Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022)
2. During installation, select:
   - Workloads → "Desktop development with C++"
   - Individual components → "ARM64/ARM64EC MSVC build tools" (select the version matching your Windows ARM version)
   - Individual components → "clang-related tooling" (optional but recommended)

**Note:** Installing just the Visual Studio Build Tools alone is not sufficient. The specific ARM64 C++ components must be selected.

#### macOS

- Xcode Command Line Tools: `xcode-select --install`

#### Linux

- Build essentials: `sudo apt-get install build-essential` (Debian/Ubuntu)
- Required for `better-sqlite3` and other native modules

### Initial Setup

```bash
# Clone the repository
git clone https://github.com/melandlabs/openloomi.git
cd openloomi

# Install dependencies
pnpm install

# Copy environment files
cp apps/web/.env.example apps/web/.env

# Configure your AI provider keys in .env:
#   ANTHROPIC_API_KEY=sk-ant-...
#   LLM_API_KEY=sk-...
```

### Running the App

```bash
# Or start just the web app (desktop app)
pnpm tauri:dev

# Or start just the web app (browser mode)
pnpm dev
```

## Project Structure

```
openloomi/
├── apps/
│   ├── web/              # Desktop app (Tauri + Next.js)
│   └── marketing/        # Marketing site
├── packages/
│   ├── ai/              # Agent, memory, RAG, model routing
│   ├── agent/            # Multi-provider agent SDK
│   ├── api/              # API utilities
│   ├── audit/            # Audit logging
│   ├── config/           # Configuration management
│   ├── hooks/            # React hooks
│   ├── i18n/             # Internationalization
│   ├── indexeddb/         # IndexedDB storage
│   ├── insights/          # EventRank scoring, focus classification
│   ├── integrations/      # 18 platform connectors
│   ├── mcp/              # Model Context Protocol
│   ├── rag/              # Retrieval-augmented generation
│   ├── rss/              # RSS feed handling
│   ├── search/            # Brave Search integration
│   ├── security/          # Security utilities
│   ├── shared/            # Shared utilities
│   └── storage/           # Local + cloud storage
└── skills/                # PDF, DOCX, XLSX, PPTX, browser automation
```

## Code Style

We use Biome for linting and formatting. Please do not commit code that violates linting rules.

```bash
# Check linting
pnpm lint

# Auto-fix linting issues
pnpm lint:fix

# Format code
pnpm format
```

### TypeScript

- Use explicit types for function parameters and return values
- Avoid `any` type - use `unknown` when the type is truly unknown
- Use `interface` for object shapes, `type` for unions, intersections, and aliases

### React Components

- Use functional components with hooks
- Co-locate component-specific styles when possible
- Use Server Components where appropriate in Next.js

## Testing

```bash
# Run all tests
pnpm test

# Run tests with coverage
pnpm --filter web test

# Run TypeScript type checking
pnpm tsc
```

### Writing Tests

- Place test files adjacent to the code they test (e.g., `component.tsx` and `component.test.tsx`)
- Use descriptive test names that explain the expected behavior
- Aim for meaningful test coverage of business logic

## Database

We use Drizzle ORM for database management.

```bash
# Generate migrations from schema changes
pnpm --filter web db:generate

# Apply migrations
pnpm --filter web db:migrate

# Push schema changes (development only)
pnpm --filter web db:push

# Open database studio
pnpm --filter web db:studio
```

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new platform connector
fix: resolve memory leak in agent
docs: update API documentation
refactor: simplify search ranking algorithm
test: add integration tests for messaging
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`, `build`, `revert`

## Pull Requests

1. **Fork and create a branch** from `main`:
   - Feature: `feat/your-feature-name`
   - Bugfix: `fix/your-bugfix-name`
   - Documentation: `docs/your-doc-change`

2. **Make your changes** - follow the code style guidelines

3. **Write tests** for new functionality

4. **Ensure tests pass**:

   ```bash
   pnpm test
   pnpm lint
   pnpm tsc
   ```

5. **Update documentation** if needed

6. **Open a Pull Request** with a clear description

## Packages Development

When working on packages in `packages/` directory:

```bash
# Build all packages
pnpm build:packages

# Build a specific package
pnpm --filter @openloomi/ai build

# Use the package in the web app during development
# Packages are linked via pnpm workspace
```

## Platform Connectors

The `packages/integrations` directory contains connectors for external platforms. When adding a new connector:

1. Follow the existing connector patterns
2. Implement proper error handling and rate limiting
3. Add TypeScript types for platform-specific data
4. Include necessary OAuth/token refresh logic

## Getting Help

- [GitHub Issues](https://github.com/melandlabs/openloomi/issues) - bugs and feature requests
- [Discord](https://discord.com/invite/xkJaJyWcsv) - discussion and questions
- [Email](mailto:developer@openloomi.ai) - direct contact

## Code of Conduct

Please be respectful and constructive in all interactions. We welcome contributors of all skill levels.

## License

By contributing, you agree that your contributions will be licensed under the Apache 2.0 License.
