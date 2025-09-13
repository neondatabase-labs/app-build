# Client-Side State Management Implementation Plan

## Overview
Transform the current prompt-to-API generation flow by moving the XState machine to the client-side and splitting the server-side logic into separate API endpoints. This eliminates state duplication and provides better user feedback during the generation process.

## Current Architecture Analysis

### Current State
- **Server-side XState machine** handles AI workflow (secure, API key protected)
- **Client-side React state** manages UI interactions
- **Single API call** returns final result only
- **No progress feedback** - users see generic loading spinner

### Problems to Solve
1. Users can't see what's happening during generation
2. State duplication between server and client
3. No progress feedback during long-running operations
4. Generic loading messages don't provide context

## Proposed Architecture

### High-Level Design
```
┌─────────────────┐    HTTP API Calls    ┌─────────────────┐
│   Client        │◄────────────────────►│   Server        │
│                 │                      │                 │
│ ┌─────────────┐ │                      │ ┌─────────────┐ │
│ │ Client      │ │                      │ │ API         │ │
│ │ XState      │ │                      │ │ Endpoints   │ │
│ │ Machine     │ │                      │ │             │ │
│ │ (Orchestrator)│                      │ │ - /validate │ │
│ └─────────────┘ │                      │ │ - /analyze  │ │
│                 │                      │ │ - /generate │ │
│ ┌─────────────┐ │                      │ │ - /deploy   │ │
│ │ React       │ │                      │ └─────────────┘ │
│ │ Component   │ │                      │                 │
│ └─────────────┘ │                      │ ┌─────────────┐ │
└─────────────────┘                      │ │ Anthropic   │ │
                                        │ │ API         │ │
                                        │ └─────────────┘ │
                                        └─────────────────┘
```

## Implementation Plan

### Phase 1: Split Server-Side API into Endpoints

#### 1.1 Create Individual API Endpoints with Colocated Code

**File:** `src/app/api/validate-request/route.ts`
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { anthropic } from '@ai-sdk/anthropic';
import { generateObject } from 'ai';
import { neon } from '@neondatabase/serverless';

// Colocated Zod schema
const validationResultSchema = z.object({
  isCompatible: z
    .boolean()
    .describe('Whether the user request is compatible with the database schema'),
  compatibilityIssues: z
    .array(z.string())
    .describe('List of compatibility issues if any'),
  requiredTables: z
    .array(z.string())
    .describe('Tables required for the request'),
  missingTables: z
    .array(z.string())
    .describe('Tables that are missing from the schema'),
  requiredColumns: z
    .record(z.string(), z.array(z.string()))
    .describe('Columns required per table'),
  missingColumns: z
    .record(z.string(), z.array(z.string()))
    .describe('Columns that are missing per table'),
  suggestions: z
    .array(z.string())
    .describe('Suggestions for fixing compatibility issues'),
  suggestionsSQL: z
    .array(z.string())
    .describe('SQL statements to fix the compatibility issues'),
});

// Colocated prompt
const REQUEST_VALIDATION_PROMPT = (schema: string, userPrompt: string) => `
You are a database schema validation expert. Analyze the provided database schema and user request to determine compatibility.

Database Schema:
${schema}

User Request: "${userPrompt}"

Determine if the user's request is compatible with the database schema. Consider:
1. Required tables exist
2. Required columns exist in those tables
3. Data types are appropriate
4. Relationships are properly defined
5. Constraints are satisfied

If incompatible, provide specific suggestions and SQL to fix the issues.
`;

