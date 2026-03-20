# Chatbot Message Flagging — Design Spec

## Problem

Students have no way to report problematic chatbot responses (inaccurate, offensive, harmful, irrelevant). Admins have no visibility into chatbot quality issues. This creates a blind spot in LLM output quality monitoring.

## Solution

A message flagging system where students can flag assistant messages with a reason and optional comment, and admins can review, resolve, or dismiss flags through a dedicated panel.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Flaggable messages | Assistant only | Users report bad AI output, not their own input |
| Reason categories | Inaccurate, Inappropriate, Irrelevant, Harmful, Other | Standard AI chatbot set (ChatGPT/Copilot pattern) |
| Free-text comment | Optional on all categories | Gives admins richer context |
| Button placement | Bottom-right of message, hover-reveal | Eye lands there after reading; clean by default |
| Data architecture | Dedicated `chat_message_flags` table | Clean separation, supports multiple flags, extensible |
| Admin UI | Collapsible panel in Home.tsx | Follows existing admin panel pattern |
| Admin actions | View + mark reviewed / dismiss | Lightweight moderation without over-engineering |

---

## 1. Database Schema

### New table: `chat_message_flags`

```sql
CREATE TABLE public.chat_message_flags (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id  UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      VARCHAR(30) NOT NULL CHECK (reason IN (
                'inaccurate', 'inappropriate', 'irrelevant', 'harmful', 'other'
              )),
  comment     TEXT,
  status      VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN (
                'pending', 'reviewed', 'dismissed'
              )),
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(message_id, user_id)
);

CREATE INDEX idx_flags_status ON chat_message_flags(status);
CREATE INDEX idx_flags_created ON chat_message_flags(created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON chat_message_flags TO postgres;
```

**Migration file**: `backend/migrations/1650000000026_chat-message-flags.sql`

### Key constraints
- `UNIQUE(message_id, user_id)` — one flag per user per message
- `ON DELETE CASCADE` on message_id — flags cleaned up with messages
- `resolved_by` FK — audit trail of which admin handled the flag

---

## 2. API Endpoints

### Student endpoints (in `backend/routes/chat.js`)

Protected by existing `requireLogin` middleware.

#### `POST /chat/messages/:messageId/flag`

Creates a flag on an assistant message.

**Request body:**
```json
{
  "reason": "inappropriate",
  "comment": "This response felt judgmental"
}
```

**Validation:**
- `reason` required, must be one of the 5 categories
- `comment` optional, max 1000 characters
- Message must exist and be role='assistant'
- Message must belong to user's own session (IDOR check)
- User must not have already flagged this message (409 Conflict)

**Response:** `201 { flag: { id, message_id, reason, comment, created_at } }`

#### `DELETE /chat/messages/:messageId/flag`

Removes the user's own flag from a message.

**Validation:**
- Flag must exist for this user+message
- Only the flag creator can delete it
- Cannot unflag if admin has already reviewed or dismissed (status != 'pending') → 409 Conflict

**Response:** `200 { message: 'Flag removed' }`

#### `GET /chat/my-flags?sessionId=X`

Returns the message IDs the current user has flagged in the given session. Used to restore flag state when loading chat history.

**Response:** `200 { flaggedMessageIds: ["uuid1", "uuid2"] }`

### Admin endpoints (in `backend/routes/admin.js`)

Protected by existing `requireAdmin` middleware (applied at router level).

#### `GET /admin/flagged-messages`

List flags with filtering and pagination.

**Query params:**
- `status` — filter by status ('pending', 'reviewed', 'dismissed', omit for all)
- `limit` — max 50, default 20
- `offset` — default 0

