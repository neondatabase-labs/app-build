# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Environment Setup
```bash
# Setup environment files
cp .env.local.example .env.local
# Add VERCEL_TOKEN to .env.local

# For template testing, setup template/.env
# Add CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
```

### Development Server
```bash
# Install dependencies
bun install

# Run development server
bun dev

# Alternative (also works)
npm run dev
```

### Build and Test
```bash
# Build production version
npm run build

# Run linter
npm run lint

# Run tests
npm run test
```

## Architecture Overview

This is a Next.js 15 application that generates Cloudflare Workers from natural language prompts using AI. The core workflow involves:

1. **User Input**: Database connection + API description
2. **AI Generation**: Using Anthropic's Claude via AI SDK
3. **Worker Creation**: Generates Hono-based Cloudflare Workers
4. **Testing**: In-browser testing with Miniflare sandbox

### Key Components

**State Management (`src/app/lib/prompt-to-api-state-machine.ts`)**
- Uses XState 5.21 for complex generation workflows
- Manages states: database validation → schema analysis → code generation → testing
- Contains functions: `getDatabaseSchema`, `generateHonoCode`, `generateFetchImplementations`

**API Generation (`src/app/api/prompt-to-api/route.ts`)**
- Next.js API route handling prompt-to-API requests
- Integrates with state machine for generation flow
- Returns streaming responses for long AI operations

**Sandbox Testing (`src/app/lib/sandbox.ts`)**
- `MiniflareSandbox` class for local Cloudflare Worker testing
- `runHonoCommandInSandbox` for executing generated APIs
- Provides validation before deployment

**Prompts (`src/app/lib/prompt-api-prompts.ts`)**
- AI prompts for code generation
- Templates for different generation phases

### Tech Stack Integration

- **XState**: Complex state management for generation flow - use for multi-step processes
- **AI SDK**: Anthropic integration - use `generateObject` and `streamObject` patterns
- **Zod**: Validation throughout - define schemas for all data structures
- **Hono**: Generated worker framework - follow Hono patterns in generated code
- **Miniflare**: Local testing - use for validating generated workers before deployment

### File Organization

```
src/app/
├── api/              # Next.js API routes
├── lib/              # Shared utilities and state machines
├── page.tsx          # Main UI
└── layout.tsx        # App layout
```

### Development Patterns

- Use XState for complex multi-step workflows
- Validate all inputs/outputs with Zod schemas
- Follow cursor rules in `.cursor/rules/` for specific patterns
- Implement proper loading states with rotating messages
- Use proper error handling throughout generation pipeline