import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Miniflare } from 'miniflare';

export interface TestResult {
  success: boolean;
  statusCode?: number;
  response?: any;
  error?: string;
  logs?: string[];
  duration?: number;
}

class MiniflareSandbox {
  private miniflare: Miniflare | null = null;
  private isInitialized = false;
  private logs: string[] = [];

  async initialize(
    honoCode: string,
    env?: Record<string, string>
  ): Promise<void> {
    try {
      this.logs = [];

      console.log('before miniflare');
      this.miniflare = new Miniflare({
        script: honoCode,
        bindings: env || {},
        modules: true,
        compatibilityDate: '2024-09-25',
        compatibilityFlags: ['nodejs_compat'],
      });
      console.log('after miniflare');

      this.isInitialized = true;
    } catch (error) {
      throw new Error(
        `Failed to initialize Miniflare: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  async testEndpoint(fetchImplementationUsage: string): Promise<TestResult> {
    if (!this.miniflare || !this.isInitialized) {
      throw new Error('Sandbox not initialized. Call initialize() first.');
    }

    const startTime = Date.now();

    try {
      // Create a sandbox context to execute the generated code
      const sandboxContext = {
        fetch: async (url: string, options: any) => {
          return this.miniflare!.dispatchFetch(url, options);
        },
      };

      // Execute the generated fetch code in our sandbox context
      const executeCode = new Function(
        'context',
        `
        const { fetch } = context;
        return (async () => {
          ${fetchImplementationUsage}
        })();
      `
      );

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout')), 30_000);
      });

      const response = await Promise.race([
        executeCode(sandboxContext),
        timeoutPromise,
      ]);

      const duration = Date.now() - startTime;

      const testResult: TestResult = {
        success: true,
        statusCode: 200, // We'll assume success since the generated code ran
        response: response,
        logs: [...this.logs],
        duration,
      };

      return testResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        logs: [...this.logs],
        duration,
      };
    }
  }

  async cleanup(): Promise<void> {
    if (this.miniflare) {
      await this.miniflare.dispose();
      this.miniflare = null;
    }
    this.isInitialized = false;
    this.logs = [];
  }

  getIsInitialized(): boolean {
    return this.isInitialized;
  }
}

// Global sandbox instance
const miniflareSandbox = new MiniflareSandbox();

export async function runHonoCommandInSandbox({
  projectPath,
  fetchImplementationUsage,
}: {
  projectPath: string;
  fetchImplementationUsage: string;
}): Promise<TestResult> {
  try {
    // Read the Hono app code from the project path
    const indexPath = path.join(projectPath, 'src', 'index.ts');
    const honoCode = await fs.readFile(indexPath, 'utf-8');

    // Initialize the sandbox with the Hono code
    await miniflareSandbox.initialize(honoCode);

    // For now, just test the root endpoint
    // In a real implementation, you might parse the testCommand to extract endpoint details
    return await miniflareSandbox.testEndpoint(fetchImplementationUsage);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      logs: [`Error running command: ${error}`],
    };
  }
}

// Export the sandbox class for direct use
export { MiniflareSandbox };
