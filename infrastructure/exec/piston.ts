import { proxyFetch } from "@/infrastructure/http/fetch";

/**
 * Running code.
 *
 * SAGE has no sandbox of its own and should not pretend otherwise: executing
 * arbitrary code inside the app's own runtime would hand anything that reaches
 * this endpoint the app's environment, including its keys. Piston is a public,
 * free execution service that runs each submission in an isolated container
 * with its own CPU, memory and time limits, which is exactly the property that
 * matters here.
 *
 * The trade is latency (a second or two) and a rate limit (~5 runs/second,
 * shared). Both are fine for solving one problem at a time, and neither is
 * worth reproducing badly in-house.
 */

const API = "https://emkc.org/api/v2/piston";

/** Language slugs, mapped from LeetCode's naming to Piston's. */
export const LANGUAGES = {
  python3: { piston: "python", version: "3.10.0", label: "Python", ext: "py" },
  cpp: { piston: "c++", version: "10.2.0", label: "C++", ext: "cpp" },
  java: { piston: "java", version: "15.0.2", label: "Java", ext: "java" },
  javascript: { piston: "javascript", version: "18.15.0", label: "JavaScript", ext: "js" },
  typescript: { piston: "typescript", version: "5.0.3", label: "TypeScript", ext: "ts" },
  golang: { piston: "go", version: "1.16.2", label: "Go", ext: "go" },
  rust: { piston: "rust", version: "1.68.2", label: "Rust", ext: "rs" },
} as const;

export type LangKey = keyof typeof LANGUAGES;

export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  /** Non-zero means the program itself failed. */
  code: number | null;
  /** Set when the run never happened — a network problem, a rate limit. */
  error?: string;
  /** True when the container killed it rather than the program exiting. */
  timedOut: boolean;
}

export async function runCode(lang: LangKey, source: string, stdin = ""): Promise<RunResult> {
  const spec = LANGUAGES[lang];
  if (!spec) return { ok: false, stdout: "", stderr: "", code: null, error: `Unsupported language: ${lang}`, timedOut: false };

  try {
    const res = await proxyFetch(`${API}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        language: spec.piston,
        version: spec.version,
        files: [{ name: `main.${spec.ext}`, content: source }],
        stdin,
        compile_timeout: 10_000,
        run_timeout: 6_000,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (res.status === 429) {
      return { ok: false, stdout: "", stderr: "", code: null, timedOut: false, error: "The public runner is rate-limited right now — try again in a few seconds." };
    }
    if (!res.ok) {
      return { ok: false, stdout: "", stderr: "", code: null, timedOut: false, error: `Runner returned ${res.status}.` };
    }

    const j = (await res.json()) as {
      run?: { stdout?: string; stderr?: string; code?: number | null; signal?: string | null };
      compile?: { stdout?: string; stderr?: string; code?: number | null };
    };

    // A compile failure never reaches the run stage, and reporting an empty
    // run output for it would look like a program that printed nothing.
    if (j.compile && (j.compile.code ?? 0) !== 0) {
      return {
        ok: false,
        stdout: j.compile.stdout ?? "",
        stderr: (j.compile.stderr || "Compilation failed.").slice(0, 8000),
        code: j.compile.code ?? 1,
        timedOut: false,
      };
    }

    const run = j.run ?? {};
    // Piston reports a kill by signal, not by exit code — SIGKILL here almost
    // always means the run timeout, which is worth naming rather than showing
    // as a mysterious empty failure.
    const timedOut = run.signal === "SIGKILL";

    return {
      ok: !timedOut && (run.code ?? 1) === 0,
      stdout: (run.stdout ?? "").slice(0, 8000),
      stderr: (timedOut ? "Timed out after 6 seconds — likely an infinite loop." : run.stderr ?? "").slice(0, 8000),
      code: run.code ?? null,
      timedOut,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, stdout: "", stderr: "", code: null, timedOut: false, error: `Couldn't reach the runner: ${msg.slice(0, 120)}` };
  }
}
