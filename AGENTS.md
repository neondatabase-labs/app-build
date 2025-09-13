# Project Instructions

## Project Overview
This is a Next.js 15 application with TypeScript that generates Cloudflare Workers from natural language prompts. The project includes:
- Next.js 15 with App Router
- TypeScript with strict mode
- Tailwind CSS for styling
- XState for state management
- AI SDK for Anthropic integration
- Cloudflare Workers subproject using Hono
- Neon Database integration

## Code Style
- Use TypeScript for all new files with strict mode
- Prefer functional components in React
- Use kebab-case for file names, PascalCase for components
- Use camelCase for functions and variables
- Use UPPER_CASE for constants

## Architecture
- Follow Next.js App Router patterns
- Use XState for complex state management
- Keep business logic in service layers
- Use Zod for validation
- Implement proper error boundaries

## Development Workflow
- Use Bun as the package manager
- Follow the established code patterns in `.cursor/rules`
- Write self-documenting code
- Use proper TypeScript types
- Implement proper error handling

## Project-Specific Patterns
- Use state machines for prompt-to-API generation flow
- Implement proper loading states with rotating messages
- Generate proper Hono-based Cloudflare Workers
- Handle database schema validation
- Use proper AI SDK integration patterns