**Response:**
```json
{
  "flags": [
    {
      "id": "uuid",
      "reason": "inappropriate",
      "comment": "This response felt judgmental",
      "status": "pending",
      "created_at": "2026-03-19T10:00:00Z",
      "student_email": "student5@example.com",
      "student_name": "Student Five",
      "message_content": "Based on your data, you seem to be struggling...",
      "user_message_content": "How can I improve my study habits?",
      "resolved_by_email": null,
      "resolved_at": null
    }
  ],
  "total": 10,
  "counts": { "pending": 3, "reviewed": 5, "dismissed": 2 }
}
```

The query JOINs `chat_message_flags` with `chat_messages` (for content), `users` (for student info), and self-joins to get the preceding user message for context.

#### `PUT /admin/flagged-messages/:flagId`

Update flag status.

**Request body:**
```json
{ "status": "reviewed" }
```

**Validation:**
- `status` must be 'reviewed' or 'dismissed'
- Flag must exist

**Response:** `200 { flag: { id, status, resolved_by, resolved_at } }`

Sets `resolved_by` to current admin user and `resolved_at` to NOW().

---

## 3. Frontend — Student Flag Flow

### Location: `src/components/Chatbot.tsx`

#### Flag icon (hover-reveal)
- On assistant messages only, a small flag icon (⚑) fades in at the **bottom-right** of the message bubble when the user hovers over it
- CSS: `opacity: 0` by default, `opacity: 0.6` on `.chat-message:hover`, transitions smoothly
- If already flagged: icon is filled/red with tooltip "Flagged — click to unflag"

#### Flag modal (inline in chat widget)
- Triggered by clicking the flag icon
- Renders as a small overlay/popover inside the chat window (not a full-page modal)
- Contents:
  - Title: "Report this response"
  - 5 radio buttons with labels:
    - Inaccurate / Misleading
    - Inappropriate / Offensive
    - Irrelevant / Off-topic
    - Harmful / Unsafe
    - Other
  - Textarea: "Add a comment (optional)" — max 1000 chars
  - Buttons: "Submit Report" (primary) and "Cancel" (secondary)
- On submit: `POST /chat/messages/:messageId/flag`
- On success: close modal, update icon to filled/red state, show brief toast "Response flagged"
- On error: show inline error message

#### Unflag flow
- Click filled red flag icon → confirmation: "Remove your flag?" with Yes/No
- On confirm: `DELETE /chat/messages/:messageId/flag`
- On success: revert icon to default state

### State management
- Track flagged message IDs in local component state: `flaggedMessageIds: Set<string>`
- On chat load, fetch the user's flags for the current session via a separate lightweight endpoint: `GET /chat/my-flags?sessionId=X` (returns array of message IDs the user has flagged)
- This avoids modifying the existing chat history endpoint

---

## 4. Frontend — Admin Panel

### New component: `src/components/AdminFlaggedMessagesPanel.tsx`

#### Layout
- Collapsible panel (follows AdminClusterDiagnosticsPanel / AdminLlmConfigPanel pattern)
- Header: flag icon + "Flagged Messages" + red badge with pending count
- Gradient header: red-to-amber (matching the alert/warning tone)

#### Filter pills
- Row of pill buttons: Pending (active by default), Reviewed, Dismissed, All
- Active pill is filled with accent color, others are outlined
- Counts shown in each pill label

#### Flag cards
- Each flag renders as an expandable card
- **Collapsed state**: reason badge (color-coded), student email, relative time, status badge, expand arrow
- **Expanded state** (click to toggle):
  - "Student asked:" — the user's message before the flagged response
  - "Flagged response:" — the assistant message (highlighted border)
  - "Student comment:" — the optional comment (italic)
  - Action buttons: "Mark Reviewed" (green outline) and "Dismiss" (gray outline)
- Reviewed/dismissed cards are visually dimmed (opacity 0.7)

#### Reason badge colors
| Reason | Background | Text |
|--------|-----------|------|
| Inaccurate | `#dbeafe` | `#1e40af` (blue) |
| Inappropriate | `#fecaca` | `#991b1b` (red) |
| Irrelevant | `#e5e7eb` | `#374151` (gray) |
| Harmful | `#fde68a` | `#92400e` (amber) |
| Other | `#f3f4f6` | `#6b7280` (neutral) |

