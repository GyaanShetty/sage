import { tool } from "ai";
import { z } from "zod";
import { db, DEFAULT_USER_ID } from "@/infrastructure/db/supabase";
import { embedText, toVectorLiteral } from "@/infrastructure/embeddings";
import { searchKnowledge } from "@/core/knowledge/search";
import { webSearch } from "@/infrastructure/search/tavily";
import { proxyFetch } from "@/infrastructure/http/fetch";
import { createGmailDraft, listUnreadEmails, listUpcomingEvents, searchGmail } from "@/infrastructure/integrations/google";
import { githubSummary } from "@/infrastructure/integrations/github";
import { getNowPlaying, spotifyControl, spotifyPlaySearch } from "@/infrastructure/integrations/spotify";

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

  draft_email: tool({
    description:
      "Compose an email as a Gmail DRAFT for the user to review and send. Use when they ask to write/reply to an email. It never sends — it only drafts. Tell the user the draft is ready in Gmail.",
    inputSchema: z.object({
      to: z.string().describe("Recipient email address"),
      subject: z.string().max(200),
      body: z.string().describe("Full email body, plain text"),
    }),
    execute: async ({ to, subject, body }) => {
      const ok = await createGmailDraft(to, subject, body);
      if (ok === null) return { ok: false, error: "Gmail not connected (Settings → Connect Google)" };
      if (!ok) return { ok: false, error: "Could not create draft (re-connect Google for compose access)" };
      return { ok: true, to, subject, note: "Draft created in Gmail — review and send there." };
    },
  }),

  linkedin_activity: tool({
    description:
      "Surface the user's recent LinkedIn activity (connection requests, messages, notifications) from their Gmail, since LinkedIn has no direct API.",
    inputSchema: z.object({}),
    execute: async () => {
      const mail = await searchGmail("from:linkedin.com newer_than:7d");
      if (mail === null) return { ok: false, error: "Gmail not connected" };
      return { ok: true, items: mail.map((m) => ({ subject: m.subject, snippet: m.snippet.slice(0, 120) })) };
    },
  }),

  github_status: tool({
    description:
      "Check the user's GitHub: PRs awaiting their review, their open PRs, and recent repos. Use for 'what needs my review', 'my PRs', 'github status'.",
    inputSchema: z.object({}),
    execute: async () => {
      const summary = await githubSummary();
      if (summary === null) return { ok: false, error: "GitHub not configured" };
      return { ok: true, summary };
    },
  }),

  spotify_now: tool({
    description: "Check what's currently playing on the user's Spotify.",
    inputSchema: z.object({}),
    execute: async () => {
      const now = await getNowPlaying();
      if (now === null) return { ok: false, error: "Spotify not connected (Settings → Connect Spotify)" };
      if (!now.track) return { ok: true, playing: false, note: "Nothing playing" };
      return { ok: true, playing: now.playing, track: now.track, artist: now.artist };
    },
  }),

  spotify_control: tool({
    description:
      "Control Spotify playback. action: play/pause/next/previous, OR playSearch with a query to start a playlist/song (e.g. 'my focus playlist', 'lofi beats').",
    inputSchema: z.object({
      action: z.enum(["play", "pause", "next", "previous", "playSearch"]),
      query: z.string().optional(),
    }),
    execute: async ({ action, query }) => {
      const ok = action === "playSearch"
        ? await spotifyPlaySearch(query ?? "")
        : await spotifyControl(action);
      if (ok === null) return { ok: false, error: "Spotify not connected" };
      return { ok: !!ok, action, query };
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

  news_search: tool({
    description:
      "Search current news headlines about a specific topic (e.g. 'ISRO', 'RBI rate decision'). Prefer this over web_search for news questions.",
    inputSchema: z.object({ topic: z.string() }),
    execute: async ({ topic }) => {
      const key = process.env.GNEWS_API_KEY;
      if (key) {
        try {
          const res = await proxyFetch(
            `https://gnews.io/api/v4/search?q=${encodeURIComponent(topic)}&lang=en&country=in&max=6&apikey=${key}`,
            { signal: AbortSignal.timeout(8000) },
          );
          if (res.ok) {
            const j = (await res.json()) as {
              articles?: { title: string; source?: { name?: string }; publishedAt?: string; url: string }[];
            };
            const articles = (j.articles ?? []).map((a) => ({
              title: a.title,
              source: a.source?.name ?? "",
              publishedAt: a.publishedAt ?? "",
              url: a.url,
            }));
            if (articles.length) return { ok: true, articles };
          }
        } catch {}
      }
      // No GNews key (or it failed) — fall back to general web search.
      const results = await webSearch(`latest news: ${topic}`).catch(() => null);
      if (results === null) return { ok: false, error: "No news source configured" };
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