// Colocated database schema function
async function getDatabaseSchema(databaseConnectionString: string) {
  const sql = neon(databaseConnectionString);
  const result = await sql`
    SELECT 
            t.table_schema,
            t.table_name,
            c.column_name,
            c.data_type,
            c.column_default,
            c.is_nullable,
            c.character_maximum_length,
            -- Primary Key information
            CASE 
                WHEN cons.constraint_type = 'PRIMARY KEY' THEN 'YES'
                ELSE 'NO'
            END as is_primary_key,
            -- Foreign Key information
            CASE 
                WHEN cons.constraint_type = 'FOREIGN KEY' THEN 
                    'References ' || kcu2.table_name || '(' || kcu2.column_name || ')'
                ELSE NULL
            END as foreign_key_details
        FROM information_schema.tables t
        LEFT JOIN information_schema.columns c 
            ON t.table_schema = c.table_schema 
            AND t.table_name = c.table_name
        LEFT JOIN information_schema.key_column_usage kcu 
            ON c.column_name = kcu.column_name 
            AND c.table_name = kcu.table_name 
            AND c.table_schema = kcu.table_schema
        LEFT JOIN information_schema.table_constraints cons 
            ON kcu.constraint_name = cons.constraint_name 
            AND kcu.table_name = cons.table_name 
            AND kcu.table_schema = cons.table_schema
        LEFT JOIN information_schema.referential_constraints rc 
            ON cons.constraint_name = rc.constraint_name
        LEFT JOIN information_schema.key_column_usage kcu2 
            ON rc.unique_constraint_name = kcu2.constraint_name
        WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY 
            t.table_schema,
            t.table_name,
            c.column_name;
  `;
  return result;
}

// Colocated validation function
async function validateRequest({
  databaseConnectionString,
  userPrompt,
}: {
  databaseConnectionString: string;
  userPrompt: string;
}) {
  const model = anthropic('claude-sonnet-4-20250514');
  const rawSchema = await getDatabaseSchema(databaseConnectionString);

  const { object: validationResult } = await generateObject({
    model: model,
    temperature: 0,
    schema: validationResultSchema,
    system: REQUEST_VALIDATION_PROMPT(JSON.stringify(rawSchema), userPrompt),
    prompt: `Validate if this user request is compatible with the database schema: "${userPrompt}"`,
  });

  return validationResult;
}

export async function POST(request: NextRequest) {
  try {
    const { prompt, connectionString } = await request.json();
    
    if (!prompt || !connectionString) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    const result = await validateRequest({ 
      databaseConnectionString: connectionString, 
      userPrompt: prompt 
    });
    
    return NextResponse.json({ result });
  } catch (error) {
    console.error('Validation error:', error);
    return NextResponse.json(
      { error: (error as Error).message }, 
      { status: 500 }
    );
  }
}
```

**File:** `src/app/api/analyze-schema/route.ts`
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { anthropic } from '@ai-sdk/anthropic';
import { generateObject } from 'ai';
import { neon } from '@neondatabase/serverless';

// Colocated Zod schema
const summarizedSchemaSchema = z
  .object({
    tables: z.array(
      z.object({
        name: z.string(),
        columns: z.array(
          z.object({
            name: z.string(),
            type: z.string(),
            constraints: z.array(z.string()),
            isNullable: z.boolean(),
          })
        ),
        relationships: z.array(
          z.object({
            table: z.string(),
            type: z.string(),
            columns: z.array(z.string()),
          })
        ),
      })
    ),
  })
  .describe('The analyzed schema details');

// Colocated prompt
const SCHEMA_ANALYSIS_SYSTEM_PROMPT = (schema: string) => `
You are a database schema analysis expert. Analyze the provided database schema and create a summarized, LLM-friendly version.

Database Schema:
${schema}

Create a clean, structured summary that includes:
1. Table names and their purpose
2. Column details with types and constraints
3. Relationships between tables
4. Key constraints and indexes

Make it easy for an LLM to understand the database structure for code generation.
`;

// Colocated database schema function (same as above)
async function getDatabaseSchema(databaseConnectionString: string) {
  // ... same implementation as above
}

// Colocated analysis function
async function generateSummarizedSchema(databaseConnectionString: string) {
  const model = anthropic('claude-sonnet-4-20250514');
  const rawSchema = await getDatabaseSchema(databaseConnectionString);

  const { object: summarizedSchema } = await generateObject({
    model: model,
    temperature: 0,
    schema: z.object({
      summarizedSchema: summarizedSchemaSchema.nullable(),
    }),
    system: SCHEMA_ANALYSIS_SYSTEM_PROMPT(JSON.stringify(rawSchema)),
    prompt: 'Analyze the database schema and provide a summarized LLM friendly version',
  });

  return summarizedSchema;
}

export async function POST(request: NextRequest) {
  try {
    const { connectionString } = await request.json();
    
    if (!connectionString) {
      return NextResponse.json(
        { error: 'Missing connection string' },
        { status: 400 }
      );
    }

    const result = await generateSummarizedSchema(connectionString);
    return NextResponse.json({ result });
  } catch (error) {
    console.error('Schema analysis error:', error);
    return NextResponse.json(
      { error: (error as Error).message }, 
      { status: 500 }
    );
  }
}
```

