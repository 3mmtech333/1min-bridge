// ============================================================================
// 1min-bridge — Token calculation & estimation utility
// ============================================================================

import { encode } from "gpt-tokenizer";
import type {
  ChatMessage,
  ChatCompletionRequest,
  ResponseRequest,
  AnthropicMessageRequest,
} from "../types.js";

const CHAR_TO_TOKEN_RATIO = 4;

export function calculateTokens(text: string): number {
  if (!text) return 0;
  try {
    return encode(text).length;
  } catch (error) {
    return estimateTokenCount(text);
  }
}

export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).length;
  const chars = text.length;
  const wordBasedEstimate = Math.ceil(words * 0.75);
  const charBasedEstimate = Math.ceil(chars / CHAR_TO_TOKEN_RATIO);
  return Math.max(wordBasedEstimate, charBasedEstimate);
}

export function extractAllChatMessageText(messages: ChatMessage[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    if (msg.content === undefined || msg.content === null) continue;
    if (typeof msg.content === "string") {
      parts.push(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const item of msg.content) {
        if (item && typeof item === "object" && item.type === "text" && item.text) {
          parts.push(item.text);
        }
      }
    }
  }
  return parts.join(" ");
}

export function calculateChatRequestTokens(body: ChatCompletionRequest): number {
  const text = extractAllChatMessageText(body.messages ?? []);
  return calculateTokens(text);
}

export function calculateResponseRequestTokens(body: ResponseRequest): number {
  let text = "";
  if (typeof body.input === "string") {
    text = body.input;
  } else if (body.messages) {
    text = extractAllChatMessageText(body.messages);
  }
  return calculateTokens(text);
}

export function calculateAnthropicRequestTokens(body: AnthropicMessageRequest): number {
  const parts: string[] = [];

  if (typeof body.system === "string") {
    parts.push(body.system);
  } else if (Array.isArray(body.system)) {
    for (const item of body.system) {
      if (item && item.text) parts.push(item.text);
    }
  }

  for (const msg of body.messages ?? []) {
    if (typeof msg.content === "string") {
      parts.push(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block && typeof block === "object") {
          if (block.type === "text" && block.text) parts.push(block.text);
          if (block.type === "tool_result" && typeof block.content === "string") parts.push(block.content);
        }
      }
    }
  }

  return calculateTokens(parts.join(" "));
}
