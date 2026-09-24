# V2 — Interactive Analysis

> Transform Coach-XYZ from a one-shot analysis tool into a conversational sports coaching interface.

> **Status (2026-09-11): largely implemented.** Streaming SSE chat, Redis + Supabase persistence,
> split-screen video + chat layout, timestamp seeking, and quick actions ship in the app. V2 features
> that remain unbuilt are explicitly marked below. This doc keeps the original design text for reference.
> **2026-09-24:** the server's non-streaming `POST /api/chat` was removed — the server now exposes only
> `POST /api/chat/stream` (the web only ever called it); the engine keeps `POST /chat` for the
> auth-scoped dashboard chat. Sections marked "original design" below are annotated accordingly.

---

## 1. Vision

**Today:** Upload video → wait 60s → get a static report → download video → done.

**V2:** Upload video → get initial analysis → **chat with an AI coach** about the video → ask follow-up questions → drill into specific moments → get personalized drills → export a full coaching report.

The experience should feel like **Claude for sports video** — a persistent, context-aware conversation where the video is the shared reference point.

---

## 2. What Changes

### 2.1 The Core Shift

| Aspect | V1 | V2 |
|---|---|---|
| **Interaction model** | One-shot pipeline | Conversational loop |
| **Output** | Static report | Dynamic dialogue |
| **User agency** | Passive (wait for results) | Active (ask, explore, drill) |
| **Depth** | Summary-level | Timestamp-level, on-demand |
| **Return visits** | None (state lost on refresh) | Persistent conversations |
| **AI role** | Analyzer | Coach / analyst / teacher |

### 2.2 New Capabilities

1. ✅ **Chat interface** — Claude-like message thread with typing indicators and **streaming** responses (`ChatLayout`/`ChatPanel`, SSE via `/api/chat/stream`)
2. ✅ **Context-aware follow-ups** — AI remembers the full analysis and conversation history
3. ✅ **Timestamp references** — AI points to specific moments; references render as seekable buttons in the video player
4. ⚠️ **Deep-dive queries** — "Break down my 3-point form"; supported via prompt grounding + `timestamp_refs`/`event_refs`, but no dedicated re-analysis of other events
5. ⚠️ **Drill generation** — "Give me 3 drills for my weak side"; works as free-text, no structured drill card
6. ⚠️ **Comparison mode** — "How did my second shot differ from my first?"; offered via the `QuickActions` Compare chip, free-text only
7. ✅ **Conversation persistence** — Redis (`coachai:conv:*`, 2h) + Supabase `chat_messages` table, browsable from dashboard
8. ✅ **Video + chat side-by-side** — Video player with timestamp sync alongside chat (`ChatLayout`)

---

## 3. User Flow (V2)

```
┌──────────┐     ┌──────────┐     ┌──────────────────────────────────────┐
│  Upload   │────▶│  Scan /  │────▶│  Interactive Analysis                │
│  Video    │     │  Detect  │     │  ┌─────────────┐  ┌──────────────┐  │
└──────────┘     │  Players │     │  │   Video      │  │   Chat       │  │
                  └──────────┘     │  │   Player     │  │   Panel      │  │
                                   │  │   + Controls │  │   Messages   │  │
                                   │  └─────────────┘  │   Input      │  │
                                   │                    └──────────────┘  │
                                   └──────────────────────────────────────┘
                                              │
                                   AI auto-generates initial summary
                                   User asks follow-up questions
                                   User drills into specific moments
                                   User requests drills / exports
```

### Entry Points

| Entry | What Happens |
|---|---|
| **Fresh upload** | Scan → detect players → auto-analyze → chat opens with AI's initial summary |
| **Resume conversation** | Load existing conversation from history, show previous messages |
| **New question on same video** | Continue conversation, AI has full context |

---

## 4. Chat Interface Design

