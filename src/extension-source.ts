import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MAX_EXTENSION_SOURCE_BYTES = 1024 * 1024;

export type ExtensionSourceUnavailableReason =
  | "bundle-path-unsupported"
  | "file-missing"
  | "read-failed"
  | "too-large";

export interface LoadedExtensionSource {
  /** Internal only: this path is never included in the public diagnostic. */
  readonly sourcePath?: string;
  readonly capturedSha256: string | null;
  readonly capturedAt: string;
  readonly unavailableReason?: ExtensionSourceUnavailableReason;
}

export interface ExtensionSourceDiagnostic {
  readonly status: "current" | "changed" | "unavailable";
  readonly capturedSha256: string | null;
  readonly diskSha256: string | null;
  readonly capturedAt: string;
  readonly checkedAt: string;
  readonly reason?: ExtensionSourceUnavailableReason;
}

type FileReadResult =
  | { readonly sha256: string }
  | { readonly reason: ExtensionSourceUnavailableReason };

function timestamp(): string {
  return new Date().toISOString();
}

function classifyReadError(error: unknown): ExtensionSourceUnavailableReason {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR" ? "file-missing" : "read-failed";
}

function readSourceSha256(sourcePath: string): FileReadResult {
  let descriptor: number | undefined;
  try {
    // A source path replaced with a FIFO must not block diagnostics while it
    // is opened. O_NONBLOCK is available on POSIX; Windows has no FIFO paths.
    descriptor = openSync(sourcePath, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    const file = fstatSync(descriptor);
    if (!file.isFile()) return { reason: "read-failed" };
    if (file.size > MAX_EXTENSION_SOURCE_BYTES) return { reason: "too-large" };

    // Read at most one byte above the cap, so a file that grows after stat
    // cannot cause an unbounded allocation or read.
    const buffer = Buffer.allocUnsafe(MAX_EXTENSION_SOURCE_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const count = readSync(
        descriptor,
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        bytesRead,
      );
      if (count === 0) break;
      bytesRead += count;
    }

    if (bytesRead > MAX_EXTENSION_SOURCE_BYTES) return { reason: "too-large" };
    return {
      sha256: createHash("sha256").update(buffer.subarray(0, bytesRead)).digest("hex"),
    };
  } catch (error) {
    return { reason: classifyReadError(error) };
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // A close failure does not make the bounded read unsafe or expose data.
      }
    }
  }
}

export function captureLoadedExtensionSource(moduleUrl: string | URL): LoadedExtensionSource {
  const capturedAt = timestamp();
  let sourcePath: string;
  try {
    const url = new URL(moduleUrl);
    if (url.protocol !== "file:") {
      return {
        capturedSha256: null,
        capturedAt,
        unavailableReason: "bundle-path-unsupported",
      };
    }
    sourcePath = fileURLToPath(url);
  } catch {
    return {
      capturedSha256: null,
      capturedAt,
      unavailableReason: "bundle-path-unsupported",
    };
  }

  const loadedFile = readSourceSha256(sourcePath);
  if ("reason" in loadedFile) {
    return {
      capturedSha256: null,
      capturedAt,
      unavailableReason: loadedFile.reason,
    };
  }

  return { sourcePath, capturedSha256: loadedFile.sha256, capturedAt };
}

export function inspectLoadedExtensionSource(loaded: LoadedExtensionSource): ExtensionSourceDiagnostic {
  const checkedAt = timestamp();
  if (!loaded.sourcePath || !loaded.capturedSha256 || loaded.unavailableReason) {
    return {
      status: "unavailable",
      capturedSha256: loaded.capturedSha256,
      diskSha256: null,
      capturedAt: loaded.capturedAt,
      checkedAt,
      reason: loaded.unavailableReason ?? "bundle-path-unsupported",
    };
  }

  const diskFile = readSourceSha256(loaded.sourcePath);
  if ("reason" in diskFile) {
    return {
      status: "unavailable",
      capturedSha256: loaded.capturedSha256,
      diskSha256: null,
      capturedAt: loaded.capturedAt,
      checkedAt,
      reason: diskFile.reason,
    };
  }

  return {
    status: diskFile.sha256 === loaded.capturedSha256 ? "current" : "changed",
    capturedSha256: loaded.capturedSha256,
    diskSha256: diskFile.sha256,
    capturedAt: loaded.capturedAt,
    checkedAt,
  };
}
