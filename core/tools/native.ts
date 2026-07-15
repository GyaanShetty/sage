import { tool } from "ai";
import { z } from "zod";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { embedText, toVectorLiteral } from "@/infrastructure/embeddings";
import { searchKnowledge } from "@/core/knowledge/search";
import { webSearch } from "@/infrastructure/search/tavily";
import { listUnreadEmails, listUpcomingEvents } from "@/infrastructure/integrations/google";

/**
 * Native tools, MCP-shaped (name + description + JSON-schema input + execute).
 * Registered with the chat model so SAGE can act, not just talk.
 */
export const nativeTools = {
  create_task: tool({
    description:
      "Create a task/todo for the user. Use when they ask to add, track, or remind them to do something actionable.",
    inputSchema: z.object({
      title: z.string().max(200),
      dueAt: z.string().datetime().optional().describe("ISO datetime if the user gave a deadline"),
      priority: z.number().int().min(0).max(3).default(2).describe("0 urgent, 1 high, 2 normal, 3 low"),
    }),
    execute: async ({ title, dueAt, priority }) => {
      const { error } = await db.from("Task").insert({
        id: crypto.randomUUID(),
        userId: DEFAULT_USER_ID,
        title,
        priority,
        ...(dueAt ? { dueAt } : {}),
        source: "agent",
      });
      if (error) return { ok: false, error: error.message };
      return { ok: true, title };
    },
  }),

  list_tasks: tool({
    description: "List the user's open tasks (todo/doing), soonest due first.",
    inputSchema: z.object({}),
    execute: async () => {
      const { data, error } = await db
        .from("Task")
        .select("title, status, priority, dueAt")
        .eq("userId", DEFAULT_USER_ID)
        .in("status", ["todo", "doing"])
        .order("dueAt", { ascending: true, nullsFirst: false })
        .limit(20);
      if (error) return { ok: false, error: error.message };
      return { ok: true, tasks: data };
    },
  }),

  complete_task: tool({
    description: "Mark a task as done, matched by its (partial) title.",
    inputSchema: z.object({ titleContains: z.string() }),
    execute: async ({ titleContains }) => {
      const { data } = await db
        .from("Task")
        .select("id, title")
        .eq("userId", DEFAULT_USER_ID)
        .in("status", ["todo", "doing"])
        .ilike("title", `%${titleContains}%`)
        .limit(1);
      if (!data?.length) return { ok: false, error: "No matching open task" };
      await db.from("Task").update({ status: "done" }).eq("id", data[0].id);
      return { ok: true, completed: data[0].title };
    },
  }),

  calendar_events: tool({
    description: "List the user's upcoming Google Calendar events. Use for 'what's my day/week look like' questions.",
    inputSchema: z.object({}),
    execute: async () => {
      const events = await listUpcomingEvents().catch((e: Error) => {
        throw e;
      });
      if (events === null)
        return { ok: false, error: "Google Calendar not connected (Settings → Connect Google)" };
      return { ok: true, events };
    },
  }),

  unread_emails: tool({
    description: "List the user's unread Gmail inbox messages (sender, subject, snippet).",
    inputSchema: z.object({}),
    execute: async () => {
      const emails = await listUnreadEmails().catch((e: Error) => {
        throw e;
      });
      if (emails === null)
        return { ok: false, error: "Gmail not connected (Settings → Connect Google)" };
      return { ok: true, emails };
    },
  }),

  web_search: tool({
    description:
      "Search the live web for current information, news, prices, or anything beyond your training data. Cite result URLs in your answer.",
    inputSchema: z.object({ query: z.string() }),
    execute: async ({ query }) => {
      const results = await webSearch(query).catch((e: Error) => ({ error: e.message }));
      if (results === null)
        return { ok: false, error: "Web search not configured (TAVILY_API_KEY missing)" };
      if ("error" in (results as object))
        return { ok: false, error: (results as { error: string }).error };
      return { ok: true, results };
    },
  }),

  create_reminder: tool({
    description:
      "Set a reminder for the user at a specific time. Use for 'remind me to/at …' requests.",
    inputSchema: z.object({
      text: z.string().max(300),
      remindAt: z.string().datetime().describe("ISO datetime for when to remind"),
    }),
    execute: async ({ text, remindAt }) => {
      const { error } = await db.from("Reminder").insert({
        id: crypto.randomUUID(),
        userId: DEFAULT_USER_ID,
        text,
        remindAt,
      });
      if (error) return { ok: false, error: error.message };
      return { ok: true, text, remindAt };
    },
  }),

  list_reminders: tool({
    description: "List the user's upcoming pending reminders.",
    inputSchema: z.object({}),
    execute: async () => {
      const { data, error } = await db
        .from("Reminder")
        .select("text, remindAt, status")
        .eq("userId", DEFAULT_USER_ID)
        .eq("status", "pending")
        .order("remindAt", { ascending: true })
        .limit(20);
      if (error) return { ok: false, error: error.message };
      return { ok: true, reminders: data };
    },
  }),

  knowledge_search: tool({
    description:
      "Search the user's ingested knowledge base (PDFs, articles, docs they saved). Use when a question likely relates to their saved material. Cite source titles in your answer.",
    inputSchema: z.object({ query: z.string() }),
    execute: async ({ query }) => {
      const hits = await searchKnowledge(query);
      if (hits.length === 0) return { ok: true, hits: [], note: "Knowledge base empty or no match" };
      return {
        ok: true,
        hits: hits.map((h) => ({
          source: h.sourceTitle,
          excerpt: h.content.slice(0, 1200),
          similarity: Number(h.similarity.toFixed(3)),
        })),
      };
    },
  }),

  remember: tool({
    description:
      "Store an explicit long-term memory about the user. Use when they say 'remember …' or state something clearly worth keeping.",
    inputSchema: z.object({
      content: z.string().describe("One self-contained sentence, third person"),
      type: z.enum(["fact", "preference", "goal", "routine", "skill", "relationship", "episode"]),
    }),
    execute: async ({ content, type }) => {
      const embedding = await embedText(content).catch(() => null);
      const { error } = await db.from("Memory").insert({
        id: crypto.randomUUID(),
        userId: DEFAULT_USER_ID,
        type,
        content,
        confidence: 1.0,
        importance: 0.8,
        sourceType: "explicit",
        ...(embedding ? { embedding: toVectorLiteral(embedding) } : {}),
      });
      if (error) return { ok: false, error: error.message };
      return { ok: true, remembered: content };
    },
  }),
};