### 4.1 Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ coach.xyz                          [New Analysis]  [History]     │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────────────┐  ┌──────────────────────────────┐ │
│  │                          │  │                              │ │
│  │     VIDEO PLAYER         │  │     CHAT MESSAGES            │ │
│  │     ┌──────────────────┐ │  │                              │ │
│  │     │                  │ │  │  ┌────────────────────────┐  │ │
│  │     │   [video here]   │ │  │  │ 🤖 Analysis Summary   │  │ │
│  │     │                  │ │  │  │ Form score: 7.2/10     │  │ │
│  │     └──────────────────┘ │  │  │ 8 events detected...   │  │ │
│  │     ──●───────────────   │  │  └────────────────────────┘  │ │
│  │     0:00    0:45    1:30 │  │                              │ │
│  │                          │  │  ┌────────────────────────┐  │ │
│  │  [Download Video]        │  │  │ 👤 What about my form  │  │ │
│  │  [Export Report]         │  │  │ on the 3-pointers?     │  │ │
│  │                          │  │  └────────────────────────┘  │ │
│  │  ─────────────────────── │  │                              │ │
│  │  📊 Form Score: 7.2/10  │  │  ┌────────────────────────┐  │ │
│  │  🏀 Basketball           │  │  │ 🤖 Your 3-point form   │  │ │
│  │  ⚡ 8 events             │  │  │ shows good arc but...  │  │ │
│  │                          │  │  │ [Jump to 0:12]         │  │ │
│  │  Quick Actions:          │  │  └────────────────────────┘  │ │
│  │  [Strengths] [Weakness]  │  │                              │ │
│  │  [Drills] [Compare]      │  │  ┌────────────────────────┐  │ │
│  │                          │  │  │ Type your message...   │  │ │
│  └──────────────────────────┘  │  └────────────────────────┘  │ │
│                                 └──────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Message Types

| Sender | Content | Features |
|---|---|---|
| **User** | Plain text question | — |
| **AI** | Text response | Markdown support, timestamp links, event references |
| **AI** | Analysis card | Embedded form score, event list, strengths/weaknesses |
| **AI** | Drill card | Structured drill with steps, focus area, difficulty |
| **AI** | Video reference | Clickable timestamp that seeks the video player |
| **System** | Status updates | "Analysis complete", "Video ready", errors |

### 4.3 Quick Actions

Pre-built buttons below the video for common queries:

| Action | Prompt Sent | Response |
|---|---|---|
| **Summarize** | "Give me a summary of this analysis" | AI recaps form score, key findings |
| **Strengths** | "What are my strengths in this session?" | AI lists top strengths with timestamps |
| **Weaknesses** | "What should I improve?" | AI lists priority fixes with timestamps |
| **Drill** | "Give me a practice drill for my weakest area" | AI generates a specific drill |
| **Compare shots** | "Compare my best and worst shots" | AI picks top/bottom events, contrasts them |
| **Timestamp** | "What happened at 0:15?" | AI describes that moment in detail |
| **Export** | "Generate a full coaching report" | AI compiles conversation into structured report |

---

## 5. Technical Architecture

### 5.1 Engine Changes

#### New Endpoint: `POST /chat`

```
Request:
{
  "job_id": "engine-uuid",
  "message": "What about my elbow angle on the jump shots?",
  "conversation_history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}

Response (streaming):
{
  "reply": "Looking at your jump shots at 0:12 and 0:28...",
  "timestamp_refs": [12.3, 28.1],
  "event_refs": [1, 3]
}
```

#### How It Works

1. **Load context** — Retrieve the original analysis result (summary + shot events) from Redis
2. **Build prompt** — Construct a Gemini prompt that includes:
   - Original analysis results (structured data)
   - Conversation history (previous Q&A)
   - User's new question
   - Instructions to reference timestamps and events
3. **Call Gemini** — Non-streaming initially (streaming in V2.1)
4. **Parse response** — Extract timestamp references, event references
5. **Return reply** — Text response with embedded references

#### New Prompt Template: `get_chat_prompt()`

```python
def get_chat_prompt(analysis_result: dict, conversation_history: list, user_message: str) -> str:
    return f"""You are an expert sports coach analyzing a video with the athlete.

ANALYSIS CONTEXT:
{json.dumps(analysis_result, indent=2)}

CONVERSATION HISTORY:
{format_history(conversation_history)}

ATHLETE'S QUESTION:
{user_message}

INSTRUCTIONS:
- Answer based on the analysis data above
- Reference specific timestamps (e.g., "At 0:12.3...")
- Reference specific events by number (e.g., "In event 3...")
- Be specific, actionable, and encouraging
- If the question goes beyond the data, say so honestly
- Use markdown formatting for readability
"""
```

#### Session Context in Engine

The engine already stores analysis results in Redis (`coachai:job:<job_id>`). The `summary` field contains the full `AnalysisSummary` with shot events. This becomes the context for chat.

**No new storage needed** — the existing Redis job already has everything.

### 5.2 Server Changes

#### Server Endpoint: `POST /api/chat` — ~~shipped~~ **removed 2026-09-24**

Original design (kept for reference): proxied to engine `/chat` with server job →
engine job mapping.

```
POST /api/chat
Body: { "message": "...", "conversation_id": "..." }

Response: { "reply": "...", "timestamp_refs": [...], "event_refs": [...] }
```

**Today:** the server exposes only `POST /api/chat/stream` (SSE) — the web never
called the non-streaming route, so it was removed in the 2026-09-24 routing sync.
The engine's `POST /chat` lives on: the auth-scoped dashboard chat
(`routes/chatHistory.ts`) calls it through `askEngineChat(payload, requestId)`
(`lib/engine.ts`).

