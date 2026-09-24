# Contributing to `puter-ai-cli`

Thank you for your interest in contributing to **`puter-ai-cli`**! We welcome bug reports, feature suggestions, documentation enhancements, and pull requests.

---

## Code of Conduct

Please follow our [Code of Conduct](CODE_OF_CONDUCT.md) in all community interactions.

---

## Development Setup

### Prerequisites

- **Node.js**: v22.0.0 or later (v24.x recommended)
- **npm**: v10.0.0 or later
- **git**

### Setting Up Locally

1. **Fork and clone the repository**:
   ```bash
   git clone https://github.com/MishraShardendu22/puter-ai-cli.git
   cd puter-ai-cli
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Build TypeScript source**:
   ```bash
   npm run build
   ```

4. **Link globally for testing**:
   ```bash
   npm link
   ```

5. **Run tests**:
   ```bash
   npm test
   ```

---

## Architecture & Codebase Layout

```
├── src/
│   ├── index.ts           # CLI entrypoint, commands configuration & exception handlers
│   ├── auth.ts            # Token persistence, multi-token pool & browser authentication
│   ├── commands/
│   │   └── ask.ts         # 'ask' command with streaming stdout, stdin piping & failover
│   └── providers/
│       └── puter.ts       # Puter AI provider, response parsing & error mapping
└── tests/
    ├── auth.test.ts       # Token pool, permissions & precedence tests
    ├── puter.test.ts      # Response formatting & stream chunk tests
    └── cli.test.ts        # CLI binary & integration tests
```

---

## Submitting Pull Requests

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. Commit your changes with clear, semantic commit messages (e.g. `feat: ...`, `fix: ...`, `docs: ...`).
3. Ensure all tests pass:
   ```bash
   npm run build
   npm test
   ```
4. Push your branch to GitHub and open a Pull Request.

---

## Reporting Issues

If you find a bug or have a suggestion:
1. Check if the issue has already been reported in [Issues](https://github.com/MishraShardendu22/puter-ai-cli/issues).
2. If not, open a new issue using the appropriate template.
