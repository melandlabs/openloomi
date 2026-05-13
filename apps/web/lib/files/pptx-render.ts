/**
 * PPTX Render Pipeline
 *
 * Server-side PPTX preview rendering via LibreOffice -> PDF -> PNG -> WebP pipeline.
 * Falls back to client-side rendering when render engine is not available.
 */

import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { basename, extname, join, dirname, sep } from "node:path";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { getTaskSessionDir } from "./workspace/sessions";
import { workspaceLogger } from "@/lib/utils/logger";

export interface PptxSlideRender {
  index: number;
  path: string;
  width: number;
  height: number;
}

export interface PptxRenderManifest {
  task_id: string;
  source_path: string;
  cache_key: string;
  slides: PptxSlideRender[];
  created_at: string;
  engine: "bundled" | "installed" | "system" | "fallback";
}

// Get render engine paths from environment or bundled location
function getRenderEnginePaths(): {
  soffice_bin: string | null;
  pdftoppm_bin: string | null;
} {
  // Environment variables set by Tauri desktop app
  const soffice_bin = process.env.SOFFICE_BIN || null;
  const pdftoppm_bin = process.env.PDFTOPPM_BIN || null;

  return { soffice_bin, pdftoppm_bin };
}

function getInstalledEnginePathsFromDisk(): {
  soffice_bin: string | null;
  pdftoppm_bin: string | null;
} {
  const windowsHome =
    process.env.HOMEDRIVE && process.env.HOMEPATH
      ? `${process.env.HOMEDRIVE}${process.env.HOMEPATH}`
      : "";
  const home = process.env.HOME || process.env.USERPROFILE || windowsHome || "";
  if (!home) {
    return { soffice_bin: null, pdftoppm_bin: null };
  }

  try {
    const installedJson = join(
      home,
      ".openloomi",
      "render-engines",
      "office",
      "installed.json",
    );
    if (!existsSync(installedJson)) {
      return { soffice_bin: null, pdftoppm_bin: null };
    }

    const content = readFileSync(installedJson, "utf-8");
    const parsed = JSON.parse(content) as {
      soffice_path?: string;
      pdftoppm_path?: string;
    };

    const soffice_bin =
      parsed.soffice_path && existsSync(parsed.soffice_path)
        ? parsed.soffice_path
        : null;
    const pdftoppm_bin =
      parsed.pdftoppm_path && existsSync(parsed.pdftoppm_path)
        ? parsed.pdftoppm_path
        : null;

    return { soffice_bin, pdftoppm_bin };
  } catch {
    return { soffice_bin: null, pdftoppm_bin: null };
  }
}

// Get the platform-specific render engine directory
function getBundledEngineDir(): string | null {
  const resource_dir = process.env.RESOURCE_DIR || "";
  if (!resource_dir) return null;

  const platform = getPlatformDir();
  const engine_dir = join(resource_dir, "render-engine", platform);

  return engine_dir;
}

function getPlatformDir(): string {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "darwin") {
    return arch === "arm64" ? "darwin-arm64" : "darwin-x64";
  }
  if (platform === "linux") {
    return "linux-x64";
  }
  if (platform === "win32") {
    return "windows-x64";
  }
  return "unknown";
}

// Find bundled soffice binary
function findBundledSoffice(): string | null {
  const engine_dir = getBundledEngineDir();
  if (!engine_dir || !existsSync(engine_dir)) return null;

  // Check direct soffice binary
  const soffice_path = join(engine_dir, "soffice");
  if (existsSync(soffice_path)) {
    return soffice_path;
  }

  // Check LibreOffice.app on macOS
  if (process.platform === "darwin") {
    const libreoffice_app = join(
      engine_dir,
      "LibreOffice.app",
      "Contents",
      "MacOS",
      "soffice",
    );
    if (existsSync(libreoffice_app)) {
      return libreoffice_app;
    }
  }

  return null;
}

// Find bundled pdftoppm binary
function findBundledPdftoppm(): string | null {
  const engine_dir = getBundledEngineDir();
  if (!engine_dir || !existsSync(engine_dir)) return null;

  const pdftoppm_path = join(engine_dir, "pdftoppm");
  if (existsSync(pdftoppm_path)) {
    return pdftoppm_path;
  }

  // Check bin subdirectory
  const pdftoppm_bin = join(engine_dir, "bin", "pdftoppm");
  if (existsSync(pdftoppm_bin)) {
    return pdftoppm_bin;
  }

  return null;
}

