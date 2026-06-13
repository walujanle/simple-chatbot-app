import type { Message } from "@/types";

function safeFilename(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
  return normalized.slice(0, 80) || "chat-export";
}

export function exportChatAsMarkdown(title: string, messages: Message[]): void {
  const sections = messages
    .filter((message) => message.role !== "system")
    .map((message) => {
      const heading = message.role === "user" ? "User" : "Assistant";
      const receipt = message.receipt;
      const metadata = receipt
        ? [
            `Provider: ${receipt.provider}`,
            `Model: ${receipt.model}`,
            `Latency: ${receipt.latencyMs} ms`,
            receipt.usage.totalTokens !== undefined ? `Tokens: ${receipt.usage.totalTokens}` : null,
            receipt.webSearchUsed ? `Web sources: ${receipt.sources.length}` : null,
          ]
            .filter(Boolean)
            .join(" | ")
        : "";
      const sources = receipt?.sources.length
        ? `\n\nSources:\n${receipt.sources.map((source, index) => `${index + 1}. [${source.title}](${source.url})`).join("\n")}`
        : "";
      return `## ${heading}\n\n${message.content}${metadata ? `\n\n_${metadata}_` : ""}${sources}`;
    });

  const document = `# ${title}\n\nExported ${new Date().toISOString()}\n\n${sections.join("\n\n---\n\n")}\n`;
  const url = URL.createObjectURL(new Blob([document], { type: "text/markdown;charset=utf-8" }));
  const link = window.document.createElement("a");
  link.href = url;
  link.download = `${safeFilename(title)}.md`;
  window.document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