**File:** `src/app/api/generate-hono/route.ts`
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { anthropic } from '@ai-sdk/anthropic';
import { generateObject } from 'ai';

// Colocated Zod schema
const workerCodeSchema = z.object({
  code: z.string().describe('The Hono worker code'),
});

// Colocated prompt
const HONO_GENERATOR_PROMPT = (summarizedSchema: string) => `
You are a Cloudflare Workers and Hono expert. Generate a complete Hono worker that implements the requested API.

Database Schema Summary:
${summarizedSchema}

Generate a Hono worker that:
1. Connects to the Neon database using the provided connection string
2. Implements the requested API endpoints
3. Uses proper error handling and validation
4. Follows Hono best practices
5. Includes proper TypeScript types
6. Uses environment variables for configuration

The worker should be production-ready and deployable to Cloudflare Workers.
`;

// Colocated generation function
async function generateHonoCode({
  summarizedSchema,
  userPrompt,
}: {
  summarizedSchema: string;
  userPrompt: string;
}) {
  const model = anthropic('claude-sonnet-4-20250514');
  
  const { object: honoCode } = await generateObject({
    model: model,
    schema: workerCodeSchema,
    system: HONO_GENERATOR_PROMPT(summarizedSchema),
    prompt: `
      Generate the Hono worker code according to this prompt: ${userPrompt}
      Don't do more than what is asked in the prompt.
    `,
  });

  return honoCode;
}

export async function POST(request: NextRequest) {
  try {
    const { summarizedSchema, prompt } = await request.json();
    
    if (!summarizedSchema || !prompt) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    const result = await generateHonoCode({ summarizedSchema, prompt });
    return NextResponse.json({ result });
  } catch (error) {
    console.error('Hono generation error:', error);
    return NextResponse.json(
      { error: (error as Error).message }, 
      { status: 500 }
    );
  }
}
```

**File:** `src/app/api/generate-fetch/route.ts`
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { anthropic } from '@ai-sdk/anthropic';
import { generateObject } from 'ai';

// Colocated Zod schema
const fetchImplementationsSchema = z.record(
  z.string().describe('The fetch implementation route ID.'),
  z.object({
    fetchImplementationFunction: z
      .string()
      .describe('The fetch implementation function'),
    fetchImplementationUsage: z
      .string()
      .describe('The fetch implementation usage example'),
  })
).describe(`
  The fetch implementations.

      Return this in the format:
      {
        "GET /api/users": {
          "fetchImplementationFunction": "...",
          "fetchImplementationUsage": "..."
        }
        "POST /api/users": {
          "fetchImplementationFunction": "...",
          "fetchImplementationUsage": "..."
        }
        "PUT /api/users/:id": {
          "fetchImplementationFunction": "...",
          "fetchImplementationUsage": "..."
        }
        "DELETE /api/users/:id": {
          "fetchImplementationFunction": "...",
          "fetchImplementationUsage": "..."
        }
      }
`);

// Colocated prompt
const FETCH_GENERATOR_PROMPT = (honoCode: string) => `
You are a JavaScript fetch API expert. Generate fetch implementations for the provided Hono worker code.

Hono Worker Code:
${honoCode}

Generate fetch implementations that:
1. Call the appropriate endpoints
2. Handle different HTTP methods (GET, POST, PUT, DELETE)
3. Include proper error handling
4. Show usage examples
5. Use modern JavaScript/TypeScript patterns
6. Include proper type definitions