#### Conversation Storage

Store conversation history in Redis alongside the server job:

```
Key:    coachai:conv:<server_job_id>
Value:  { messages: [{ role, content, timestamp_refs, event_refs, created_at }], ... }
TTL:    7200s (2 hours, aligned with job TTL)
```

**Why Redis (not Supabase):**
- Conversations are ephemeral (tied to active analysis)
- Sub-millisecond reads for streaming
- Already have Redis infrastructure
- Can migrate to Supabase later for persistence

#### New Server Library: `server/src/lib/conversation.ts`

```typescript
// Save a message to conversation history
saveMessage(serverJobId: string, message: ChatMessage): Promise<void>

// Get full conversation history
getConversation(serverJobId: string): Promise<ChatMessage[]>

// Clear conversation
clearConversation(serverJobId: string): Promise<void>
```

### 5.3 Frontend Changes

#### New Components

| Component | Purpose |
|---|---|
| `ChatPanel` | Main chat container with message list and input |
| `ChatMessage` | Individual message bubble (user or AI) |
| `ChatInput` | Text input with send button |
| `ChatTyping` | Typing indicator (three dots animation) |
| `VideoPlayer` | Video player with timestamp controls |
| `QuickActions` | Pre-built action buttons below video |
| `AnalysisCard` | Embedded analysis summary in chat |
| `DrillCard` | Embedded drill response in chat |
| `TimestampLink` | Clickable timestamp that seeks video |
| `ConversationHistory` | Sidebar listing past conversations |

#### New State: `useConversation()`

```typescript
function useConversation(jobId: string) {
  return {
    messages: ChatMessage[],
    isTyping: boolean,
    sendMessage: (text: string) => Promise<void>,
    loadHistory: () => Promise<void>,
    seekTo: (timestamp: number) => void,  // controls video player
  }
}
```

#### Updated `usePipeline()`

Add a new pipeline state: `chatting` (after analysis completes).

```
idle → uploading → scanning → selecting → analyzing → rendering → chatting
                                                                        │
                                                              completed (old flow)
                                                              chatting (new flow)
```

The `chatting` state renders the split-screen video + chat layout.

---

## 6. Gemini Chat Prompt Strategy

### 6.1 Context Window

The chat prompt includes:
1. **System instructions** (~500 tokens) — role, behavior, formatting rules
2. **Analysis result** (~2000 tokens) — full summary + shot events JSON
3. **Conversation history** (~500–2000 tokens) — previous messages
4. **User message** (~50–200 tokens)

**Total:** ~3000–5000 tokens per chat call. Well within Gemini Flash's 1M context window.

### 6.2 Prompt Design Principles

1. **Data-grounded** — AI must reference the actual analysis data, not hallucinate
2. **Timestamp-accurate** — All timestamp references must match the analysis
3. **Actionable** — Every response should include something the athlete can do
4. **Honest** — If the data doesn't support a conclusion, say so
5. **Concise** — Sports coaches don't want essays

### 6.3 Streaming (V2.1)

Initial V2 uses non-streaming Gemini calls. V2.1 adds:
- `generate_content_stream()` for real-time token delivery
- Server-Sent Events (SSE) from server to frontend
- Typewriter effect in chat bubbles

---

## 7. Conversation Persistence

### 7.1 Storage Tiers

| Tier | Storage | TTL | Purpose |
|---|---|---|---|
| **Hot** | Redis | 2 hours | Active conversations |
| **Warm** | Supabase | 30 days | Recent history (browsable) |
| **Cold** | — | — | Not implemented (future: S3 export) |

### 7.2 History UI

A slide-out panel showing:
- Video thumbnail
- Date/time of analysis
- Sport type
- Form score
- Number of messages
- Click to resume

### 7.3 Session Expiry

- Conversations expire with the job (2h TTL)
- Users can "Export" to save to Supabase before expiry
- Exported conversations are browsable from the history panel

---

## 8. Video + Chat Sync

### 8.1 Timestamp References

When the AI mentions a timestamp in its response:
```markdown
At **0:12.3**, your elbow angle was 87° — slightly below the ideal 90–100° range.
```

The timestamp becomes a clickable link:
```tsx
<button onClick={() => seekTo(12.3)}>0:12.3</button>
```

Clicking seeks the video player to that exact frame.

### 8.2 Event References

When the AI references a specific event:
```markdown
In **Event 3** (Jump Shot at 0:28.1), your follow-through was clean...
```

The event reference highlights the corresponding event in the timeline.

### 8.3 Auto-Seek on AI Response

