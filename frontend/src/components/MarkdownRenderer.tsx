import { memo, type ReactNode, useCallback, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { copyText } from "@/lib/browser";

function safeUrl(value: string): string {
  if (value.startsWith("#")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:" ? url.href : "";
  } catch {
    return "";
  }
}

function textFromNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join("");
  if (node && typeof node === "object" && "props" in node) {
    return textFromNode((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

function CopyablePre({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await copyText(textFromNode(children).replace(/\n$/, ""));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, [children]);

  return (
    <div className="not-prose group relative my-3 overflow-hidden rounded-xl border border-white/10 bg-black/30">
      <button
        type="button"
        onClick={() => void copy()}
        className="absolute right-2 top-2 rounded-md bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/60 opacity-100 transition-opacity hover:bg-white/15 hover:text-white sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 cursor-pointer"
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <pre className="max-w-full overflow-x-auto p-4 text-sm leading-relaxed text-white/80 font-mono">{children}</pre>
    </div>
  );
}

const components: Components = {
  a: ({ href, children }) => {
    const target = safeUrl(href || "");
    if (!target) return <span>{children}</span>;
    return (
      <a
        href={target}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="text-blue-300 underline underline-offset-2 hover:text-blue-200"
      >
        {children}
      </a>
    );
  },
  img: ({ src, alt }) => {
    const target = safeUrl(typeof src === "string" ? src : "");
    return target ? (
      <a href={target} target="_blank" rel="noopener noreferrer nofollow" className="text-blue-300 underline">
        Image: {alt || "open source"}
      </a>
    ) : (
      <span>{alt || "Image removed"}</span>
    );
  },
  pre: CopyablePre,
  code: ({ className, children }) =>
    className ? (
      <code className={`${className} font-mono`}>{children}</code>
    ) : (
      <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[0.9em] text-white/85">{children}</code>
    ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-white/10 bg-white/5 px-4 py-3 font-semibold text-white/90">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-white/5 px-4 py-2.5 text-white/70">{children}</td>,
};

export const MarkdownRenderer = memo(function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className="prose prose-sm prose-invert min-w-0 max-w-none wrap-anywhere prose-p:leading-relaxed prose-a:break-all">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml urlTransform={safeUrl}>
        {content}
      </ReactMarkdown>
    </div>
  );
});
