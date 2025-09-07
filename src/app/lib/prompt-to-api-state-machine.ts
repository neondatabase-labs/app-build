import { assign, fromCallback, fromPromise, setup, log } from 'xstate';
import { z } from 'zod';
import { neon } from '@neondatabase/serverless';
import { anthropic } from '@ai-sdk/anthropic';
import {
  FETCH_GENERATOR_PROMPT,
  HONO_GENERATOR_PROMPT,
  SCHEMA_ANALYSIS_SYSTEM_PROMPT,
  REQUEST_VALIDATION_PROMPT,
} from './prompt-api-prompts';
import { generateObject } from 'ai';

// Define the context type
interface ApiToPromptContext {
  connectionString: string;
  prompt: string;
  validationResult: {
    isCompatible: boolean;
    compatibilityIssues: string[];
    requiredTables: string[];
    missingTables: string[];
    requiredColumns: Record<string, string[]>;
    missingColumns: Record<string, string[]>;
    suggestions: string[];
    suggestionsSQL: string[];
  } | null;
  summarizedSchema: string | null;
  workerCode: { code: string } | null;
  fetchImplementations: Record<
    string,
    {
      fetchImplementationFunction: string;
      fetchImplementationUsage: string;
    }
  > | null;
  error: string | null;
}

// Define the input type
interface ApiToPromptInput {
  connectionString: string;
  prompt: string;
}

const model = anthropic('claude-sonnet-4-20250514');

function getRandomAnalysisPhrase() {
  const phrases = [
    'Analyzing database schema...',
    'Mapping relationships...',
    'Discovering table structures...',
    'Examining constraints...',
    'Documenting database architecture...',
  ];
  return phrases[Math.floor(Math.random() * phrases.length)]!;
}

function getRandomHonoGenerationPhrase() {
  const phrases = [
    'Generating Hono code...',
    'Crafting API endpoints...',
    'Building database interfaces...',
    'Constructing REST routes...',
    'Preparing Hono code...',
  ];
  return phrases[Math.floor(Math.random() * phrases.length)]!;
}

function getRandomFetchGenerationPhrase() {
  const phrases = [
    'Generating fetch implementations...',
    'Crafting fetch implementations...',
    'Building fetch implementations...',
    'Constructing fetch implementations...',
    'Preparing fetch implementations...',
  ];
  return phrases[Math.floor(Math.random() * phrases.length)]!;
}

// Loading animation in terminal
const loader = fromCallback(({ input }: { input: string }) => {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const timer = setInterval(() => {
    process.stdout.write(`\r${frames[i]} ${input}`);
    i = (i + 1) % frames.length;
  }, 100);

  return () => {
    clearInterval(timer);
    process.stdout.write('\n');
  };
});