For each endpoint, provide:
- A reusable fetch function
- A usage example showing how to call it
- Proper error handling
- TypeScript types where applicable
`;

// Colocated generation function
async function generateFetchImplementations({
  honoCode,
  userPrompt,
}: {
  honoCode: string;
  userPrompt: string;
}) {
  const model = anthropic('claude-sonnet-4-20250514');
  
  const { object: fetchImplementations } = await generateObject({
    model: model,
    schema: fetchImplementationsSchema,
    system: FETCH_GENERATOR_PROMPT(honoCode),
    prompt: `
      Generate the fetch implementations according to this prompt: ${userPrompt}
      Don't do more than what is asked in the prompt.
    `,
  });

  return fetchImplementations;
}

export async function POST(request: NextRequest) {
  try {
    const { honoCode, prompt } = await request.json();
    
    if (!honoCode || !prompt) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    const result = await generateFetchImplementations({ honoCode, prompt });
    return NextResponse.json({ result });
  } catch (error) {
    console.error('Fetch generation error:', error);
    return NextResponse.json(
      { error: (error as Error).message }, 
      { status: 500 }
    );
  }
}
```

**File:** `src/app/api/deploy-worker/route.ts`
```typescript
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { execSync } from 'child_process';
import toml from '@iarna/toml';

// Colocated deployment function
async function deployWorker({
  workerCode,
  connectionString,
}: {
  workerCode: string;
  connectionString: string;
}) {
  // Replace the my-hono-app index.ts file with the code content
  fs.writeFileSync('my-hono-app/src/index.ts', workerCode);
  
  // Read and parse the wrangler.toml file
  const wranglerContent = fs.readFileSync('my-hono-app/wrangler.toml', 'utf-8');
  
  // Update the DATABASE_URL
  const wranglerConfig = toml.parse(wranglerContent);
  // @ts-expect-error wrangler.toml is not typed
  wranglerConfig.vars.DATABASE_URL = connectionString;
  
  // Write the updated config back to wrangler.toml
  fs.writeFileSync('my-hono-app/wrangler.toml', toml.stringify(wranglerConfig));
  
  // Deploy to worker by executing bun deploy in the my-hono-app directory
  const output = execSync('cd my-hono-app && bun run deploy', {
    encoding: 'utf-8',
  });
  
  const urlRegex = /https:\/\/[^\s]+\.workers\.dev/;
  const workerUrl = output.match(urlRegex)?.[0];
  
  if (!workerUrl) {
    throw new Error('Failed to deploy to worker');
  }
  
  // Clean up - remove the DATABASE_URL from the wrangler.toml file
  const cleanWranglerConfig = toml.parse(wranglerContent);
  // @ts-expect-error - wrangler.toml is not typed
  delete cleanWranglerConfig.vars.DATABASE_URL;
  fs.writeFileSync('my-hono-app/wrangler.toml', toml.stringify(cleanWranglerConfig));
  
  return {
    url: workerUrl,
    workerCode: workerCode,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { workerCode, connectionString } = await request.json();
    
    if (!workerCode || !connectionString) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    const result = await deployWorker({ workerCode, connectionString });
    return NextResponse.json({ result });
  } catch (error) {
    console.error('Deployment error:', error);
    return NextResponse.json(
      { error: (error as Error).message }, 
      { status: 500 }
    );
  }
}
```

### Phase 2: Client-Side State Machine

#### 2.1 Create Client Machine
**File:** `src/app/lib/client-prompt-to-api-machine.ts`

