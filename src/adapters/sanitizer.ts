// ============================================================================
// 1min-bridge — Response Sanitizer & Memory Unpacker
// ============================================================================

export class ResponseSanitizer {
  /**
   * Sanitizes the final assistant response removing execution artifacts,
   * thinking monologue (<think>), residual tool markup, and unwanted prefixes.
   */
  static cleanOutput(text: string): string {
    if (!text || typeof text !== "string") return "";

    let cleaned = text;

    // 1. Remove reasoning blocks from models like DeepSeek-R1 / QwQ (<think>...</think>)
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "");

    // 2. Remove residual tool tags from XML/Hermes-style models (<tool_call>, <tools>)
    cleaned = cleaned.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "");
    cleaned = cleaned.replace(/<tools>[\s\S]*?<\/tools>/gi, "");

    // 3. Remove leaked "Tool: [...]" or "Tool: {...}" blocks
    cleaned = cleaned.replace(/Tool:\s*(?:\[[\s\S]*?\]|\{[\s\S]*?\})\s*/gi, "");

    // 4. Remove Markdown code blocks containing raw tool_calls
    cleaned = cleaned.replace(
      /```(?:json)?\s*\{\s*"tool_calls"[\s\S]*?\}\s*```/gi,
      "",
    );

    // 5. Remove search / crawling status introductions
    cleaned = cleaned.replace(
      /^(?:Okay|Ok|Certo|Entendido|Sure)[^.\n]*?(?:procurar|pesquisar|buscar|search|crawling)[^.\n]*?\.\s*/gim,
      "",
    );

    // 6. Remove leaked role prefixes at the beginning of lines
    cleaned = cleaned.replace(/^(?:Assistant|AI|Emma|Bot|System):\s*/gim, "");

    return cleaned.trim();
  }

  /**
   * Unpacks complex memory payloads (e.g., LangChain Memory, Vector Store Document)
   * converting nested JSON objects with `pageContent` and metadata into clean, readable text.
   */
  static unpackMemoryContent(rawContent: unknown): string {
    if (!rawContent) return "";

    // 1. If already a string, check if it's serialized JSON
    if (typeof rawContent === "string") {
      const trimmed = rawContent.trim();
      if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
        try {
          const parsed = JSON.parse(trimmed);
          return ResponseSanitizer.unpackMemoryContent(parsed);
        } catch {
          return rawContent;
        }
      }
      return rawContent;
    }

    // 2. If array (e.g. LangChain documents or multiple tool results)
    if (Array.isArray(rawContent)) {
      return rawContent
        .map((item) => ResponseSanitizer.unpackMemoryContent(item))
        .filter(Boolean)
        .join("\n");
    }

    // 3. If structured object
    if (typeof rawContent === "object" && rawContent !== null) {
      const record = rawContent as Record<string, unknown>;

      // LangChain Vector Store Document { pageContent: "...", metadata: {...} }
      if (typeof record.pageContent === "string") {
        let text = record.pageContent;
        const metadata = record.metadata as Record<string, unknown> | undefined;
        if (metadata?.timestamp) {
          text += ` (Recorded: ${metadata.timestamp})`;
        }
        return text;
      }

      // Generic response/text objects
      if (typeof record.text === "string") return record.text;
      if (record.response) {
        return ResponseSanitizer.unpackMemoryContent(record.response);
      }

      // Fallback: Clean JSON representation
      return JSON.stringify(rawContent);
    }

    return String(rawContent);
  }
}