const validationResultSchema = z.object({
  isCompatible: z
    .boolean()
    .describe(
      'Whether the user request is compatible with the database schema'
    ),
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

const workerCodeSchema = z.object({
  code: z.string().describe('The Hono worker code'),
});

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

async function validateRequest({
  databaseConnectionString,
  userPrompt,
}: {
  databaseConnectionString: string;
  userPrompt: string;
}) {
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

async function generateSummarizedSchema(databaseConnectionString: string) {
  const rawSchema = await getDatabaseSchema(databaseConnectionString);

  const { object: summarizedSchema } = await generateObject({
    model: model,
    temperature: 0,
    schema: z.object({
      summarizedSchema: summarizedSchemaSchema.nullable(),
    }),
    system: SCHEMA_ANALYSIS_SYSTEM_PROMPT(JSON.stringify(rawSchema)),
    prompt:
      'Analyze the database schema and provide a summarized LLM friendly version',
  });

  return summarizedSchema;
}

async function generateHonoCode({
  summarizedSchema,
  userPrompt,
}: {
  summarizedSchema: string;
  userPrompt: string;
}) {
  const { object: honoCode } = await generateObject({
    model: model,
    schema: workerCodeSchema,
    system: HONO_GENERATOR_PROMPT(summarizedSchema),
    prompt: `
      Generate the Hono worker code and fetch implementations according to this prompt: ${userPrompt}
                        Don't do more than what is asked in the prompt.
    `,
  });

  return honoCode;
}

async function generateFetchImplementations({
  honoCode,
  userPrompt,
}: {
  honoCode: string;
  userPrompt: string;
}) {
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

export const apiToPromptMachine = setup({
  types: {
    context: {} as ApiToPromptContext,
    input: {} as ApiToPromptInput,
  },
  actors: {
    loader,
    validateRequest: fromPromise(
      ({
        input,
      }: {
        input: { connectionString: string; userPrompt: string };
      }) => {
        if (!input.connectionString) {
          throw new Error('Connection string is required');
        }
        if (!input.userPrompt) {
          throw new Error('User prompt is required');
        }
        return validateRequest({
          databaseConnectionString: input.connectionString,
          userPrompt: input.userPrompt,
        });
      }
    ),
    generateSummarizedSchema: fromPromise(
      ({ input }: { input: { connectionString: string } }) => {
        if (!input.connectionString) {
          throw new Error('Connection string is required');
        }
        return generateSummarizedSchema(input.connectionString);
      }
    ),
    generateHonoCode: fromPromise(
      ({
        input,
      }: {
        input: { summarizedSchema: string; userPrompt: string };
      }) => {
        return generateHonoCode({
          summarizedSchema: input.summarizedSchema,
          userPrompt: input.userPrompt,
        });
      }
    ),
    generateFetchImplementations: fromPromise(
      ({ input }: { input: { honoCode: string; userPrompt: string } }) => {
        return generateFetchImplementations({
          honoCode: input.honoCode,
          userPrompt: input.userPrompt,
        });
      }
    ),
  },
}).createMachine({
  id: 'schemaCode',
  context: ({ input }): ApiToPromptContext => ({
    connectionString: input.connectionString,
    prompt: input.prompt,
    validationResult: null,
    summarizedSchema: null,
    workerCode: null,
    fetchImplementations: null,
    error: null,
  }),
  initial: 'idle',
  states: {
    idle: {
      entry: log('Starting request validation and code generation...'),
      on: {
        start: { target: 'validatingRequest' },
      },
    },
    validatingRequest: {
      invoke: [
        {
          src: 'validateRequest',
          input: ({ context }) => ({
            connectionString: context.connectionString,
            userPrompt: context.prompt,
          }),
          onDone: {
            target: 'checkValidationResult',
            actions: [
              assign({
                validationResult: ({ event }) => event.output,
              }),
              log('Request validation complete!'),
            ],
          },
          onError: {
            target: 'error',
            actions: [
              assign({
                error: ({ event }) => (event.error as Error).message,
              }),
              log(
                ({ event }) =>
                  `Error validating request: ${(event.error as Error).message}`
              ),
            ],
          },
        },
        {
          src: 'loader',
          input: 'Validating request compatibility...',
        },
      ],
    },
    checkValidationResult: {
      always: [
        {
          guard: ({ context }) =>
            context.validationResult?.isCompatible === false,
          target: 'validationFailed',
        },
        {
          target: 'analyzingSchema',
        },
      ],
    },
    validationFailed: {
      entry: [
        log(({ context }) => '❌ Request validation failed!'),
        log(({ context }) => 'Compatibility Issues:'),
        log(
          ({ context }) =>
            context.validationResult?.compatibilityIssues?.join('\n') || ''
        ),
        log(({ context }) => 'Suggestions:'),
        log(
          ({ context }) =>
            context.validationResult?.suggestions?.join('\n') || ''
        ),
        log(({ context }) => 'SQL to Fix Issues:'),
        log(
          ({ context }) =>
            context.validationResult?.suggestionsSQL?.join('\n\n') || ''
        ),
      ],
      type: 'final',
    },
    analyzingSchema: {
      invoke: [
        {
          src: 'generateSummarizedSchema',
          input: ({ context }) => ({
            connectionString: context.connectionString,
          }),
          onDone: {
            target: 'generatingHono',
            actions: [
              assign({
                summarizedSchema: ({ event }) => JSON.stringify(event.output),
              }),
              log('Schema analysis complete!'),
            ],
          },
          onError: {
            target: 'error',
            actions: [
              assign({
                error: ({ event }) => (event.error as Error).message,
              }),
              log(
                ({ event }) =>
                  `Error analyzing schema: ${(event.error as Error).message}`
              ),
            ],
          },
        },
        {
          src: 'loader',
          input: getRandomAnalysisPhrase,
        },
      ],
    },
    generatingHono: {
      invoke: [
        {
          src: 'generateHonoCode',
          input: ({ context }) => ({
            summarizedSchema: context.summarizedSchema!,
            userPrompt: context.prompt,
          }),
          onDone: {
            target: 'generatingFetch',
            actions: [
              assign({
                workerCode: ({ event }) => event.output,
              }),
              log('Hono generation complete!'),
            ],
          },
          onError: {
            target: 'error',
            actions: [
              assign({
                error: ({ event }) => (event.error as Error).message,
              }),
              log(
                ({ event }) =>
                  `Error generating Hono code: ${
                    (event.error as Error).message
                  }`
              ),
            ],
          },
        },
        {
          src: 'loader',
          input: getRandomHonoGenerationPhrase,
        },
      ],
    },
    generatingFetch: {
      invoke: [
        {
          src: 'generateFetchImplementations',
          input: ({ context }) => ({
            honoCode: JSON.stringify(context.workerCode),
            userPrompt: context.prompt,
          }),
          onDone: {
            target: 'complete',
            actions: [
              assign({
                fetchImplementations: ({ event }) => event.output,
              }),
              log('Fetch generation complete!'),
            ],
          },
          onError: {
            target: 'error',
            actions: [
              assign({
                error: ({ event }) => (event.error as Error).message,
              }),
              log(
                ({ event }) =>
                  `Error generating fetch implementations: ${
                    (event.error as Error).message
                  }`
              ),
            ],
          },
        },
        {
          src: 'loader',
          input: getRandomFetchGenerationPhrase,
        },
      ],
    },
    complete: {
      entry: [
        log(({ context }) => '\n✅ Request validation passed!'),
        log(({ context }) => '\nSchema Analysis:'),
        log(({ context }) => JSON.stringify(context.summarizedSchema, null, 2)),
        log(({ context }) => '\nGenerated Hono Code:'),
        log(({ context }) => JSON.stringify(context.workerCode, null, 2)),
        log(({ context }) => '\nGenerated Fetch Implementations:'),
        log(({ context }) =>
          JSON.stringify(context.fetchImplementations, null, 2)
        ),
      ],
      type: 'final',
    },
    error: {
      entry: log(({ context }) => `\nError: ${context.error}`),
      type: 'final',
    },
  },
  exit: () => {},
});