```typescript
import { createMachine, assign, fromPromise } from 'xstate';

interface ClientContext {
  prompt: string;
  connectionString: string;
  currentStep: string;
  progress: number;
  validationResult: ValidationResult | null;
  summarizedSchema: string | null;
  workerCode: string | null;
  fetchImplementations: Record<string, any> | null;
  generatedApi: GeneratedApi | null;
  error: string | null;
}

// API call functions
const validateRequest = fromPromise(async ({ input }) => {
  const response = await fetch('/api/validate-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return response.json();
});

const analyzeSchema = fromPromise(async ({ input }) => {
  const response = await fetch('/api/analyze-schema', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return response.json();
});

const generateHono = fromPromise(async ({ input }) => {
  const response = await fetch('/api/generate-hono', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return response.json();
});

const generateFetch = fromPromise(async ({ input }) => {
  const response = await fetch('/api/generate-fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return response.json();
});

const deployWorker = fromPromise(async ({ input }) => {
  const response = await fetch('/api/deploy-worker', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return response.json();
});

export const clientPromptToApiMachine = createMachine({
  id: 'clientPromptToApi',
  types: {
    context: {} as ClientContext,
    input: {} as { prompt: string; connectionString: string },
  },
  context: ({ input }) => ({
    prompt: input.prompt,
    connectionString: input.connectionString,
    currentStep: '',
    progress: 0,
    validationResult: null,
    summarizedSchema: null,
    workerCode: null,
    fetchImplementations: null,
    generatedApi: null,
    error: null,
  }),
  initial: 'idle',
  states: {
    idle: {
      on: {
        START_GENERATION: {
          target: 'validatingRequest',
        },
      },
    },
    validatingRequest: {
      entry: assign({
        currentStep: 'Validating request compatibility...',
        progress: 10,
      }),
      invoke: {
        src: validateRequest,
        input: ({ context }) => ({
          prompt: context.prompt,
          connectionString: context.connectionString,
        }),
        onDone: {
          target: 'checkValidationResult',
          actions: assign({
            validationResult: ({ event }) => event.output.result,
            progress: 20,
          }),
        },
        onError: {
          target: 'error',
          actions: assign({
            error: ({ event }) => event.error.message,
          }),
        },
      },
    },
    checkValidationResult: {
      always: [
        {
          guard: ({ context }) => context.validationResult?.isCompatible === false,
          target: 'validationFailed',
        },
        {
          target: 'analyzingSchema',
        },
      ],
    },
    validationFailed: {
      entry: assign({
        currentStep: 'Validation failed',
        progress: 20,
      }),
    },
    analyzingSchema: {
      entry: assign({
        currentStep: 'Analyzing database schema...',
        progress: 30,
      }),
      invoke: {
        src: analyzeSchema,
        input: ({ context }) => ({
          connectionString: context.connectionString,
        }),
        onDone: {
          target: 'generatingHono',
          actions: assign({
            summarizedSchema: ({ event }) => JSON.stringify(event.output.result),
            progress: 50,
          }),
        },
        onError: {
          target: 'error',
          actions: assign({
            error: ({ event }) => event.error.message,
          }),
        },
      },
    },
    generatingHono: {
      entry: assign({
        currentStep: 'Generating Hono code...',
        progress: 60,
      }),
      invoke: {
        src: generateHono,
        input: ({ context }) => ({
          summarizedSchema: context.summarizedSchema!,
          prompt: context.prompt,
        }),
        onDone: {
          target: 'generatingFetch',
          actions: assign({
            workerCode: ({ event }) => event.output.result.code,
            progress: 80,
          }),
        },
        onError: {
          target: 'error',
          actions: assign({
            error: ({ event }) => event.error.message,
          }),
        },
      },
    },
    generatingFetch: {
      entry: assign({
        currentStep: 'Generating fetch implementations...',
        progress: 90,
      }),
      invoke: {
        src: generateFetch,
        input: ({ context }) => ({
          honoCode: context.workerCode!,
          prompt: context.prompt,
        }),
        onDone: {
          target: 'deployingWorker',
          actions: assign({
            fetchImplementations: ({ event }) => event.output.result,
            progress: 95,
          }),
        },
        onError: {
          target: 'error',
          actions: assign({
            error: ({ event }) => event.error.message,
          }),
        },
      },
    },
    deployingWorker: {
      entry: assign({
        currentStep: 'Deploying to Cloudflare...',
        progress: 95,
      }),
      invoke: {
        src: deployWorker,
        input: ({ context }) => ({
          workerCode: context.workerCode!,
          connectionString: context.connectionString,
        }),
        onDone: {
          target: 'complete',
          actions: assign({
            generatedApi: ({ event }) => event.output.result,
            progress: 100,
            currentStep: 'Complete!',
          }),
        },
        onError: {
          target: 'error',
          actions: assign({
            error: ({ event }) => event.error.message,
          }),
        },
      },
    },
    complete: {
      entry: assign({
        currentStep: 'API generation complete!',
        progress: 100,
      }),
    },
    error: {
      entry: assign({
        currentStep: 'Error occurred',
        progress: 0,
      }),
    },
  },
});
```

#### 2.2 Update React Component
**File:** `src/app/page.tsx`

