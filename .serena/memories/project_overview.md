# Project Overview

## Purpose
This is a Next.js 15 application that generates Cloudflare Workers from natural language prompts. The app allows users to:
- Enter a database connection string (Neon/PostgreSQL)
- Describe an API they want to create using natural language
- Generate Cloudflare Worker code using Hono framework
- Test the generated APIs directly in the browser
- Get validation errors and suggestions for database schema compatibility

## Tech Stack
- **Frontend**: Next.js 15 with App Router, React 19, TypeScript 5.7
- **Styling**: Tailwind CSS 3.4
- **State Management**: XState 5.21 for complex flows
- **AI Integration**: AI SDK with Anthropic integration
- **Database**: Neon Database (PostgreSQL)
- **Worker Framework**: Hono (for Cloudflare Workers)
- **Testing**: Miniflare for local Cloudflare Worker testing
- **Package Manager**: Bun
- **Validation**: Zod
- **Testing Framework**: Vitest

## Key Features
- Prompt-to-API generation using AI
- Database schema validation
- Real-time code generation and preview
- In-browser API testing
- Cloudflare Worker deployment
- Sandbox testing with Miniflare