#### Status badge colors
| Status | Background | Text |
|--------|-----------|------|
| Pending | `#fef3c7` | `#92400e` (amber) |
| Reviewed | `#ecfdf5` | `#065f46` (green) |
| Dismissed | `#f3f4f6` | `#6b7280` (gray) |

#### Data fetching
- Fetch on mount: `GET /admin/flagged-messages?status=pending`
- Re-fetch when filter changes
- Optimistic UI update on resolve/dismiss (update local state immediately, rollback on error)

### API module: `src/api/flaggedMessages.ts`

```typescript
import { api } from './client'

interface Flag {
  id: string
  reason: string
  comment: string | null
  status: 'pending' | 'reviewed' | 'dismissed'
  created_at: string
  student_email: string
  student_name: string
  message_content: string
  user_message_content: string | null
  resolved_by_email: string | null
  resolved_at: string | null
}

interface FlagListResponse {
  flags: Flag[]
  total: number
  counts: { pending: number; reviewed: number; dismissed: number }
}

export async function getFlaggedMessages(
  status?: string, limit = 20, offset = 0
): Promise<FlagListResponse> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (status) params.set('status', status)
  return api.get(`/admin/flagged-messages?${params}`)
}

export async function updateFlagStatus(
  flagId: string, status: 'reviewed' | 'dismissed'
): Promise<{ flag: Flag }> {
  return api.put(`/admin/flagged-messages/${flagId}`, { status })
}
```

### Student flag API: added to `src/api/chat.ts`

```typescript
export async function flagMessage(messageId: string, reason: string, comment?: string) {
  return api.post(`/chat/messages/${messageId}/flag`, { reason, comment })
}

export async function unflagMessage(messageId: string) {
  return api.delete(`/chat/messages/${messageId}/flag`)
}

export async function getMyFlags(sessionId: string): Promise<{ flaggedMessageIds: string[] }> {
  return api.get(`/chat/my-flags?sessionId=${sessionId}`)
}
```

---

## 5. Files to Create/Modify

### New files
| File | Purpose |
|------|---------|
| `backend/migrations/1650000000026_chat-message-flags.sql` | Database migration |
| `src/components/AdminFlaggedMessagesPanel.tsx` | Admin panel component |
| `src/api/flaggedMessages.ts` | Admin API module |

### Modified files
| File | Changes |
|------|---------|
| `backend/routes/chat.js` | Add POST/DELETE flag endpoints |
| `backend/routes/admin.js` | Add GET/PUT flagged-messages endpoints |
| `src/components/Chatbot.tsx` | Add flag icon on assistant messages, flag modal, unflag flow |
| `src/components/Chatbot.css` | Styles for flag icon, modal, flagged state |
| `src/api/chat.ts` | Add flagMessage(), unflagMessage() functions |
| `src/pages/Home.tsx` | Import and render AdminFlaggedMessagesPanel |

---

## 6. Verification

### Manual testing
1. **Student flag flow**: Log in as student → open chatbot → hover over assistant message → see flag icon bottom-right → click → select reason + comment → submit → icon turns red
2. **Unflag flow**: Click red flag icon → confirm unflag → icon reverts
3. **Duplicate prevention**: Flag same message again → should show "already flagged" or prevent re-flagging
4. **Admin panel**: Log in as admin → scroll to Flagged Messages panel → see pending flags → expand card → see full context → click "Mark Reviewed" → card updates → filter by Reviewed to confirm
5. **IDOR check**: Try to flag a message from another user's session → should get 403

### Automated tests
- Backend: Test flag CRUD endpoints (create, delete, list, update status)
- Backend: Test validation (invalid reason, missing message, IDOR)
- Backend: Test unique constraint (duplicate flag → 409)