```typescript
import { useActor } from '@xstate/react';
import { clientPromptToApiMachine } from '@/app/lib/client-prompt-to-api-machine';

export default function ServerBuilder() {
  const [state, send] = useActor(clientPromptToApiMachine);
  
  // Remove all local state - use machine state instead
  // const [promptInput, setPromptInput] = useState('');
  // const [isLoading, setIsLoading] = useState(false);
  // etc.
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    send({
      type: 'START_GENERATION',
      prompt: state.context.prompt,
      connectionString: state.context.connectionString,
    });
  };
  
  // Real-time progress display
  const progressPercentage = state.context.progress;
  const currentStep = state.context.currentStep;
  const isLoading = state.matches('validatingRequest') || 
                   state.matches('analyzingSchema') || 
                   state.matches('generatingHono') || 
                   state.matches('generatingFetch') || 
                   state.matches('deployingWorker');
  
  return (
    <div>
      {/* Progress bar */}
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div 
          className="bg-purple-500 h-2 rounded-full transition-all duration-300"
          style={{ width: `${progressPercentage}%` }}
        />
      </div>
      
      {/* Current step */}
      <p className="text-sm text-gray-600 mt-2">
        {currentStep}
      </p>
      
      {/* Form using machine state */}
      <form onSubmit={handleSubmit}>
        <input
          value={state.context.prompt}
          onChange={(e) => send({ type: 'UPDATE_PROMPT', prompt: e.target.value })}
          placeholder="Enter your prompt..."
        />
        <input
          value={state.context.connectionString}
          onChange={(e) => send({ type: 'UPDATE_CONNECTION_STRING', connectionString: e.target.value })}
          placeholder="Database connection string..."
        />
        <button disabled={isLoading}>
          {isLoading ? 'Generating...' : 'Generate API'}
        </button>
      </form>
      
      {/* Results using machine state */}
      {state.matches('complete') && state.context.generatedApi && (
        <div>
          {/* Display generated API */}
        </div>
      )}
      
      {state.matches('validationFailed') && state.context.validationResult && (
        <div>
          {/* Display validation errors */}
        </div>
      )}
      
      {state.matches('error') && (
        <div>
          Error: {state.context.error}
        </div>
      )}
    </div>
  );
}
```

## Migration Strategy

### Step 1: Split Server API
1. Create individual API endpoints (`/api/validate-request`, `/api/analyze-schema`, etc.)
2. Extract AI services from current state machine
3. Test each endpoint independently

### Step 2: Create Client Machine
1. Create `client-prompt-to-api-machine.ts`
2. Define all states and transitions with API calls
3. Test machine in isolation

### Step 3: Update Component
1. Replace local state with machine state
2. Update UI to use machine context
3. Test UI without server integration

### Step 4: Integration & Testing
1. Connect client machine to server endpoints
2. Test end-to-end flow
3. Add error handling and edge cases

## Benefits

### User Experience
- ✅ Real-time progress updates
- ✅ Specific loading messages for each step
- ✅ Better feedback during long operations
- ✅ Clear error states and validation feedback

### Developer Experience
- ✅ Single source of truth for state (client machine)
- ✅ Predictable state transitions
- ✅ Better error handling per step
- ✅ Easier testing and debugging
- ✅ No state duplication

### Architecture
- ✅ Secure API key handling (server-side only)
- ✅ Clean separation of concerns
- ✅ Modular API endpoints
- ✅ Maintainable and scalable code
- ✅ Standard HTTP communication

## Risks & Mitigations

### Risk: API Call Overhead
**Mitigation:** Each step is necessary, and the overhead is minimal compared to AI processing time

### Risk: Error Handling Complexity
**Mitigation:** Each API call can fail independently, making error handling more granular

### Risk: State Machine Complexity
**Mitigation:** Start with simple implementation, add features incrementally

### Risk: Network Issues
**Mitigation:** Built-in retry logic and proper error states

## Success Metrics

1. **User Experience:** Users see step-by-step progress
2. **Performance:** No significant latency increase
3. **Reliability:** Robust error handling per step
4. **Maintainability:** Clean, testable, modular code
5. **Security:** API keys remain server-side

## Timeline

- **Week 1:** Split server API + create client machine
- **Week 2:** Update React component + integration
- **Week 3:** Testing, refinement, and error handling
- **Week 4:** Production deployment and monitoring

## Next Steps

1. Review and approve this plan
2. Create individual API endpoints
3. Extract AI services from current state machine
4. Create client-side XState machine
5. Update React component to use machine state
6. Test and refine the implementation
