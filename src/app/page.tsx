'use client';

import { PromptToApiResponse } from '@/app/api/prompt-to-api/route';
import { useState, useEffect } from 'react';

const RECOMMENDED_PROMPTS = [
  {
    label: '📊 User Analytics',
    prompt:
      'Create an API that shows active users with their total transactions, using a window function to rank them by spend.',
    featured: true,
  },
  {
    label: '📈 Growth Stats',
    prompt:
      'Build a daily cron job that uses date_trunc to aggregate user signups by week and store the results.',
  },
  {
    label: '🔍 Full-text Search',
    prompt:
      'Create an endpoint that uses PostgreSQL full-text search to find products by description and tags.',
  },
  {
    label: '📅 Metrics Job',
    prompt:
      'Create a weekly job that calculates user cohort retention using generate_series and window functions.',
  },
];

const LOADING_MESSAGES = [
  '🔍 Validating request compatibility with database schema...',
  '🤔 Analyzing your database query requirements...',
  '📝 Designing the API schema...',
  '⚡ Generating Cloudflare Worker code...',
  '🔒 Adding authentication and rate limiting...',
  '🚀 Deploying to Cloudflare...',
];

type ActiveTab = {
  section: 'fetch' | 'worker';
  route?: string;
};

export default function ServerBuilder() {
  const [promptInput, setPromptInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [dbConnectionString, setDbConnectionString] = useState('');
  const [generatedApi, setGeneratedApi] = useState<{
    url: string;
    fetchImplementations: Record<
      string,
      {
        fetchImplementationFunction: string;
        fetchImplementationUsage: string;
      }
    >;
    workerCode: string;
    rejection: string;
  } | null>(null);
  const [validationError, setValidationError] = useState<{
    isCompatible: boolean;
    compatibilityIssues: string[];
    requiredTables: string[];
    missingTables: string[];
    requiredColumns: Record<string, string[]>;
    missingColumns: Record<string, string[]>;
    suggestions: string[];
    suggestionsSQL: string[];
  } | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>({ section: 'fetch' });
  const [apiResponse, setApiResponse] = useState<{
    message: string;
    status: number;
  } | null>(null);
  const isInputValid =
    promptInput.trim().length >= 10 && dbConnectionString.trim().length > 0;

  useEffect(() => {
    if (!isLoading) {
      setLoadingMessageIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setLoadingMessageIndex((current) =>
        current === LOADING_MESSAGES.length - 1 ? current : current + 1
      );
    }, 8_000);

    return () => clearInterval(interval);
  }, [isLoading]);

  const activeRoute =
    activeTab.section === 'fetch' &&
    !activeTab.route &&
    generatedApi?.fetchImplementations
      ? Object.keys(generatedApi.fetchImplementations)[0]
      : activeTab.route;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isInputValid || isLoading) return;

    // Reset all states
    setIsLoading(true);
    setGeneratedApi(null);
    setValidationError(null);
    setApiResponse(null);
    setActiveTab({ section: 'fetch' });
    setLoadingMessageIndex(0);

    try {
      const response = await fetch('/api/prompt-to-api', {
        method: 'POST',
        body: JSON.stringify({
          prompt: promptInput,
          connectionString: dbConnectionString,
        }),
      });
      const data = (await response.json()) as PromptToApiResponse;

      // Handle validation failure
      if ('validationFailed' in data.result && data.result.validationFailed) {
        setValidationError(data.result.validationResult);
        return;
      }

      if ('error' in data.result) {
        setApiResponse({ message: data.result.error, status: 500 });
        return;
      }

      if ('rejection' in data.result) {
        setApiResponse({ message: data.result.rejection, status: 500 });
        return;
      }

      if (
        'url' in data.result &&
        'fetchImplementations' in data.result &&
        'workerCode' in data.result
      ) {
        const { url, fetchImplementations, workerCode } = data.result;
        setGeneratedApi({
          url,
          fetchImplementations,
          workerCode,
          rejection: '',
        });
      }
    } catch (error) {
      console.error('Failed to generate app:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePromptClick = (prompt: string) => {
    setPromptInput(prompt);
  };

  const handleRunApi = async ({
    implementation,
    usageExample,
  }: {
    implementation: string;
    usageExample: string;
  }) => {
    try {
      const response = await eval(`
        (async () => {
          ${implementation}
          ${usageExample}
        })()
      `);

      if ('error' in response) {
        setApiResponse({ message: response, status: response.status });
        return;
      } else {
        setApiResponse({ message: response, status: 200 });
      }
    } catch {
      setApiResponse({ message: 'Error running API', status: 500 });
    }
  };

  return (
    <div className="min-h-screen bg-[#fafafa] dark:bg-[#0F0F0F] text-[#1A1A1A] dark:text-[#FAFAFA]">
      <div className="max-w-6xl mx-auto px-4 py-16">
        <header className="mb-12">
          <h1 className="text-3xl font-medium tracking-tight mb-3">
            Prompt to API
          </h1>
          <p className="text-[#666666] dark:text-[#888888]">
            Turn prompts into serverless APIs powered by your Neon database
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="space-y-6">
            <div className="p-4 border border-purple-500/20 bg-purple-500/5 rounded-lg">
              <h3 className="text-sm font-medium text-purple-600 dark:text-purple-400 mb-2">
                ⚡ Featured Template
              </h3>
              <p className="text-sm mb-3">
                Try our most popular template: A serverless API that leverages
                PostgreSQL&apos;s advanced analytics features on your Neon
                database.
              </p>
              <button
                onClick={() => handlePromptClick(RECOMMENDED_PROMPTS[0].prompt)}
                disabled={isLoading}
                className="text-sm px-4 py-2 bg-purple-500 text-white rounded-md hover:bg-purple-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Use Analytics Template
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="dbConnectionString"
                    className="block text-sm font-medium mb-2 text-[#666666] dark:text-[#888888]"
                  >
                    Database Connection String
                    <span className="text-red-500 ml-1">*</span>
                  </label>
                  <div className="relative">
                    <input
                      id="dbConnectionString"
                      type="text"
                      value={dbConnectionString}
                      onChange={(e) => setDbConnectionString(e.target.value)}
                      placeholder="postgresql://username:password@host/database"
                      disabled={isLoading}
                      className="w-full px-4 h-10 rounded-lg border border-[#E5E5E5] dark:border-[#333333] bg-white dark:bg-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <span className="text-xs text-[#666666] dark:text-[#888888]">
                        PostgreSQL
                      </span>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-[#666666] dark:text-[#888888]">
                    Your database connection string will be used to create and
                    manage your database. Get it from{' '}
                    <a
                      href="https://console.neon.tech/app/projects"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-purple-500 hover:text-purple-600"
                    >
                      Neon Console
                    </a>
                  </p>
                </div>
              </div>

              <div>
                <label
                  htmlFor="prompt"
                  className="block text-sm font-medium mb-2 text-[#666666] dark:text-[#888888]"
                >
                  Describe Your API
                </label>
                <textarea
                  id="prompt"
                  value={promptInput}
                  onChange={(e) => setPromptInput(e.target.value)}
                  placeholder="Example: Get top 10 users by order count in the last month"
                  disabled={isLoading}
                  className="w-full h-32 px-4 py-3 rounded-lg border border-[#E5E5E5] dark:border-[#333333] bg-white dark:bg-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>

              <div className="flex items-center space-y-2 gap-4">
                <button
                  type="submit"
                  disabled={!isInputValid || isLoading}
                  className="inline-flex items-center justify-center h-10 px-6 font-medium text-white bg-[#2E2E2E] dark:bg-[#FAFAFA] dark:text-[#1A1A1A] rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed relative min-w-[200px]"
                >
                  {isLoading ? (
                    <>
                      <span className="opacity-0">Generate API</span>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div
                          className="w-5 h-5 border-[3px] border-white/25 dark:border-black/25 border-t-white dark:border-t-black rounded-full animate-spin"
                          style={{ animationDuration: '0.6s' }}
                        />
                      </div>
                    </>
                  ) : (
                    'Generate API'
                  )}
                </button>

                {isLoading && (
                  <div className="flex justify-center">
                    <span className="text-sm text-center text-[#666666] dark:text-[#888888]">
                      {LOADING_MESSAGES[loadingMessageIndex]}
                    </span>
                  </div>
                )}
              </div>
            </form>

            <div className="space-y-3">
              <h3 className="text-sm font-medium text-[#666666] dark:text-[#888888]">
                Try these templates
              </h3>
              <div className="flex flex-wrap gap-2">
                {RECOMMENDED_PROMPTS.slice(1).map((item, index) => (
                  <button
                    key={index}
                    onClick={() => handlePromptClick(item.prompt)}
                    disabled={isLoading}
                    className="text-sm px-3 py-1.5 rounded-full bg-[#E5E5E5] dark:bg-[#333333] text-[#666666] dark:text-[#888888] hover:bg-[#D5D5D5] dark:hover:bg-[#404040] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-[#1A1A1A] rounded-xl border border-[#E5E5E5] dark:border-[#333333] p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">API Preview</h2>
                {generatedApi?.fetchImplementations && (
                  <span className="flex items-center px-1.5 py-0.5 text-[11px] font-medium text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30 rounded-full">
                    <span className="w-1 h-1 bg-green-500 rounded-full mr-1.5"></span>
                    Ready
                  </span>
                )}
              </div>
            </div>

            <div className="font-mono text-sm overflow-hidden bg-[#FAFAFA] dark:bg-[#161616] rounded-lg border border-[#E5E5E5] dark:border-[#333333]">
              {validationError ? (
                <div className="p-6">
                  <div className="flex items-start gap-3 text-red-600 dark:text-red-500">
                    <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                      >
                        <path
                          d="M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM8 4v4"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <circle
                          cx="8"
                          cy="11"
                          r="0.5"
                          fill="currentColor"
                          stroke="currentColor"
                        />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h3 className="text-sm font-medium mb-3">
                        ❌ Request Not Compatible with Database Schema
                      </h3>

                      <div className="space-y-4">
                        <div>
                          <h4 className="text-xs font-medium text-red-600 dark:text-red-400 mb-2">
                            Compatibility Issues:
                          </h4>
                          <ul className="text-xs space-y-1">
                            {validationError.compatibilityIssues.map(
                              (issue, index) => (
                                <li key={index} className="flex items-start">
                                  <span className="text-red-500 mr-2">•</span>
                                  <span>{issue}</span>
                                </li>
                              )
                            )}
                          </ul>
                        </div>

                        <div>
                          <h4 className="text-xs font-medium text-red-600 dark:text-red-400 mb-2">
                            Suggestions:
                          </h4>
                          <ul className="text-xs space-y-1">
                            {validationError.suggestions.map(
                              (suggestion, index) => (
                                <li key={index} className="flex items-start">
                                  <span className="text-blue-500 mr-2">•</span>
                                  <span>{suggestion}</span>
                                </li>
                              )
                            )}
                          </ul>
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-xs font-medium text-red-600 dark:text-red-400">
                              SQL to Fix Issues:
                            </h4>
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(
                                    validationError.suggestionsSQL.join('\n\n')
                                  );
                                  // You could add a toast notification here
                                }}
                                className="text-xs px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                              >
                                Copy SQL
                              </button>
                              <button
                                onClick={() => {
                                  setValidationError(null);
                                  handleSubmit(new Event('submit') as any);
                                }}
                                className="text-xs px-2 py-1 bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
                              >
                                Try Again
                              </button>
                            </div>
                          </div>
                          <div className="bg-[#F0F0F0] dark:bg-[#1A1A1A] rounded-md p-3">
                            <pre className="text-xs leading-relaxed whitespace-pre-wrap break-words">
                              {validationError.suggestionsSQL.join('\n\n')}
                            </pre>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : generatedApi ? (
                generatedApi.rejection ? (
                  <div className="p-6">
                    <div className="flex items-start gap-3 text-amber-600 dark:text-amber-500">
                      <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 16 16"
                          fill="none"
                        >
                          <path
                            d="M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM8 4v4"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <circle
                            cx="8"
                            cy="11"
                            r="0.5"
                            fill="currentColor"
                            stroke="currentColor"
                          />
                        </svg>
                      </div>
                      <div>
                        <h3 className="text-sm font-medium mb-1">
                          Unable to Generate API
                        </h3>
                        <pre className="text-xs leading-relaxed opacity-90 font-sans whitespace-pre-wrap break-words max-w-[500px]">
                          {generatedApi.rejection}
                        </pre>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex border-b border-[#E5E5E5] dark:border-[#333333]">
                      <button
                        onClick={() => setActiveTab({ section: 'fetch' })}
                        className={`px-4 py-2 text-xs font-medium transition-colors relative whitespace-nowrap ${
                          activeTab.section === 'fetch'
                            ? 'text-purple-500 dark:text-purple-400'
                            : 'text-[#666666] dark:text-[#888888] hover:text-[#333333] dark:hover:text-[#AAAAAA]'
                        }`}
                      >
                        Fetch
                        {activeTab.section === 'fetch' && (
                          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-500"></div>
                        )}
                      </button>
                      <button
                        onClick={() => setActiveTab({ section: 'worker' })}
                        className={`px-4 py-2 text-xs font-medium transition-colors relative whitespace-nowrap ${
                          activeTab.section === 'worker'
                            ? 'text-purple-500 dark:text-purple-400'
                            : 'text-[#666666] dark:text-[#888888] hover:text-[#333333] dark:hover:text-[#AAAAAA]'
                        }`}
                      >
                        Worker
                        {activeTab.section === 'worker' && (
                          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-500"></div>
                        )}
                      </button>
                    </div>

                    {activeTab.section === 'fetch' && (
                      <div className="flex border-b border-[#E5E5E5] dark:border-[#333333] overflow-x-auto bg-[#FAFAFA] dark:bg-[#1A1A1A]">
                        {Object.keys(
                          generatedApi?.fetchImplementations || {}
                        ).map((route) => (
                          <button
                            key={route}
                            onClick={() =>
                              setActiveTab({ section: 'fetch', route })
                            }
                            className={`px-3 py-1.5 text-xs font-medium transition-colors relative whitespace-nowrap ${
                              activeRoute === route
                                ? 'text-purple-500 dark:text-purple-400'
                                : 'text-[#666666] dark:text-[#888888] hover:text-[#333333] dark:hover:text-[#AAAAAA]'
                            }`}
                          >
                            {route}
                            {activeRoute === route && (
                              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-500"></div>
                            )}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="divide-y divide-[#E5E5E5] dark:divide-[#333333]">
                      {activeTab.section === 'worker' ? (
                        <div className="p-4">
                          <div className="flex items-center justify-between mb-3">
                            <h3 className="text-xs font-medium text-[#666666] dark:text-[#888888]">
                              Cloudflare Worker
                            </h3>
                          </div>
                          <pre className="text-xs leading-relaxed overflow-x-auto p-3 bg-[#F0F0F0] dark:bg-[#1A1A1A] rounded-md">
                            {generatedApi?.workerCode}
                          </pre>
                        </div>
                      ) : (
                        <div className="p-4">
                          <div className="flex items-center justify-between mb-3">
                            <h3 className="text-xs font-medium text-[#666666] dark:text-[#888888]">
                              {activeRoute}
                            </h3>
                            <button
                              onClick={() =>
                                activeRoute &&
                                handleRunApi({
                                  implementation:
                                    generatedApi?.fetchImplementations[
                                      activeRoute
                                    ].fetchImplementationFunction,
                                  usageExample:
                                    generatedApi?.fetchImplementations[
                                      activeRoute
                                    ].fetchImplementationUsage,
                                })
                              }
                              className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-white bg-purple-500 hover:bg-purple-600 rounded-md transition-colors"
                            >
                              <span className="mr-1.5">▶</span> Run API
                            </button>
                          </div>
                          <pre className="text-xs leading-relaxed overflow-x-auto p-3 bg-[#F0F0F0] dark:bg-[#1A1A1A] rounded-md">
                            {activeRoute &&
                              generatedApi?.fetchImplementations[activeRoute]
                                .fetchImplementationFunction}

                            {`\n\n`}
                            {activeRoute &&
                              generatedApi?.fetchImplementations[activeRoute]
                                .fetchImplementationUsage}
                          </pre>

                          {Boolean(apiResponse) && (
                            <div className="mt-4">
                              <div className="flex items-center gap-2 mb-3">
                                <h3 className="text-xs font-medium text-[#666666] dark:text-[#888888]">
                                  Response
                                </h3>
                                <span className="px-1.5 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30 rounded-full">
                                  {apiResponse?.status}
                                </span>
                              </div>
                              <pre className="text-xs leading-relaxed overflow-x-auto p-3 bg-[#F0F0F0] dark:bg-[#1A1A1A] rounded-md">
                                {JSON.stringify(apiResponse?.message, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              ) : (
                <div className="flex flex-col items-center justify-center h-64 text-center p-4">
                  <div className="w-12 h-12 mb-4 rounded-full bg-[#F0F0F0] dark:bg-[#222222] flex items-center justify-center">
                    <span className="text-lg">⚡</span>
                  </div>
                  <p className="text-sm text-[#666666] dark:text-[#888888] mb-1">
                    {isLoading ? 'Generating API...' : 'No API Generated Yet'}
                  </p>
                  <p className="text-xs text-[#999999] dark:text-[#666666]">
                    {isLoading
                      ? 'This might take a few seconds'
                      : 'Enter a prompt to generate your API'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
