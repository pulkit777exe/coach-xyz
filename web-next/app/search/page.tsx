"use client";

import { useCallback, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { SearchResult, SearchStreamEvent, SearchSource } from "@/lib/api";
import { deepSearchStream } from "@/lib/api";

type Status = "idle" | "searching" | "done" | "error";

type AngleProgress = {
  angle: string;
  status: "pending" | "searching" | "complete";
  sources: number;
};

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [angles, setAngles] = useState<AngleProgress[]>([]);
  const [currentMessage, setCurrentMessage] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const handleSearch = useCallback(async () => {
    if (!query.trim() || status === "searching") return;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus("searching");
    setResult(null);
    setAngles([]);
    setErrorMsg("");
    setCurrentMessage("Initializing deep research...");

    try {
      for await (const event of deepSearchStream(query, undefined, undefined, controller.signal)) {
        switch (event.type) {
          case "status":
            setCurrentMessage(event.message);
            break;

          case "decomposition":
            setAngles(event.angles.map((a) => ({
              angle: a,
              status: "pending" as const,
              sources: 0,
            })));
            break;

          case "searching":
            setAngles((prev) =>
              prev.map((a, i) =>
                i === event.current - 1
                  ? { ...a, status: "searching" as const }
                  : a,
              ),
            );
            break;

          case "angle_complete":
            setAngles((prev) =>
              prev.map((a, i) =>
                i === event.current - 1
                  ? { ...a, status: "complete" as const, sources: event.sources_found }
                  : a,
              ),
            );
            break;

          case "gap_filled":
            setAngles((prev) => [
              ...prev,
              { angle: event.question, status: "complete", sources: 1 },
            ]);
            break;

          case "done":
            setResult(event.result);
            setStatus("done");
            setCurrentMessage("");
            break;

          case "error":
            setErrorMsg(event.message);
            setStatus("error");
            break;
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setErrorMsg((err as { message?: string })?.message ?? "Search failed");
        setStatus("error");
      }
    }
  }, [query, status]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSearch();
    }
  };

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      <div className="mx-auto max-w-3xl px-6 py-20">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-12"
        >
          <h1 className="text-3xl font-medium mb-2">Deep Research</h1>
          <p className="text-[var(--cream-40)]">
            Ask anything. Parallel searches, deep synthesis, comprehensive results.
          </p>
        </motion.div>

        {/* Search Input */}
        <div className="relative mb-8">
          <div className="flex items-center gap-3 rounded-xl border border-[var(--cream-20)] bg-[var(--cream-05)] px-5 py-4 focus-within:border-[var(--cream-40)] transition-colors">
            <svg className="w-5 h-5 text-[var(--cream-40)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="What do you want to research?"
              className="flex-1 bg-transparent outline-none text-lg placeholder:text-[var(--cream-20)]"
              disabled={status === "searching"}
            />
            {status === "searching" ? (
              <button
                onClick={() => abortRef.current?.abort()}
                className="px-3 py-1 rounded-lg border border-[var(--cream-20)] text-sm hover:border-[var(--cream-40)] transition-colors"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={handleSearch}
                disabled={!query.trim()}
                className="px-4 py-1.5 rounded-lg bg-[var(--fg)] text-[var(--bg)] text-sm font-medium disabled:opacity-30 hover:opacity-80 transition-opacity"
              >
                Search
              </button>
            )}
          </div>
        </div>

        {/* Progress */}
        <AnimatePresence mode="wait">
          {status === "searching" && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mb-8"
            >
              <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-[var(--fg)] animate-pulse" />
                <span className="text-sm text-[var(--cream-40)]">{currentMessage}</span>
              </div>

              <div className="space-y-2">
                {angles.map((angle, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="flex items-center gap-3 text-sm"
                  >
                    {angle.status === "complete" ? (
                      <svg className="w-4 h-4 text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : angle.status === "searching" ? (
                      <div className="w-4 h-4 rounded-full border-2 border-[var(--cream-40)] border-t-transparent animate-spin shrink-0" />
                    ) : (
                      <div className="w-4 h-4 rounded-full border border-[var(--cream-20)] shrink-0" />
                    )}
                    <span className={
                      angle.status === "complete" ? "text-[var(--fg)]" :
                      angle.status === "searching" ? "text-[var(--cream-40)]" :
                      "text-[var(--cream-20)]"
                    }>
                      {angle.angle}
                    </span>
                    {angle.status === "complete" && angle.sources > 0 && (
                      <span className="text-[var(--cream-20)] text-xs">
                        ({angle.sources} sources)
                      </span>
                    )}
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Error */}
          {status === "error" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mb-8 p-4 rounded-xl border border-red-500/30 bg-red-500/5 text-red-400"
            >
              {errorMsg}
            </motion.div>
          )}

          {/* Results */}
          {status === "done" && result && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              {/* Meta */}
              <div className="flex items-center gap-4 mb-6 text-xs text-[var(--cream-20)]">
                <span>{result.searches_performed} searches</span>
                <span>{result.sources.length} sources</span>
                <span>depth {result.depth_reached}</span>
                <span>{result.total_time_seconds}s</span>
                {result.metadata.coverage_score !== undefined && (
                  <span>coverage: {result.metadata.coverage_score}/10</span>
                )}
              </div>

              {/* Report */}
              <article className="prose prose-invert max-w-none mb-10">
                <div className="whitespace-pre-wrap text-[var(--fg)] leading-relaxed text-[15px]">
                  {result.report.split("\n").map((line, i) => {
                    if (line.startsWith("# ")) {
                      return <h1 key={i} className="text-2xl font-medium mt-8 mb-4">{line.slice(2)}</h1>;
                    }
                    if (line.startsWith("## ")) {
                      return <h2 key={i} className="text-xl font-medium mt-6 mb-3">{line.slice(3)}</h2>;
                    }
                    if (line.startsWith("### ")) {
                      return <h3 key={i} className="text-lg font-medium mt-4 mb-2">{line.slice(4)}</h3>;
                    }
                    if (line.startsWith("- ") || line.startsWith("* ")) {
                      const content = line.slice(2);
                      const linkMatch = content.match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/);
                      if (linkMatch) {
                        return (
                          <div key={i} className="flex gap-2 ml-4 my-1">
                            <span className="text-[var(--cream-20)]">{"•"}</span>
                            <a href={linkMatch[2]} target="_blank" rel="noopener noreferrer" className="text-[var(--fg)] underline underline-offset-2 decoration-[var(--cream-20)] hover:decoration-[var(--fg)] transition-colors">
                              {linkMatch[1]}
                            </a>
                          </div>
                        );
                      }
                      return (
                        <div key={i} className="flex gap-2 ml-4 my-1">
                          <span className="text-[var(--cream-20)]">{"•"}</span>
                          <span>{content}</span>
                        </div>
                      );
                    }
                    if (line.trim() === "") {
                      return <div key={i} className="h-3" />;
                    }
                    // Inline bold + links
                    const parts = line.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)]+\))/g);
                    return (
                      <p key={i} className="my-1">
                        {parts.map((part, j) => {
                          if (part.startsWith("**") && part.endsWith("**")) {
                            return <strong key={j}>{part.slice(2, -2)}</strong>;
                          }
                          const linkMatch = part.match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/);
                          if (linkMatch) {
                            return (
                              <a key={j} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 decoration-[var(--cream-20)] hover:decoration-[var(--fg)] transition-colors">
                                {linkMatch[1]}
                              </a>
                            );
                          }
                          return <span key={j}>{part}</span>;
                        })}
                      </p>
                    );
                  })}
                </div>
              </article>

              {/* Sources */}
              {result.sources.length > 0 && (
                <div className="border-t border-[var(--cream-10)] pt-6">
                  <h3 className="text-sm font-medium text-[var(--cream-40)] mb-4">
                    Sources ({result.sources.length})
                  </h3>
                  <div className="grid gap-2">
                    {result.sources.map((source: SearchSource, i: number) => (
                      <a
                        key={i}
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex items-start gap-3 p-3 rounded-lg border border-[var(--cream-05)] hover:border-[var(--cream-20)] transition-colors"
                      >
                        <span className="text-xs text-[var(--cream-20)] mt-0.5 w-5 text-right shrink-0">
                          {i + 1}
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm text-[var(--fg)] group-hover:underline truncate">
                            {source.title}
                          </div>
                          <div className="text-xs text-[var(--cream-20)] truncate mt-0.5">
                            {source.url}
                          </div>
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}
