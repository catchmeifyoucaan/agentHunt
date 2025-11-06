# Contributing to AgentHunt

Thank you for your interest in contributing to AgentHunt! This document provides guidelines and instructions for contributing.

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Focus on what is best for the community
- Show empathy towards other community members

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported in [Issues](https://github.com/yourusername/agentHunt/issues)
2. If not, create a new issue with:
   - Clear title and description
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details (OS, Node version, Docker version)
   - Logs or screenshots if applicable

### Suggesting Features

1. Check [existing feature requests](https://github.com/yourusername/agentHunt/issues?q=is%3Aissue+is%3Aopen+label%3Aenhancement)
2. Create a new issue with:
   - Clear use case and motivation
   - Proposed solution or API design
   - Alternative solutions considered
   - Willingness to implement

### Pull Requests

1. **Fork the repository** and create a new branch from `develop`
   ```bash
   git checkout -b feature/my-new-feature
   ```

2. **Make your changes** following our coding standards:
   - TypeScript with strict mode
   - ESLint and Prettier formatting
   - Comprehensive JSDoc comments
   - Unit tests for new functionality
   - Integration tests for new agents

3. **Test your changes**:
   ```bash
   npm run lint
   npm run build
   npm test
   npm run test:integration
   ```

4. **Commit with clear messages**:
   ```bash
   git commit -m "feat: add DNS bruteforce agent"
   git commit -m "fix: handle timeout in scanner agent"
   git commit -m "docs: update API documentation"
   ```

   Follow [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` New features
   - `fix:` Bug fixes
   - `docs:` Documentation only
   - `style:` Code style changes (formatting)
   - `refactor:` Code refactoring
   - `test:` Adding tests
   - `chore:` Maintenance tasks

5. **Push to your fork**:
   ```bash
   git push origin feature/my-new-feature
   ```

6. **Create a Pull Request** with:
   - Clear title and description
   - Link to related issue(s)
   - Screenshots or GIFs for UI changes
   - Test coverage report
   - Documentation updates

## Development Setup

### Prerequisites

- Node.js 20.x or higher
- Docker 24.x or higher
- PostgreSQL 15.x (via Docker)
- Redis 7.x (via Docker)

### Local Development

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/agentHunt.git
cd agentHunt

# Install dependencies
npm install

# Copy environment file
cp .env.example .env
# Edit .env with your API keys

# Start infrastructure
docker-compose -f infrastructure/docker/docker-compose.yml up -d postgres redis minio

# Run database migrations
cd backend && npm run migrate

# Start development server
npm run dev
```

### Running Tests

```bash
# Unit tests
npm test

# Watch mode
npm run test:watch

# Integration tests
npm run test:integration

# E2E tests
npm run test:e2e
```

## Code Style

### TypeScript

- Use TypeScript strict mode
- Prefer interfaces over types for object shapes
- Use enums for fixed sets of values
- Avoid `any`; use `unknown` if type is truly unknown

### Naming Conventions

- **Files**: kebab-case (`discovery-agent.ts`)
- **Classes**: PascalCase (`DiscoveryAgent`)
- **Functions**: camelCase (`processJob`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_RETRIES`)
- **Interfaces**: PascalCase with descriptive names (`FindingResult`)

### Comments

- Use JSDoc for public APIs
- Explain "why" not "what" in inline comments
- Keep comments up-to-date with code changes

Example:
```typescript
/**
 * Discovers subdomains using passive sources
 * @param programId - Program UUID
 * @param sources - List of sources to query
 * @returns Discovered subdomains with metadata
 * @throws {Error} If program not found or API keys missing
 */
async function discoverSubdomains(
  programId: string,
  sources: string[]
): Promise<Asset[]> {
  // Implementation
}
```

## Agent Development

### Creating a New Agent

1. Create agent class in `backend/src/agents/`:
   ```typescript
   import { BaseAgent } from './base';

   export class MyAgent extends BaseAgent<MyJob> {
     constructor() {
       super('my-agent');
     }

     async process(job: Job<MyJob>): Promise<any> {
       // Implementation
     }
   }
   ```

2. Add job type to `shared/types/index.ts`

3. Register worker in `backend/src/workers/index.ts`

4. Add queue to `QueueService`

5. Write tests in `backend/tests/agents/`

6. Update documentation

### Safety Guidelines

When adding new tools or templates:

1. **Tier Classification**: Assign appropriate tier (0-3)
2. **Scope Validation**: Always validate against program scope
3. **Rate Limiting**: Respect target rate limits
4. **Error Handling**: Gracefully handle timeouts and failures
5. **Logging**: Use structured logging with context
6. **Testing**: Test against DVWA/Juice Shop testbed

## Documentation

- Update README.md for user-facing changes
- Update docs/API.md for API changes
- Update docs/ARCHITECTURE.md for architectural changes
- Add inline JSDoc comments for new functions
- Create migration guides for breaking changes

## Review Process

1. **Automated Checks**: CI must pass (lint, tests, build)
2. **Code Review**: At least one maintainer approval required
3. **Testing**: Integration tests must pass
4. **Documentation**: Must be updated for user-facing changes
5. **Security**: Must not introduce security vulnerabilities

## Release Process

1. Releases follow [Semantic Versioning](https://semver.org/)
   - MAJOR: Breaking changes
   - MINOR: New features (backwards compatible)
   - PATCH: Bug fixes

2. Maintainers will:
   - Create release branch
   - Update CHANGELOG.md
   - Tag release
   - Build and push Docker images
   - Update documentation

## Getting Help

- **Discord**: [Join our community](https://discord.gg/agenthunt)
- **GitHub Discussions**: For questions and ideas
- **GitHub Issues**: For bugs and feature requests
- **Email**: dev@agenthunt.io

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Recognition

Contributors will be recognized in:
- CONTRIBUTORS.md
- Release notes
- Annual contributor highlights

Thank you for making AgentHunt better! 🎯