// Find binary in PATH
function findInPath(name: string): string | null {
  const path = process.env.PATH || "";
  const pathDirs = path.split(process.platform === "win32" ? ";" : ":");

  for (const dir of pathDirs) {
    const fullPath = join(dir, name);
    if (existsSync(fullPath)) {
      return fullPath;
    }
    // Also check .cmd on Windows
    if (process.platform === "win32") {
      const cmdPath = join(dir, `${name}.cmd`);
      if (existsSync(cmdPath)) {
        return cmdPath;
      }
    }
  }

  // macOS: Check Homebrew common paths directly
  if (process.platform === "darwin") {
    const homebrewPaths = ["/opt/homebrew/bin", "/usr/local/bin"];
    for (const base of homebrewPaths) {
      const fullPath = join(base, name);
      if (existsSync(fullPath)) {
        return fullPath;
      }
    }
  }

  return null;
}

// Validate that the render engine is available
export function isRenderEngineAvailable(): boolean {
  const { soffice_bin, pdftoppm_bin } = getRenderEnginePaths();

  // Use env var if set
  if (soffice_bin && pdftoppm_bin) {
    return existsSync(soffice_bin) && existsSync(pdftoppm_bin);
  }

  const installed = getInstalledEnginePathsFromDisk();
  if (installed.soffice_bin && installed.pdftoppm_bin) {
    return true;
  }

  // Use bundled binaries
  const soffice = findBundledSoffice();
  const pdftoppm = findBundledPdftoppm();

  if (soffice && pdftoppm) {
    return true;
  }

  // Fallback: check PATH
  const sofficeInPath = findInPath("soffice");
  const pdftoppmInPath = findInPath("pdftoppm");

  return !!(sofficeInPath && pdftoppmInPath);
}

// Get effective soffice binary path
function getSofficeBin(): string | null {
  const { soffice_bin } = getRenderEnginePaths();
  if (soffice_bin && existsSync(soffice_bin)) {
    return soffice_bin;
  }
  const installed = getInstalledEnginePathsFromDisk();
  if (installed.soffice_bin) return installed.soffice_bin;
  const bundled = findBundledSoffice();
  if (bundled) return bundled;
  return findInPath("soffice");
}

// Get effective pdftoppm binary path
function getPdftoppmBin(): string | null {
  const { pdftoppm_bin } = getRenderEnginePaths();
  if (pdftoppm_bin && existsSync(pdftoppm_bin)) {
    return pdftoppm_bin;
  }
  const installed = getInstalledEnginePathsFromDisk();
  if (installed.pdftoppm_bin) return installed.pdftoppm_bin;
  const bundled = findBundledPdftoppm();
  if (bundled) return bundled;
  return findInPath("pdftoppm");
}

// Generate a cache key based on file path and modification time
async function generateCacheKey(
  taskId: string,
  pptxSourcePath: string,
): Promise<string> {
  // Handle both absolute and relative paths
  const fullPath = pptxSourcePath.startsWith("/")
    ? decodeURIComponent(pptxSourcePath)
    : join(getTaskSessionDir(taskId), pptxSourcePath);

  let mtime = 0;
  try {
    const stats = statSync(fullPath);
    mtime = stats.mtimeMs;
  } catch {
    // Ignore
  }

  const hash = createHash("sha256");
  hash.update(`${taskId}:${pptxSourcePath}:${mtime}`);
  return hash.digest("hex").substring(0, 16);
}

// Get preview cache directory for a task
function getPreviewCacheDir(taskId: string): string {
  const sessionDir = getTaskSessionDir(taskId);
  return join(sessionDir, ".openloomi-preview", "pptx");
}

