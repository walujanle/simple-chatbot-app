import { useCallback, useId, useState } from "react";
import { copyText, safeHttpUrl } from "@/lib/browser";
import type { ResponseReceipt as Receipt } from "@/types";

const numberFormatter = new Intl.NumberFormat();

function providerLabel(provider: Receipt["provider"]): string {
  if (provider === "openai-compatible") return "OpenAI compatible";
  if (provider === "anthropic") return "Claude";
  return "Gemini";
}

function formatLatency(milliseconds: number): string {
  return milliseconds >= 1000 ? `${(milliseconds / 1000).toFixed(1)}s` : `${milliseconds}ms`;
}

export function ResponseReceipt({ receipt, content }: { receipt: Receipt; content: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const detailsId = useId();

  const copyResponse = useCallback(async () => {
    try {
      await copyText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, [content]);

  const tokenCount = receipt.usage.totalTokens;

  return (
    <div className="mt-3 border-t border-white/10 pt-2 text-xs text-white/40">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium text-white/55">{providerLabel(receipt.provider)}</span>
        <span aria-hidden="true">/</span>
        <span className="max-w-full break-all">{receipt.model}</span>
        <span aria-hidden="true">/</span>
        <span>{formatLatency(receipt.latencyMs)}</span>
        {tokenCount !== undefined && (
          <>
            <span aria-hidden="true">/</span>
            <span>{numberFormatter.format(tokenCount)} tokens</span>
          </>
        )}
        {receipt.webSearchUsed && (
          <>
            <span aria-hidden="true">/</span>
            <span>{receipt.sources.length} sources</span>
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => void copyResponse()}
            className="rounded-md px-2 py-1 text-white/50 hover:bg-white/5 hover:text-white"
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            aria-controls={detailsId}
            className="rounded-md px-2 py-1 text-white/50 hover:bg-white/5 hover:text-white"
          >
            {open ? "Hide details" : "Details"}
          </button>
        </div>
      </div>

      {open && (
        <div id={detailsId} className="mt-2 space-y-3 rounded-xl border border-white/10 bg-black/15 p-3">
          <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
            <dt className="font-semibold text-white/30 uppercase tracking-wider text-[10px] self-center">Endpoint</dt>
            <dd className="min-w-0 break-all text-white/70 font-mono">
              {receipt.endpointHost || "Default provider endpoint"}
            </dd>
            <dt className="font-semibold text-white/30 uppercase tracking-wider text-[10px] self-center">Reasoning</dt>
            <dd className="text-white/70 font-mono">
              {receipt.reasoningEnabled ? `Requested (${receipt.reasoningEffort})` : "Not requested"}
            </dd>
            <dt className="font-semibold text-white/30 uppercase tracking-wider text-[10px] self-center">Context</dt>
            <dd className="text-white/70 font-mono">
              ~{numberFormatter.format(receipt.context.estimatedInputTokens)} tokens ({receipt.context.recentCount}{" "}
              recent)
            </dd>
            {receipt.context.summarizedCount > 0 && (
              <>
                <dt className="font-semibold text-white/30 uppercase tracking-wider text-[10px] self-center">
                  Compressed
                </dt>
                <dd className="text-white/70 font-mono">{receipt.context.summarizedCount} earlier messages</dd>
              </>
            )}
            {receipt.usage.inputTokens !== undefined && (
              <>
                <dt className="font-semibold text-white/30 uppercase tracking-wider text-[10px] self-center">Input</dt>
                <dd className="text-white/70 font-mono">{numberFormatter.format(receipt.usage.inputTokens)} tokens</dd>
              </>
            )}
            {receipt.usage.outputTokens !== undefined && (
              <>
                <dt className="font-semibold text-white/30 uppercase tracking-wider text-[10px] self-center">Output</dt>
                <dd className="text-white/70 font-mono">{numberFormatter.format(receipt.usage.outputTokens)} tokens</dd>
              </>
            )}
          </dl>

          {receipt.webSearchUsed && (
            <div>
              <p className="break-words font-medium text-white/60">
                Web research{receipt.searchQuery ? `: ${receipt.searchQuery}` : ""}
              </p>
              {receipt.sources.length > 0 ? (
                <ol className="mt-2 space-y-2">
                  {receipt.sources.map((source) => {
                    const sourceUrl = safeHttpUrl(source.url);
                    return (
                      <li
                        key={`${source.url}-${source.retrievedAt}`}
                        className="min-w-0 rounded-lg border border-white/5 bg-white/[0.02] p-2"
                      >
                        {sourceUrl ? (
                          <a
                            href={sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="block break-words font-medium text-blue-300 hover:text-blue-200"
                          >
                            {source.title || source.url}
                          </a>
                        ) : (
                          <span className="block break-words font-medium text-white/60">{source.title}</span>
                        )}
                        {source.snippet && (
                          <p className="mt-1 break-words leading-relaxed text-white/45">{source.snippet}</p>
                        )}
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="mt-1 text-amber-300/80">No usable sources were returned.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