When the AI response includes `timestamp_refs`, the video player automatically:
1. Shows a subtle highlight on the timeline at those timestamps
2. Does NOT auto-play (user controls playback)
3. Optionally thumbnails the frame at that timestamp

---

## 9. Implementation Phases

### Phase 1: Engine Chat Endpoint (Backend) — ✅ Done
- Add `POST /chat` endpoint to engine (`engine/api/chat.py:55`)
- Build `get_chat_prompt()` with analysis context (`engine/core/chat_prompt.py`)
- Add conversation_history support to Gemini calls
- Also added `POST /chat/stream` (SSE) (`engine/api/chat.py:88`)

### Phase 2: Server Chat Proxy + Storage — ✅ Done (route since removed)
- ~~Add `POST /api/chat` endpoint to server (`server/src/routes/chat.ts:26`)~~ — removed 2026-09-24 (dead: web only used the stream); `chat.ts` now serves `/api/chat/stream` + `/api/conversation/:jobId`
- Create `conversation.ts` library for Redis storage (`server/src/lib/conversation.ts`)
- Add conversation persistence on each message (`saveMessage` with Lua append)
- Add `GET /api/conversation/:jobId` for history loading (`chat.ts:228`)
- **Bonus:** `POST /api/chat/stream` (SSE, `tee()`d) and auth-scoped chat persisted to Supabase `chat_messages`

### Phase 3: Chat UI Components — ✅ Done
- Build `ChatPanel`, `ChatMessage`, `ChatInput`, `ChatTyping`
- Build `VideoPlayer` with timestamp seeking
- Build `QuickActions` bar (Strengths / Weaknesses / Drill / Compare)
- `TimestampLink` folded into `ChatMessage` (bare `12.3s` tokens + `timestamp_refs` → seek buttons)

### Phase 4: Layout + Integration — ✅ Done
- Create split-screen layout (video left, chat right) — `ChatLayout.tsx`
- Add `chatting` pipeline state (`usePipeline.ts`)
- Wire `useConversation()`-equivalent state (loading via `getConversation`, streaming via `sendChatMessageStream`)
- Connect video player seek to AI timestamp references (`onSeekTo` handle)

### Phase 5: Polish + History — ⚠️ Partial
- ✅ Conversation history in dashboard (`GET/POST /api/auth/user/:id/analyses/:jobId/chat`, `HistoryChat.tsx`)
- ❌ Conversation-history *sidebar* listing past conversations (planned `ConversationHistory` component)
- ❌ Export functionality (report export not built)
- ✅ Typing indicator + streaming done (beyond the old "V2.1" plan)

---

## 10. API Contract Summary

### New Endpoints

| Endpoint | Method | Layer | Purpose | Status |
|---|---|---|---|---|
| `POST /api/chat` | POST | Server | Send message, get AI reply | ❌ removed 2026-09-24 (use `/api/chat/stream`) |
| `POST /api/chat/stream` | POST | Server | SSE streaming chat | ✅ implemented (beyond original plan) |
| `GET /api/conversation/:jobId` | GET | Server | Load conversation history (Redis) | ✅ implemented |
| `DELETE /api/conversation/:jobId` | DELETE | Server | Clear conversation | ❌ not implemented |
| `POST /chat` | POST | Engine | Chat with AI (called by the server's auth-scoped chat; `/chat/stream` proxied to `/api/chat/stream`) | ✅ implemented |
| `POST /chat/stream` | POST | Engine | SSE streaming chat | ✅ implemented |
| `GET/POST /api/auth/user/:auth0Id/analyses/:jobId/chat` | GET/POST | Server | Auth-scoped chat persisted to Supabase `chat_messages` (engine errors surface; keyword fallback only on connectivity loss) | ✅ implemented |

### Updated Types

```typescript
// New types for V2
type ChatMessage = {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp_refs?: number[]   // timestamps mentioned in response
  event_refs?: number[]       // events referenced
  created_at: number
}

type ChatRequest = {
  job_id: string
  message: string
  conversation_history: ChatMessage[]
}

type ChatResponse = {
  reply: string
  timestamp_refs: number[]
  event_refs: number[]
}
```

---

## 11. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Gemini hallucinates timestamps not in analysis | Misleading feedback | Prompt explicitly requires grounding in provided data; validate refs server-side |
| Chat latency too high (>5s) | Poor UX | Use Gemini Flash (fast); add streaming in V2.1; show typing indicator |
| Conversation history exceeds context window | Truncated context | Summarize older messages; keep last N messages; use sliding window |
| Redis conversation expires mid-session | Lost context | Warn user at 90min; offer export; extend TTL on activity |
| User asks about things not in the video | AI can't help | Prompt instructs AI to redirect to available data |
