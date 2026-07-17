export interface MemoryPathSearchResult {
  content: string;
  data: Record<string, unknown>;
  isError?: boolean;
}

export interface MemoryPathSearchOptions {
  query: string;
  searchInFiles?: boolean;
  directory?: string;
  memoryPath?: string;
}

export function getDefaultOpenLoomiAppDataDir(env?: NodeJS.ProcessEnv): string;

export function getDefaultMemoryPath(env?: NodeJS.ProcessEnv): string;

export function searchMemoryPath(
  options: MemoryPathSearchOptions,
): MemoryPathSearchResult;

export function splitSearchKeywords(query: string): string[];
