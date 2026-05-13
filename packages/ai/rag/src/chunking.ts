/**
 * Text chunking utilities for RAG
 */

import { estimateTokens } from "@openloomi/shared";

export interface ChunkOptions {
  maxChunkSize?: number; // Maximum characters per chunk
  chunkOverlap?: number; // Overlap between chunks
  separator?: string; // Separator to split on
}

export interface TextChunk {
  content: string;
  index: number;
  startPosition: number;
  endPosition: number;
}

const DEFAULT_OPTIONS: Required<ChunkOptions> = {
  maxChunkSize: 1000, // 1000 characters per chunk
  chunkOverlap: 200, // 200 characters overlap
  separator: "\n\n", // Split on paragraphs
};

/**
 * Split text into chunks with overlap
 */
export function chunkText(
  text: string,
  options: ChunkOptions = {},
): TextChunk[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const chunks: TextChunk[] = [];

  const cleanText = text.trim();

  if (cleanText.length <= opts.maxChunkSize) {
    return [
      {
        content: cleanText,
        index: 0,
        startPosition: 0,
        endPosition: cleanText.length,
      },
    ];
  }

  const paragraphs = cleanText.split(opts.separator);
  const processedChunks: string[] = [];
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    const trimmedParagraph = paragraph.trim();

    if (
      currentChunk.length + trimmedParagraph.length + opts.separator.length >
        opts.maxChunkSize &&
      currentChunk.length > 0
    ) {
      processedChunks.push(currentChunk.trim());

      const overlapText = getOverlapText(
        currentChunk,
        opts.chunkOverlap,
        opts.separator,
      );
      currentChunk = overlapText + opts.separator + trimmedParagraph;
    } else {
      if (currentChunk.length > 0) {
        currentChunk += opts.separator + trimmedParagraph;
      } else {
        currentChunk = trimmedParagraph;
      }
    }
  }

  if (currentChunk.length > 0) {
    processedChunks.push(currentChunk.trim());
  }

  const finalChunks: string[] = [];
  for (const chunk of processedChunks) {
    if (chunk.length > opts.maxChunkSize) {
      const sentences = chunk.match(/[^.!?]+[.!?]+/g) || [chunk];
      let sentenceChunk = "";

      for (const sentence of sentences) {
        if (sentenceChunk.length + sentence.length > opts.maxChunkSize) {
          if (sentenceChunk.length > 0) {
            finalChunks.push(sentenceChunk.trim());
          }
          const overlapText = getOverlapText(
            sentenceChunk,
            opts.chunkOverlap,
            " ",
          );
          sentenceChunk = `${overlapText} ${sentence}`;
        } else {
          sentenceChunk += sentence;
        }
      }

      if (sentenceChunk.length > 0) {
        finalChunks.push(sentenceChunk.trim());
      }
    } else {
      finalChunks.push(chunk);
    }
  }

  let position = 0;
  return finalChunks.map((content, index) => {
    const chunk: TextChunk = {
      content,
      index,
      startPosition: position,
      endPosition: position + content.length,
    };
    position = chunk.endPosition;
    return chunk;
  });
}

function getOverlapText(
  text: string,
  overlapSize: number,
  separator: string,
): string {
  if (overlapSize >= text.length) {
    return text;
  }

  let overlapText = text.slice(-overlapSize);

  const lastSeparatorIndex = overlapText.indexOf(separator);
  if (lastSeparatorIndex > 0) {
    overlapText = overlapText.slice(lastSeparatorIndex + separator.length);
  }

  return overlapText.trim();
}

/**
 * Count tokens in text.
 * Delegates to the shared estimateTokens utility (CJK-aware).
 */
export function countTokens(text: string): number {
  return estimateTokens(text);
}

/**
 * Get optimal chunk size based on text length
 */
export function getOptimalChunkSize(textLength: number): number {
  if (textLength < 1000) {
    return textLength;
  }
  if (textLength < 10000) {
    return 500;
  }
  if (textLength < 50000) {
    return 1000;
  }
  return 1500;
}

/**
 * Estimate number of chunks for a text
 */
export function estimateChunkCount(
  textLength: number,
  options?: ChunkOptions,
): number {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const effectiveChunkSize = opts.maxChunkSize - opts.chunkOverlap;
  return Math.ceil(textLength / effectiveChunkSize);
}