// Ensure directory exists
function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// Run soffice to convert PPTX to PDF with retry
async function convertPptxToPdf(
  soffice_bin: string,
  sourcePath: string,
  outputDir: string,
): Promise<string> {
  // Construct expected PDF path directly (soffice doesn't reliably output to stdout)
  const baseName = basename(sourcePath, extname(sourcePath));
  const expectedPdf = join(outputDir, `${baseName}.pdf`);

  const runSoffice = async (): Promise<{ stdout: string; stderr: string }> => {
    return new Promise((resolve, reject) => {
      const args = [
        "--headless",
        "--convert-to",
        "pdf",
        "--outdir",
        outputDir,
        sourcePath,
      ];

      workspaceLogger.info("[pptx-render] Running soffice:", {
        bin: soffice_bin,
        args,
      });

      execFile(
        soffice_bin,
        args,
        { timeout: 60000 },
        (error, stdout, stderr) => {
          if (error) {
            workspaceLogger.error("[pptx-render] soffice error:", error);
            workspaceLogger.error("[pptx-render] soffice stderr:", stderr);
            reject(error);
            return;
          }
          workspaceLogger.info("[pptx-render] soffice stdout:", stdout);
          if (stderr) {
            workspaceLogger.info("[pptx-render] soffice stderr:", stderr);
          }
          resolve({ stdout, stderr });
        },
      );
    });
  };

  // Ensure output directory exists
  ensureDir(outputDir);

  const maxSofficeRetries = 3;
  for (let attempt = 1; attempt <= maxSofficeRetries; attempt++) {
    try {
      // Run soffice to convert PPTX to PDF
      workspaceLogger.info(
        `[pptx-render] soffice attempt ${attempt}:`,
        soffice_bin,
      );
      await runSoffice();

      // soffice may return before file is fully written - wait and retry
      const maxFileRetries = 5;
      const retryDelay = 500;

      const checkFile = (retries: number): Promise<string> => {
        return new Promise((resolve, reject) => {
          if (existsSync(expectedPdf)) {
            workspaceLogger.info("[pptx-render] PDF created:", expectedPdf);
            resolve(expectedPdf);
          } else if (retries > 0) {
            workspaceLogger.info(
              `[pptx-render] Waiting for PDF... (${retries} retries left)`,
            );
            setTimeout(
              () =>
                checkFile(retries - 1)
                  .then(resolve)
                  .catch(reject),
              retryDelay,
            );
          } else {
            workspaceLogger.error(
              "[pptx-render] PDF not found at expected path:",
              expectedPdf,
            );
            reject(new Error("soffice did not produce expected PDF output"));
          }
        });
      };

      return await checkFile(maxFileRetries);
    } catch (error) {
      workspaceLogger.error(
        `[pptx-render] soffice attempt ${attempt} failed:`,
        error,
      );
      if (attempt === maxSofficeRetries) {
        throw error;
      }
      // Wait before retry
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error("soffice failed after all retries");
}

// Run pdftoppm to convert PDF to PNG slides
async function convertPdfToSlides(
  pdftoppm_bin: string,
  pdfPath: string,
  outputPrefix: string,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    // -png: output PNG format
    // -r 150: 150 DPI resolution
    // -f 1: first page
    // -l: last page (empty means all pages)
    const args = ["-png", "-r", "150", "-f", "1", pdfPath, outputPrefix];

    workspaceLogger.info("[pptx-render] Running pdftoppm:", {
      bin: pdftoppm_bin,
      args,
    });

    execFile(
      pdftoppm_bin,
      args,
      { timeout: 120000 },
      (error, stdout, stderr) => {
        if (error) {
          workspaceLogger.error("[pptx-render] pdftoppm error:", error);
          reject(new Error(`pdftoppm failed: ${error.message}`));
          return;
        }

        // pdftoppm outputs {prefix}-N.png for each page (e.g., slide-1.png, slide-2.png)
        const dir = dirname(pdfPath);
        const prefix = basename(outputPrefix);

        const slides: string[] = [];
        let i = 1;
        while (true) {
          const slidePath = join(dir, `${prefix}-${i}.png`);
          if (existsSync(slidePath)) {
            slides.push(slidePath);
            i++;
          } else {
            break;
          }
        }

        if (slides.length === 0) {
          workspaceLogger.error(
            "[pptx-render] No slides found with prefix:",
            prefix,
          );
          workspaceLogger.error("[pptx-render] pdftoppm stdout:", stdout);
          reject(new Error("pdftoppm did not produce expected PNG slides"));
        } else {
          resolve(slides);
        }
      },
    );
  });
}

// Convert PNG to WebP and get dimensions
async function convertPngToWebp(
  pngPath: string,
  outputPath: string,
): Promise<{ width: number; height: number }> {
  const metadata = await sharp(pngPath).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;

  await sharp(pngPath).webp({ quality: 85 }).toFile(outputPath);

  return { width, height };
}

