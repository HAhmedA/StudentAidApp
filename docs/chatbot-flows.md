# Chatbot Interaction Flows

## Overview

The chatbot system has several interaction flows. Each flow involves different services working together.

---

## Flow 1: Initial Greeting (Login/Page Load)

```mermaid
sequenceDiagram
    participant U as User (Browser)
    participant F as Frontend (Chatbot.tsx)
    participant R as chat.js Routes
    participant CM as contextManagerService
    participant PA as promptAssemblerService
    participant LLM as Gemini LLM
    participant DB as PostgreSQL

    U->>F: Login / Opens App
    F->>R: GET /api/chat/initial
    R->>CM: getOrCreateSession(userId)
    CM->>DB: Check active sessions
    alt Existing Session with Messages
        DB-->>CM: Session + messages exist
        CM->>DB: getSessionHistory()
        DB-->>CM: Recent messages
        CM-->>R: {messages, hasExistingSession: true}
        R-->>F: Return existing messages
        F->>U: Display chat history
    else New Session
        DB-->>CM: No active session
        CM->>DB: Create new session
        CM->>PA: assembleInitialGreetingPrompt()
        PA->>DB: Fetch profile, SRL data, summaries
        DB-->>PA: User context
        PA-->>CM: Assembled prompt
        CM->>LLM: Generate greeting
        LLM-->>CM: Greeting response
        CM->>DB: Cache greeting in session
        CM-->>R: {greeting, sessionId}
        R-->>F: Return greeting
        F->>U: Display greeting + red badge
    end
```

---

## Flow 2: User Sends Message

**Why contextManager → alignmentService?**  
The `contextManagerService.sendMessage()` orchestrates the message flow. After getting an LLM response, it calls `alignmentService.getAlignedResponse()` to validate the response using the LLM-as-Judge pattern. This ensures every response passes quality/safety checks before being shown to the user.

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant R as Routes
    participant CM as contextManagerService
    participant PA as promptAssemblerService
    participant AS as alignmentService
    participant LLM as Gemini LLM
    participant DB as Database

    U->>F: Types message + clicks Send
    F->>F: Add user message to UI
    F->>R: POST /api/chat/message
    R->>CM: sendMessage(userId, message)
    CM->>PA: assemblePrompt(userId, sessionId, message)
    
    PA->>DB: Parallel fetch
    Note over PA,DB: getSystemPrompt()<br/>getUserContext()<br/>getAnnotations()<br/>getSummaries()<br/>getSessionMessages()
    DB-->>PA: All context data
    PA-->>CM: Complete messages array
    
    CM->>AS: getAlignedResponse(generateFn, query, instructions)
    
    loop Max 2 attempts (1 retry)
        AS->>LLM: Generate response (Main LLM)
        LLM-->>AS: Response text
        AS->>LLM: Judge response (Judge LLM)
        LLM-->>AS: {passed: true/false, reason}
        alt Passed
            AS-->>CM: {content, passed: true}
        else Failed
            AS->>AS: Retry generation
        end
    end
    
    CM->>DB: saveMessage(user + assistant)
    CM-->>R: {response, sessionId}
    R-->>F: JSON response
    F->>U: Display assistant message
```

---

## Flow 3: Alignment Check Detail

**What is Quick Validation?**  
Quick validation is a fast pre-check that runs BEFORE calling the Judge LLM. It's a simple function that checks for obvious failures:
- Empty or whitespace-only responses
- Accidentally exposed internal markers like "SYSTEM PROMPT", "ANNOTATED QUESTIONNAIRE", `user_id:`, `session_id:`, etc.

This saves an expensive LLM call when failures are obvious.

```mermaid
flowchart TD
    A[LLM Response Generated] --> B{Quick Validation}
    B -->|Empty response| C[FAIL - Empty]
    B -->|Internal markers found| D["FAIL - Exposed: SYSTEM PROMPT, user_id, etc."]
    B -->|Passed| E[Build Judge Prompt]
    
    E --> F[Send to Judge LLM]
    F --> G{Parse JSON Result}
    G -->|Invalid JSON| H[FAIL - Parse Error]
    G -->|Valid JSON| I{passed == true?}
    
    I -->|Yes| J[✅ Return Response]
    I -->|No| K{Retries < 1?}
    
    K -->|Yes| L[Regenerate Response]
    L --> A
    K -->|No| M[❌ Return Fallback Message]
    
    subgraph Quick Validation Checks
        N[1. Empty/whitespace check]
        O["2. Internal markers: SYSTEM PROMPT"]
        P["3. Internal markers: ANNOTATED QUESTIONNAIRE"]
        Q["4. Internal markers: user_id, session_id"]
        R["5. Raw JSON output: json blocks"]
    end
    
    subgraph Judge Criteria
        S[1. Instruction Adherence]
        T[2. Safety & Appropriateness]
        U[3. Relevance & Helpfulness]
        V[4. Accuracy]
        W[5. Clarification & Honesty]
        X[6. Factual Accuracy]
        Y[7. Appropriate Response]
        Z[8. Context Tracking]
    end
```

---

## Flow 4: New Conversation (Reset)

**Note:** `generateInitialGreeting()` internally calls `promptAssemblerService.assembleInitialGreetingPrompt()` to gather all user context before generating the greeting.

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant R as Routes
    participant CM as contextManagerService
    participant PA as promptAssemblerService
    participant DB as Database
    participant LLM as LLM

    U->>F: Click Reset Button
    F->>R: POST /api/chat/reset
    R->>CM: resetSession(userId)
    CM->>DB: Mark old sessions inactive
    CM->>DB: Create new session
    CM->>CM: generateInitialGreeting()
    CM->>PA: assembleInitialGreetingPrompt(userId)
    PA->>DB: Fetch profile, SRL, summaries
    DB-->>PA: User context data
    PA-->>CM: Assembled greeting prompt
    CM->>LLM: Generate fresh greeting
    LLM-->>CM: New greeting
    CM->>DB: Cache greeting
    CM-->>R: {newSessionId, greeting}
    R-->>F: Success + greeting
    F->>F: Clear messages array
    F->>F: Clear cached greeting
    F->>U: Display fresh greeting
```

---

## Data Flow Summary

```mermaid
flowchart LR
    subgraph Frontend
        A[Chatbot.tsx]
    end
    
    subgraph Backend Routes
        B[chat.js]
    end
    
    subgraph Services
        C[contextManagerService]
        D[promptAssemblerService]
        E[alignmentService]
        F[annotationService]
        G[summarizationService]
    end
    
    subgraph External
        H[(PostgreSQL)]
        I[Gemini LLM]
    end
    
    A <-->|HTTP| B
    B --> C
    C --> D
    C --> E
    D --> F
    D --> G
    D --> H
    C --> H
    E --> I
    D --> I
```

---

## Key Components

| Component | Role |
|-----------|------|
| **Chatbot.tsx** | UI, state management, API calls |
| **chat.js** | Express routes, auth middleware |
| **contextManagerService** | Session lifecycle, message orchestration |
| **promptAssemblerService** | Combines system prompt + user data + history |
| **alignmentService** | LLM-as-Judge validation + quick validation |
| **annotationService** | SRL questionnaire data formatting |
| **summarizationService** | 10-day rolling chat summaries |

---

## Configuration

| Setting | Value | Location |
|---------|-------|----------|
| MAX_ALIGNMENT_RETRIES | 1 | alignmentService.js |
| SESSION_TIMEOUT | 30 min | contextManagerService.js |
| SUMMARY_WINDOW_DAYS | 10 | summarizationService.js |
| MAX_SESSION_MESSAGES | 20 | promptAssemblerService.js |
