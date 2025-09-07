import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { execSync } from 'child_process';
import toml from '@iarna/toml';
import { waitFor } from 'xstate';
import { apiToPromptMachine } from '../../lib/prompt-to-api-state-machine';
import { createActor } from 'xstate';

// how to include files in the server bundle: https://github.com/vercel/next.js/discussions/70125
export async function POST(request: NextRequest) {
  try {
    const { prompt, connectionString } = await request.json();

    if (!prompt || !connectionString) {
      return NextResponse.json(
        {
          result: {
            error: 'Invalid request, required parameters missing',
          },
        },
        { status: 400 }
      );
    }

    // Start the machine
    const actor = createActor(apiToPromptMachine, {
      input: {
        connectionString,
        prompt,
      },
    });

    actor.start();
    actor.send({ type: 'start' });
    const result = await waitFor(
      actor,
      (snapshot) =>
        snapshot.matches('complete') ||
        snapshot.matches('validationFailed') ||
        snapshot.matches('error')
    );
    const { workerCode, fetchImplementations, validationResult, error } =
      result.context;
    actor.stop();

    // Handle validation failure
    if (result.matches('validationFailed') && validationResult) {
      return NextResponse.json({
        result: {
          validationFailed: true,
          validationResult: validationResult,
        },
      });
    }

    // Handle general error
    if (result.matches('error') || error) {
      return NextResponse.json({
        result: {
          rejection: error || 'An unexpected error occurred',
        },
      });
    }

    if (!workerCode?.code || !fetchImplementations) {
      return NextResponse.json({
        result: {
          error: 'Failed to generate worker code or fetch implementations',
          workerCode,
          fetchImplementations,
        },
      });
    }

    // replace the my-hono-app index.ts file with the code content
    fs.writeFileSync('my-hono-app/src/index.ts', workerCode.code);
    // Read and parse the wrangler.toml file
    const wranglerContent = fs.readFileSync(
      'my-hono-app/wrangler.toml',
      'utf-8'
    );

    // Update the DATABASE_URL
    const wranglerConfig = toml.parse(wranglerContent);
    // @ts-expect-error wrangler.toml is not typed
    wranglerConfig.vars.DATABASE_URL = connectionString;

    // Write the updated config back to wrangler.toml
    fs.writeFileSync(
      'my-hono-app/wrangler.toml',
      toml.stringify(wranglerConfig)
    );

    // deploy to worker by executing bun deploy in the my-hono-app directory
    const output = execSync('cd my-hono-app && bun run deploy', {
      encoding: 'utf-8',
    });

    const urlRegex = /https:\/\/[^\s]+\.workers\.dev/;
    const workerUrl = output.match(urlRegex)?.[0];

    if (!workerUrl) {
      return NextResponse.json(
        {
          result: {
            error: 'Failed to deploy to worker',
          },
        },
        { status: 500 }
      );
    }

    // replace the PLACEHOLDER_WORKER_URL with the workerUrl
    Object.entries(fetchImplementations).forEach(([route, implementation]) => {
      fetchImplementations[route] = {
        ...implementation,
        fetchImplementationFunction:
          implementation.fetchImplementationFunction.replaceAll(
            'PLACEHOLDER_WORKER_URL',
            workerUrl
          ),
      };
    });

    return NextResponse.json({
      result: {
        url: workerUrl,
        fetchImplementations: fetchImplementations,
        workerCode: workerCode.code,
      },
    });
  } catch (error: Error | unknown) {
    return NextResponse.json({
      result: {
        error: (error as Error).message,
      },
    });
  } finally {
    // remove the DATABASE_URL from the wrangler.toml file
    const wranglerContent = fs.readFileSync(
      'my-hono-app/wrangler.toml',
      'utf-8'
    );
    const wranglerConfig = toml.parse(wranglerContent);
    // @ts-expect-error - wrangler.toml is not typed
    delete wranglerConfig.vars.DATABASE_URL;
    fs.writeFileSync(
      'my-hono-app/wrangler.toml',
      toml.stringify(wranglerConfig)
    );
  }
}

type JSONResponse = Awaited<ReturnType<typeof POST>>;
export type PromptToApiResponse = JSONResponse extends NextResponse<infer T>
  ? T
  : never;