// Get or create PPTX render manifest
export async function getOrCreatePptxRenderManifest(
  taskId: string,
  pptxSourcePath: string,
): Promise<PptxRenderManifest | null> {
  // Check if render engine is available
  const soffice_bin = getSofficeBin();
  const pdftoppm_bin = getPdftoppmBin();

  const installed = getInstalledEnginePathsFromDisk();
  const engine: "bundled" | "installed" | "system" | "fallback" =
    soffice_bin && pdftoppm_bin
      ? process.env.SOFFICE_BIN
        ? installed.soffice_bin &&
          process.env.SOFFICE_BIN === installed.soffice_bin
          ? "installed"
          : "system"
        : installed.soffice_bin && soffice_bin === installed.soffice_bin
          ? "installed"
          : "bundled"
      : "fallback";

  if (engine === "fallback") {
    workspaceLogger.warn(
      "[pptx-render] Render engine not available, returning fallback manifest",
    );
    return null;
  }

  // Type narrowing: engine is "bundled" or "system", so both bins are guaranteed to be non-null
  // biome-ignore lint/style/noNonNullAssertion: engine check above guarantees non-null
  const sofficeBin = soffice_bin!;
  // biome-ignore lint/style/noNonNullAssertion: engine check above guarantees non-null
  const pdftoppmBin = pdftoppm_bin!;

  // Generate cache key
  const cacheKey = await generateCacheKey(taskId, pptxSourcePath);
  const cacheDir = getPreviewCacheDir(taskId);
  const outputDir = join(cacheDir, cacheKey);

  // Check if manifest already exists (cached result)
  const manifestPath = join(outputDir, "manifest.json");
  if (existsSync(manifestPath)) {
    try {
      const manifestContent = readFileSync(manifestPath, "utf-8");
      const manifest = JSON.parse(manifestContent) as PptxRenderManifest;
      workspaceLogger.info("[pptx-render] Using cached manifest:", cacheKey);
      return manifest;
    } catch {
      // Invalid cache, regenerate
    }
  }

  // Ensure output directory exists
  ensureDir(outputDir);

  // Resolve full source path - handle both absolute and relative paths
  let sourcePath: string;
  if (pptxSourcePath.startsWith("/")) {
    // Absolute path - use as-is
    sourcePath = decodeURIComponent(pptxSourcePath);
  } else {
    // Relative path - join with session directory
    sourcePath = join(getTaskSessionDir(taskId), pptxSourcePath);
  }

  if (!existsSync(sourcePath)) {
    workspaceLogger.error("[pptx-render] Source file not found:", sourcePath);
    return null;
  }

  try {
    // Step 1: Convert PPTX to PDF using soffice
    workspaceLogger.info("[pptx-render] Converting PPTX to PDF...");
    const pdfPath = await convertPptxToPdf(sofficeBin, sourcePath, outputDir);
    workspaceLogger.info("[pptx-render] PDF created:", pdfPath);

    // Step 2: Convert PDF to PNG slides using pdftoppm
    workspaceLogger.info("[pptx-render] Converting PDF to slides...");
    const outputPrefix = join(outputDir, "slide");
    const pngSlides = await convertPdfToSlides(
      pdftoppmBin,
      pdfPath,
      outputPrefix,
    );
    workspaceLogger.info("[pptx-render] PNG slides created:", pngSlides.length);

    // Step 3: Convert each PNG to WebP using sharp
    const slides: PptxSlideRender[] = [];
    for (let i = 0; i < pngSlides.length; i++) {
      const pngPath = pngSlides[i];
      const webpPath = join(outputDir, `slide-${i + 1}.webp`);

      const { width, height } = await convertPngToWebp(pngPath, webpPath);

      // Get relative path from session directory
      const sessionDir = getTaskSessionDir(taskId);
      const relativePath = webpPath.replace(sessionDir + sep, "");

      slides.push({
        index: i + 1,
        path: relativePath,
        width,
        height,
      });

      // Clean up PNG (we only need WebP)
      try {
        unlinkSync(pngPath);
      } catch {
        // Ignore cleanup errors
      }
    }

    // Clean up PDF
    try {
      unlinkSync(pdfPath);
    } catch {
      // Ignore cleanup errors
    }

    // Create manifest
    const manifest: PptxRenderManifest = {
      task_id: taskId,
      source_path: pptxSourcePath,
      cache_key: cacheKey,
      slides,
      created_at: new Date().toISOString(),
      engine,
    };

    // Write manifest
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    workspaceLogger.info("[pptx-render] Manifest created:", manifestPath);

    return manifest;
  } catch (error) {
    workspaceLogger.error("[pptx-render] Render failed:", error);
    return null;
  }
}
