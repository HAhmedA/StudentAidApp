# Questionnaire Restructure, Dashboard Cleanup & Onboarding Wizard

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the 14-question SRL survey into a 15-question two-section questionnaire (5 wellbeing + 10 learning), remove Focus Areas from dashboard gauges, and build a daily stepper wizard with first-time consent.

**Architecture:** The questionnaire change cascades through backend question definitions, annotation service, simulator, prompt assembler, and frontend concepts. The onboarding wizard replaces the current modal with a full-page stepper that runs daily (questionnaire → screen time → sleep), with consent + intro prepended on first visit and optional profile at the end. Wellbeing responses are stored in DB and sent to chatbot only — never displayed on gauges or dashboard.

**Tech Stack:** React + TypeScript (Vite), Node.js ESM + Express, PostgreSQL (node-pg-migrate), SurveyJS, Redux

---

## File Map

### Files to Create
| File | Purpose |
|------|---------|
| `backend/migrations/1650000000022_questionnaire-wellbeing-consent.sql` | DB: wipe old SRL data, add user_consents + wellbeing_responses tables |
| `backend/routes/consent.js` | API: GET/POST consent, POST revoke (with full data deletion) |
| `src/components/DailyWizard.tsx` | Stepper wizard: consent → intro → questionnaire → screen time → sleep → profile |
| `src/components/DailyWizard.css` | Wizard styling |

### Files to Modify
| File | What Changes |
|------|-------------|
| `backend/routes/surveys.js` | New 2-page survey template (5 wellbeing + 10 learning); force-update stored JSON |
| `backend/services/annotators/srlAnnotationService.js` | CONCEPT_SHORT_NAMES: 14→10 keys; add saveWellbeingResponses + getWellbeingForChatbot |
| `backend/services/simulators/srlDataSimulator.js` | CONCEPT_GROUPS: update for 10 keys; add wellbeing simulation |
| `backend/services/promptAssemblerService.js` | Add wellbeing section to both assemblePrompt + assembleInitialGreetingPrompt |
| `backend/config/concepts.js` | SRL dimensions: update to new 10 keys |
| `backend/routes/results.js` | Call saveWellbeingResponses on submission |
| `backend/routes/index.js` | Register consent routes |
| `src/constants/concepts.ts` | DOMAIN_TIPS + DOMAIN_DESCRIPTIONS: update to 10 SRL keys, remove stale entries |
| `src/components/ScoreBoard.tsx` | Remove Focus Areas (tipsBlock) from expanded gauge views |
| `src/App.tsx` | Remove OnboardingModal (replaced by DailyWizard) |
| `src/pages/Home.tsx` | Render DailyWizard before dashboard |
| `src/pages/Run.tsx` | Handle wizard return flow via location.state |
| `src/pages/ScreenTimeForm.tsx` | Handle wizard return flow via location.state |
| `src/components/SleepSlider.tsx` | Handle wizard return flow via location.state (submit handler lives here) |
| `src/pages/Profile.tsx` | Add consent revocation UI |

---

## Chunk 1: Database Reset & New Migration

### Task 1: Create migration to wipe old questionnaire data and add consent + wellbeing tables

**Files:**
- Create: `backend/migrations/1650000000022_questionnaire-wellbeing-consent.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- =============================================================================
-- Migration 022: Questionnaire restructure + wellbeing + consent
-- =============================================================================

-- 1. Wipe old questionnaire/SRL data (pre-production, no migration needed)
DELETE FROM public.srl_annotations;
DELETE FROM public.srl_responses;
DELETE FROM public.questionnaire_results;

-- Also wipe concept scores and cluster assignments that depend on SRL data
DELETE FROM public.concept_scores WHERE concept_id = 'srl';
DELETE FROM public.concept_score_history WHERE concept_id = 'srl';
DELETE FROM public.user_cluster_assignments WHERE concept_id = 'srl';
DELETE FROM public.peer_clusters WHERE concept_id = 'srl';

-- 2. User consent tracking
CREATE TABLE IF NOT EXISTS public.user_consents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    consent_given boolean NOT NULL DEFAULT false,
    consent_version varchar(20) NOT NULL DEFAULT '1.0',
    consent_given_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_user_consent UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_consents_user ON public.user_consents(user_id);

-- 3. Wellbeing responses (WHO-5 style, separate from SRL)
CREATE TABLE IF NOT EXISTS public.wellbeing_responses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    questionnaire_id uuid NOT NULL REFERENCES public.questionnaire_results(id) ON DELETE CASCADE,
    cheerfulness smallint CHECK (cheerfulness BETWEEN 1 AND 5),
    calmness smallint CHECK (calmness BETWEEN 1 AND 5),
    vitality smallint CHECK (vitality BETWEEN 1 AND 5),
    restedness smallint CHECK (restedness BETWEEN 1 AND 5),
    interest smallint CHECK (interest BETWEEN 1 AND 5),
    submitted_at timestamptz NOT NULL DEFAULT NOW(),
    is_simulated boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_wellbeing_user_time ON public.wellbeing_responses(user_id, submitted_at);
```

- [ ] **Step 2: Run the migration**

Run: `cd backend && npm run migrate`
Expected: Migration applies successfully.

- [ ] **Step 3: Commit**

```bash
git add backend/migrations/1650000000022_questionnaire-wellbeing-consent.sql
git commit -m "feat: add wellbeing_responses and user_consents tables, wipe old SRL data"
```

---

## Chunk 2: Backend — Questionnaire Definition & SRL Annotation Service

### Task 2: Update survey question definitions + force-update stored JSON

**Files:**
- Modify: `backend/routes/surveys.js:17-37` (template) and `backend/routes/surveys.js:57-71` (seed logic)

The survey template must now have two pages: wellbeing (5 items) and learning (10 items).

Concept key merges:
- tracking + clarity → `tracking`
- effort + focus → `effort`
- motivation + enjoyment → `motivation`
- learning_from_feedback + self_assessment → `reflection`

- [ ] **Step 1: Replace getDefaultSurveyTemplate() (lines 17-37)**

```javascript
const getDefaultSurveyTemplate = () => ({
    title: FIXED_SURVEY_NAME,
    pages: [
        {
            name: 'wellbeing',
            title: 'How are you feeling today?',
            description: 'Rate how you have felt over the past day.',
            elements: [
                { type: 'rating', name: 'cheerfulness', title: 'I have felt cheerful and in good spirits.', mininumRateDescription: 'Not at all', maximumRateDescription: 'All the time' },
                { type: 'rating', name: 'calmness', title: 'I have felt calm and relaxed.', mininumRateDescription: 'Not at all', maximumRateDescription: 'All the time' },
                { type: 'rating', name: 'vitality', title: 'I have felt active and vigorous.', mininumRateDescription: 'Not at all', maximumRateDescription: 'All the time' },
                { type: 'rating', name: 'restedness', title: 'I woke up feeling fresh and rested.', mininumRateDescription: 'Not at all', maximumRateDescription: 'All the time' },
                { type: 'rating', name: 'interest', title: 'My daily life has been filled with things that interest me.', mininumRateDescription: 'Not at all', maximumRateDescription: 'All the time' }
            ]
        },
        {
            name: 'learning',
            title: 'Your Learning Today',
            description: 'Reflect on your learning strategies and experience.',
            elements: [
                { type: 'rating', name: 'efficiency', title: 'I believe I can accomplish my learning duties and learning tasks efficiently.', mininumRateDescription: 'Strongly disagree', maximumRateDescription: 'Strongly agree' },
                { type: 'rating', name: 'importance', title: 'I believe that my learning tasks are very important to me.', mininumRateDescription: 'Not important', maximumRateDescription: 'Very important' },
                { type: 'rating', name: 'tracking', title: 'I keep track of what I need to do and understand what I must do to accomplish my learning tasks.', mininumRateDescription: 'Never', maximumRateDescription: 'Always' },
                { type: 'rating', name: 'effort', title: 'I put enough effort into my learning tasks and stay focused while working on them.', mininumRateDescription: 'Not enough effort', maximumRateDescription: 'A lot of effort' },
                { type: 'rating', name: 'help_seeking', title: 'I seek help from teachers, friends, or the internet when I need explanation or help with difficult tasks.', mininumRateDescription: 'Never seek help', maximumRateDescription: 'Always seek help' },
                { type: 'rating', name: 'community', title: 'I am having nice interactions and feeling at home within the college community.', mininumRateDescription: 'Not at all', maximumRateDescription: 'Very much' },
                { type: 'rating', name: 'timeliness', title: 'I am doing my studies on time and keeping up with tasks/deadlines.', mininumRateDescription: 'Always late', maximumRateDescription: 'Always on time' },
                { type: 'rating', name: 'motivation', title: 'I feel motivated to learn and enjoy working on my learning tasks.', mininumRateDescription: 'Not motivated', maximumRateDescription: 'Highly motivated' },
                { type: 'rating', name: 'anxiety', title: 'I feel anxious or stressed working on learning tasks, assignments, or in class.', mininumRateDescription: 'Never anxious', maximumRateDescription: 'Very anxious' },
                { type: 'rating', name: 'reflection', title: 'I reflect on my performance and learn from feedback or mistakes to improve my learning.', mininumRateDescription: 'Never reflect', maximumRateDescription: 'Always reflect' }
            ]
        }
    ]
})
```

- [ ] **Step 2: Update ensureFixedSurvey() seed logic to always overwrite JSON (lines 57-71)**

Replace the `else` branch (lines 57-71) so that when a survey already exists, we always update its full JSON (not just the title):

```javascript
} else {
    // Always overwrite survey JSON with current template
    const existingSurvey = await pool.query('SELECT id FROM public.surveys LIMIT 1')
    if (existingSurvey.rows[0]) {
        const newJson = getDefaultSurveyTemplate()
        await pool.query(
            'UPDATE public.surveys SET name = $2, json = $3::jsonb WHERE id = $1',
            [existingSurvey.rows[0].id, FIXED_SURVEY_NAME, JSON.stringify(newJson)]
        )
        logger.info(`Updated survey JSON to latest template`)
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add backend/routes/surveys.js
git commit -m "feat: restructure survey into wellbeing (5) + learning (10) sections"
```

### Task 3: Update SRL annotation service concept list

**Files:**
- Modify: `backend/services/annotators/srlAnnotationService.js:12-27`

Remove old concept keys (clarity, focus, enjoyment, self_assessment, learning_from_feedback) and add `reflection`.

- [ ] **Step 1: Replace CONCEPT_SHORT_NAMES (lines 12-27)**

```javascript
const CONCEPT_SHORT_NAMES = {
    efficiency: 'Efficiency',
    importance: 'Perceived Importance',
    tracking: 'Progress Tracking',
    effort: 'Effort & Focus',
    help_seeking: 'Help Seeking',
    community: 'Peer Learning',
    timeliness: 'Timeliness',
    motivation: 'Motivation & Enjoyment',
    anxiety: 'Anxiety',
    reflection: 'Reflection'
};
```

The rest of the annotation pipeline (saveResponses, computeAnnotations, getAnnotationsForChatbot) iterates over `Object.keys(CONCEPT_SHORT_NAMES)`, so they auto-adapt to 10 keys.

- [ ] **Step 2: Verify no other hardcoded references to removed keys**

Run: `cd backend && grep -rn "clarity\|self_assessment\|learning_from_feedback\|enjoyment\|\"focus\"" services/annotators/srlAnnotationService.js`
Expected: No matches outside the now-replaced CONCEPT_SHORT_NAMES block.

- [ ] **Step 3: Commit**

```bash
git add backend/services/annotators/srlAnnotationService.js
git commit -m "feat: update SRL concepts to 10 merged keys"
```

### Task 4: Add wellbeing data handling to results route & annotation service

**Files:**
- Modify: `backend/services/annotators/srlAnnotationService.js` (add saveWellbeingResponses + getWellbeingForChatbot)
- Modify: `backend/routes/results.js:25-56`

- [ ] **Step 1: Add wellbeing functions to srlAnnotationService.js**

Add after the existing `saveResponses` function (around line 432):

```javascript
// ============================================================================
// WELLBEING (WHO-5) — stored only, sent to chatbot, NOT displayed on dashboard
// ============================================================================

const WELLBEING_KEYS = ['cheerfulness', 'calmness', 'vitality', 'restedness', 'interest'];

async function saveWellbeingResponses(pool, questionnaireId, userId, answers, submittedAt) {
    const values = WELLBEING_KEYS.map(k => answers[k] || null);
    if (values.every(v => v === null)) return;

    await pool.query(
        `INSERT INTO public.wellbeing_responses
            (user_id, questionnaire_id, cheerfulness, calmness, vitality, restedness, interest, submitted_at, is_simulated)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)`,
        [userId, questionnaireId, ...values, submittedAt]
    );
}

async function getWellbeingForChatbot(pool, userId) {
    const { rows } = await pool.query(
        `SELECT cheerfulness, calmness, vitality, restedness, interest, submitted_at
         FROM public.wellbeing_responses
         WHERE user_id = $1
         ORDER BY submitted_at DESC
         LIMIT 7`,
        [userId]
    );

    if (rows.length === 0) return '';

    const latest = rows[0];
    const labels = {
        cheerfulness: 'Cheerful & in good spirits',
        calmness: 'Calm & relaxed',
        vitality: 'Active & vigorous',
        restedness: 'Woke up fresh & rested',
        interest: 'Daily life filled with interesting things'
    };

    let text = '## Student Wellbeing (WHO-5 Style)\n\n';
    text += '### Most Recent:\n';
    for (const [key, label] of Object.entries(labels)) {
        text += `- ${label}: ${latest[key]}/5\n`;
    }

    if (rows.length > 1) {
        const avgOf = (key) => {
            const vals = rows.map(r => r[key]).filter(v => v != null);
            return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : 'N/A';
        };
        text += `\n### Past ${rows.length} days averages:\n`;
        for (const [key, label] of Object.entries(labels)) {
            text += `- ${label}: avg ${avgOf(key)}/5\n`;
        }
    }

    text += '\nNote: This data reflects the student\'s subjective daily wellbeing. Use it to gauge emotional state and tailor your tone — e.g., be more supportive if wellbeing scores are low.';
    return text;
}
```

Add to the exports at the bottom of the file:
```javascript
export { ..., saveWellbeingResponses, getWellbeingForChatbot, WELLBEING_KEYS };
```

- [ ] **Step 2: Call saveWellbeingResponses from results.js POST handler**

In `backend/routes/results.js`, update import to include `saveWellbeingResponses`:
```javascript
import { saveResponses, computeAnnotations, saveWellbeingResponses } from '../services/annotators/srlAnnotationService.js';
```

After the `saveResponses()` call (around line 41), add:
```javascript
await saveWellbeingResponses(pool, id, userId, surveyResult, submittedAt);
```

- [ ] **Step 3: Commit**

```bash
git add backend/routes/results.js backend/services/annotators/srlAnnotationService.js
git commit -m "feat: store wellbeing responses on questionnaire submission"
```

### Task 5: Add wellbeing data to chatbot prompt

**Files:**
- Modify: `backend/services/promptAssemblerService.js`

Both `assemblePrompt()` (line 249) and `assembleInitialGreetingPrompt()` (line 395) must include wellbeing data.

- [ ] **Step 1: Add import**

Update the import from srlAnnotationService.js (line 13):
```javascript
import { getAnnotationsForChatbot, getWellbeingForChatbot } from './annotators/srlAnnotationService.js'
```

- [ ] **Step 2: Update assemblePrompt() (lines 253-265)**

Add `getWellbeingForChatbot(pool, userId)` to the Promise.all array and destructure:

```javascript
const [systemPrompt, userContext, conceptScores, summaries,
       srlAnnotations, sleepAnnotations, screenTimeAnnotations, lmsAnnotations,
       prefs, wellbeingAnnotations] = await Promise.all([
    getSystemPrompt(),
    getUserContext(userId),
    getScoresForChatbot(userId),
    getSummariesForChatbot(userId),
    getAnnotationsForChatbot(pool, userId),
    getSleepAnnotations(pool, userId),
    getScreenTimeAnnotations(pool, userId),
    getLMSAnnotations(pool, userId),
    getPreferences(userId),
    getWellbeingForChatbot(pool, userId)
])
```

- [ ] **Step 3: Update formatDataAvailability() (line 221)**

Add a 5th parameter for wellbeing:

```javascript
function formatDataAvailability(srlAnnotations, sleepAnnotations, screenTimeAnnotations, lmsAnnotations, wellbeingAnnotations) {
    const isAvailable = (text) => text && text.trim().length > 0 &&
        !text.includes('No data') && !text.includes('no data') &&
        !text.includes('not yet') && !text.includes('not available')

    const srlStatus = isAvailable(srlAnnotations) ? 'Available' : 'Not yet submitted by student'
    const sleepStatus = isAvailable(sleepAnnotations) ? 'Available' : 'Not yet logged by student'
    const screenStatus = isAvailable(screenTimeAnnotations) ? 'Available' : 'Not yet logged by student'
    const lmsStatus = isAvailable(lmsAnnotations) ? 'Available' : 'Not yet synced from LMS'
    const wellbeingStatus = isAvailable(wellbeingAnnotations) ? 'Available' : 'Not yet submitted by student'

    return [
        `- SRL (Self-Regulated Learning): ${srlStatus}`,
        `- Wellbeing: ${wellbeingStatus}`,
        `- Sleep: ${sleepStatus}`,
        `- Screen Time: ${screenStatus}`,
        `- LMS Activity: ${lmsStatus}`,
        'If a dimension shows "Not yet", do NOT fabricate values for it. Acknowledge the gap and invite the student to provide data.'
    ].join('\n')
}
```

- [ ] **Step 4: Update both call sites of formatDataAvailability**

In `assemblePrompt()` (line 295):
```javascript
const dataAvailSection = formatDataAvailability(srlAnnotations, sleepAnnotations, screenTimeAnnotations, lmsAnnotations, wellbeingAnnotations)
```

Add wellbeing to the context sections array (after ANNOTATED QUESTIONNAIRE INSIGHTS, around line 303):
```javascript
{ name: 'STUDENT WELLBEING STATUS', content: wellbeingAnnotations, priority: 2 },
```

- [ ] **Step 5: Update assembleInitialGreetingPrompt() (line 395)**

Same pattern — add `getWellbeingForChatbot(pool, userId)` to the Promise.all (line 398-410), destructure as `wellbeingAnnotations`, and pass to `formatDataAvailability`.

Add wellbeing section to the greeting prompt string (around line 440):
```javascript
${wellbeingAnnotations ? `\nSTUDENT WELLBEING STATUS:\n${wellbeingAnnotations}\n` : ''}
```

- [ ] **Step 6: Commit**

```bash
git add backend/services/promptAssemblerService.js
git commit -m "feat: send wellbeing data to chatbot prompt (both main + greeting)"
```

### Task 6: Update SRL data simulator

**Files:**
- Modify: `backend/services/simulators/srlDataSimulator.js:64-70`

- [ ] **Step 1: Update CONCEPT_GROUPS (lines 64-70)**

```javascript
const CONCEPT_GROUPS = {
    planning: ['efficiency', 'tracking', 'timeliness'],
    motivation: ['motivation', 'effort', 'importance'],
    social: ['help_seeking', 'community', 'reflection'],
    affect: ['anxiety']
};
```

- [ ] **Step 2: Verify CONCEPT_SHORT_NAMES import**

Run: `cd backend && grep -n "CONCEPT_SHORT_NAMES" services/simulators/srlDataSimulator.js`

If `CONCEPT_SHORT_NAMES` is imported from srlAnnotationService.js, it auto-adapts. If duplicated locally, update it to match the new 10 keys.

- [ ] **Step 3: Add wellbeing simulation to generateSRLData**

In the `generateSRLData` function, after the questionnaire_results + srl_responses inserts for each day, add wellbeing simulation. **Note:** The function parameter is `profile` (not `profilePattern`):

```javascript
// Simulate wellbeing responses (WHO-5 style)
const wellbeingScores = {
    cheerfulness: clampScore(3 + (profile === 'high_achiever' ? 1 : profile === 'low_achiever' ? -1 : 0) + (Math.random() - 0.5) * 2),
    calmness: clampScore(3 + (profile === 'high_achiever' ? 0.5 : profile === 'low_achiever' ? -0.5 : 0) + (Math.random() - 0.5) * 2),
    vitality: clampScore(3 + (profile === 'high_achiever' ? 1 : profile === 'low_achiever' ? -1 : 0) + (Math.random() - 0.5) * 2),
    restedness: clampScore(3 + (profile === 'high_achiever' ? 0.5 : profile === 'low_achiever' ? -1 : 0) + (Math.random() - 0.5) * 2),
    interest: clampScore(3 + (profile === 'high_achiever' ? 1 : profile === 'low_achiever' ? -0.5 : 0) + (Math.random() - 0.5) * 2)
};

await pool.query(
    `INSERT INTO public.wellbeing_responses
        (user_id, questionnaire_id, cheerfulness, calmness, vitality, restedness, interest, submitted_at, is_simulated)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
    [userId, questionnaireId, wellbeingScores.cheerfulness, wellbeingScores.calmness,
     wellbeingScores.vitality, wellbeingScores.restedness, wellbeingScores.interest, submittedAt]
);
```

Where `questionnaireId` is the UUID of the questionnaire_results row just inserted (the `id` variable from the INSERT above it), and `submittedAt` is the backdated timestamp already available in scope.

- [ ] **Step 4: Commit**

```bash
git add backend/services/simulators/srlDataSimulator.js
git commit -m "feat: update simulator for 10 SRL concepts + wellbeing simulation"
```

### Task 7: Update backend config/concepts.js

**Files:**
- Modify: `backend/config/concepts.js:13-17`

- [ ] **Step 1: Update SRL dimensions**

```javascript
srl: {
    id: 'srl',
    displayName: 'Self-Regulated Learning',
    table: 'srl_annotations',
    dimensions: ['efficiency', 'importance', 'tracking', 'effort', 'help_seeking', 'community', 'timeliness', 'motivation', 'anxiety', 'reflection']
},
```

Note: `clusterPeerService.js` does NOT hardcode SRL dimensions — it calls `getSRLMetrics()` which reads dynamically from `srl_annotations` table. No change needed there.

- [ ] **Step 2: Commit**

```bash
git add backend/config/concepts.js
git commit -m "feat: update SRL dimensions in backend config to match new 10 keys"
```

---

## Chunk 3: Frontend — Concepts, Dashboard & Survey

### Task 8: Update frontend concepts.ts

**Files:**
- Modify: `src/constants/concepts.ts`

Remove references to old concept keys and add `reflection`. Also remove stale `action_mix` entry. Do NOT add wellbeing keys — they must not appear on the dashboard.

- [ ] **Step 1: Update DOMAIN_TIPS (lines 14-42)**

Remove entries for: `clarity`, `focus`, `enjoyment`, `self_assessment`, `learning_from_feedback`, `action_mix` (stale).

New SRL section:
```typescript
// SRL (survey-based concept keys — 10 items)
effort:               'Even 20 focused minutes beats an hour of passive note-scrolling. Minimise distractions and use a dedicated study space.',
tracking:             'Keep a short log of what you studied and what still needs covering. Re-read task briefs to confirm expectations.',
community:            'Peer discussion often reveals gaps in understanding that solo study misses. Try explaining a concept to someone else.',
efficiency:           'Identify the one highest-value task before each session and complete it first before moving to lower-priority work.',
importance:           'Remind yourself how this subject connects to your broader goals or career path to reinvigorate motivation.',
motivation:           'Break large goals into small wins — completing a section, a problem set, or a chapter gives a real sense of progress and enjoyment.',
timeliness:           'Work backwards from deadlines: set personal mini-deadlines a few days ahead to reduce last-minute pressure.',
help_seeking:         'Ask questions early — difficulties raised sooner are easier to address and prevent compounding confusion.',
anxiety:              'Try slow breathing before tests. Break revision into small steps and focus on progress, not perfection.',
reflection:           'After each topic, recall key points without looking and review feedback to find one actionable improvement.',
```

- [ ] **Step 2: Update DOMAIN_DESCRIPTIONS (lines 49-90)**

Remove stale entries: `goal_setting`, `planning`, `task_strategies`, `self_observation`, `self_judgement`, `self_reaction`, `self_efficacy`, `intrinsic_motivation`, `extrinsic_motivation`, `elaboration`, `critical_thinking`, `metacognitive_regulation`, `action_mix`, `clarity`, `focus`, `enjoyment`, `self_assessment`, `learning_from_feedback`.

New SRL section:
```typescript
// SRL (survey-based — 10 items)
efficiency:           'How effectively you use your study time to achieve your learning goals. Higher is better.',
importance:           'How important and relevant you perceive your studies to be to your goals. Higher is better.',
tracking:             'How well you monitor progress and understand what tasks you need to accomplish. Higher is better.',
effort:               'The effort you invest and your ability to stay focused during learning. Higher is better.',
help_seeking:         'Your willingness to seek help when you face challenges or confusion. Higher is better.',
community:            'How much you engage with peers for collaborative learning and discussion. Higher is better.',
timeliness:           'How promptly you complete tasks and assignments relative to deadlines. Higher is better.',
motivation:           'Your overall drive, enthusiasm, and enjoyment when engaging with your studies. Higher is better.',
anxiety:              'Your level of test and study anxiety. Lower anxiety is better.',
reflection:           'How effectively you evaluate your performance and use feedback to improve. Higher is better.',
```

- [ ] **Step 3: Commit**

```bash
git add src/constants/concepts.ts
git commit -m "feat: update frontend concept definitions to match new 10 SRL keys"
```

### Task 9: Remove Focus Areas from dashboard

**Files:**
- Modify: `src/components/ScoreBoard.tsx:236-282`

- [ ] **Step 1: Remove tipsBlock and simplify renderBreakdownContent**

In `ScoreBoard.tsx`, in the `renderBreakdownContent` function:

1. **Delete the entire tipsBlock** (lines 237-258 — the `<ul className='gauge-expanded-breakdown-list'>` with dimension names, info icons, and tips)

2. **Replace the two-column layout** (lines 260-273) with just the summary:
```typescript
if (twoColumns) {
    return (
        <div className='breakdown-two-col'>
            <div className='breakdown-col-left' style={{ flex: 1 }}>
                <div className='score-details-title' style={{ marginBottom: '12px' }}>Your Status</div>
                {summaryBlock}
            </div>
        </div>
    )
}
```

3. **Replace the mobile/single-column layout** (lines 276-282) with:
```typescript
return (
    <>
        <div className='score-details-title' style={{ marginBottom: '12px' }}>Your Status</div>
        {summaryBlock}
    </>
)
```

- [ ] **Step 2: Remove unused imports**

Remove `DOMAIN_TIPS` and `DOMAIN_DESCRIPTIONS` from the import at the top if no longer used.

- [ ] **Step 3: Commit**

```bash
git add src/components/ScoreBoard.tsx
git commit -m "feat: remove Focus Areas from expanded gauge views"
```

---

## Chunk 4: Consent System (Backend + Frontend)

### Task 10: Add consent backend routes

**Files:**
- Create: `backend/routes/consent.js`
- Modify: `backend/routes/index.js`

**IMPORTANT:** Session pattern is `req.session.user.id` (NOT `req.session.userId`). All other routes use this pattern.

- [ ] **Step 1: Create consent route file**

Create `backend/routes/consent.js`:

```javascript
import { Router } from 'express';
import pool from '../config/database.js';
import { requireAuth } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = Router();

// GET /consent — check if user has given consent
router.get('/', requireAuth, async (req, res, next) => {
    try {
        const userId = req.session.user.id;
        const { rows } = await pool.query(
            'SELECT consent_given, consent_version, consent_given_at FROM public.user_consents WHERE user_id = $1',
            [userId]
        );
        if (rows.length === 0) {
            return res.json({ consentGiven: false });
        }
        return res.json({
            consentGiven: rows[0].consent_given,
            consentVersion: rows[0].consent_version,
            consentGivenAt: rows[0].consent_given_at
        });
    } catch (err) {
        next(err);
    }
});

// POST /consent — record consent
router.post('/', requireAuth, async (req, res, next) => {
    try {
        const userId = req.session.user.id;
        const { consentGiven } = req.body;
        if (consentGiven !== true) {
            return res.status(400).json({ error: 'Consent must be explicitly given' });
        }
        await pool.query(
            `INSERT INTO public.user_consents (user_id, consent_given, consent_given_at)
             VALUES ($1, true, NOW())
             ON CONFLICT (user_id)
             DO UPDATE SET consent_given = true, consent_given_at = NOW(), revoked_at = NULL`,
            [userId]
        );
        logger.info(`User ${userId} gave consent`);
        return res.json({ success: true });
    } catch (err) {
        next(err);
    }
});

// POST /consent/revoke — revoke consent and delete all user data
router.post('/revoke', requireAuth, async (req, res, next) => {
    const client = await pool.connect();
    try {
        const userId = req.session.user.id;
        await client.query('BEGIN');

        // Delete all user data (order matters for FK constraints)
        await client.query('DELETE FROM public.chat_messages WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM public.chat_summaries WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM public.chat_sessions WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM public.chatbot_preferences WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM public.wellbeing_responses WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM public.srl_annotations WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM public.srl_responses WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM public.questionnaire_results WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM public.sleep_judgments WHERE user_id IN (SELECT id FROM public.sleep_sessions WHERE user_id = $1)', [userId]);
        await client.query('DELETE FROM public.sleep_sessions WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM public.sleep_baselines WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM public.screen_time_judgments WHERE user_id IN (SELECT id FROM public.screen_time_sessions WHERE user_id = $1)', [userId]);
        await client.query('DELETE FROM public.screen_time_sessions WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM public.screen_time_baselines WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM public.lms_judgments WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM public.lms_sessions WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM public.lms_baselines WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM public.concept_scores WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM public.concept_score_history WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM public.user_cluster_assignments WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM public.student_profiles WHERE user_id = $1', [userId]);

        // Mark consent as revoked (keep record for audit)
        await client.query(
            'UPDATE public.user_consents SET consent_given = false, revoked_at = NOW() WHERE user_id = $1',
            [userId]
        );

        await client.query('COMMIT');

        // Destroy session
        req.session.destroy(() => {
            res.clearCookie('connect.sid');
            logger.info(`User ${userId} revoked consent — all data deleted`);
            return res.json({ success: true, message: 'All data deleted and consent revoked' });
        });
    } catch (err) {
        await client.query('ROLLBACK');
        next(err);
    } finally {
        client.release();
    }
});

export default router;
```

- [ ] **Step 2: Register route in backend/routes/index.js**

```javascript
import consentRoutes from './consent.js';
// ... in the router setup:
router.use('/consent', consentRoutes);
```

- [ ] **Step 3: Commit**

```bash
git add backend/routes/consent.js backend/routes/index.js
git commit -m "feat: add consent API routes (give, check, revoke with data deletion)"
```

### Task 11: Add consent revocation to Profile page

**Files:**
- Modify: `src/pages/Profile.tsx`

**IMPORTANT:** `api` is a named export: `import { api } from '../api/client'`

- [ ] **Step 1: Add revocation UI to Profile.tsx**

At the bottom of the profile form, add:

```tsx
{/* Consent & Data Management */}
<div style={{ marginTop: '32px', padding: '16px', border: '1px solid #ef4444', borderRadius: '8px', backgroundColor: '#fef2f2' }}>
    <h3 style={{ margin: '0 0 8px', color: '#dc2626', fontSize: '14px' }}>Data & Consent</h3>
    <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 12px' }}>
        Revoking consent will permanently delete all your data including questionnaire responses,
        sleep logs, screen time logs, chat history, and scores. This cannot be undone.
    </p>
    <button
        onClick={async () => {
            if (window.confirm('Are you sure? This will permanently delete ALL your data and log you out. This cannot be undone.')) {
                try {
                    await api.post('/consent/revoke');
                    window.location.href = '/login';
                } catch (err) {
                    alert('Failed to revoke consent. Please try again.');
                }
            }
        }}
        style={{
            padding: '8px 16px', backgroundColor: '#dc2626', color: 'white',
            border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px'
        }}
    >
        Revoke Consent & Delete My Data
    </button>
</div>
```

Verify `api` is already imported. If not, add `import { api } from '../api/client'`.

- [ ] **Step 2: Commit**

```bash
git add src/pages/Profile.tsx
git commit -m "feat: add consent revocation with data deletion to profile page"
```

---

## Chunk 5: Daily Wizard Stepper

### Task 12: Create the DailyWizard component

**Files:**
- Create: `src/components/DailyWizard.tsx`
- Create: `src/components/DailyWizard.css`

**CRITICAL DESIGN NOTES:**
- Uses `import { api } from '../api/client'` (named export)
- Uses `useReduxDispatch` and `useReduxSelector` from `'../redux'` (NOT useAppDispatch/useAppSelector — those don't exist)
- Redux surveys state path is `state.surveys.surveys` (NOT state.surveys.list)
- Navigation approach: wizard navigates to `/run/:id`, `/screen-time`, `/sleep` with `state: { fromWizard: true }`. Those pages navigate back to `/` with `state: { wizardReturning: true }` on completion. Home re-renders wizard, which re-checks API status and auto-skips completed steps.
- No `wizard:stepComplete` custom event — the navigate-back pattern is the only flow.

- [ ] **Step 1: Create DailyWizard.tsx**

```tsx
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useReduxDispatch, useReduxSelector } from '../redux'
import { load as loadSurveys } from '../redux/surveys'
import { api } from '../api/client'
import './DailyWizard.css'

// API helpers
const getConsentStatus = async () => {
    const res = await api.get('/consent')
    return res.consentGiven === true
}
const giveConsent = async () => {
    await api.post('/consent', { consentGiven: true })
}
const getTodaySRL = async () => {
    const res = await api.get('/results/today')
    return res.submitted === true
}
const getTodayScreenTime = async () => {
    const res = await api.get('/screen-time/today')
    return !!res.logged
}
const getTodaySleep = async () => {
    const res = await api.get('/sleep/today')
    return !!res.logged
}
const getProfile = async () => {
    try {
        return await api.get('/profile')
    } catch {
        return null
    }
}
const completeOnboarding = async () => {
    try { await api.post('/profile/onboarding-complete') } catch { /* silent */ }
}

type WizardStep = 'consent' | 'intro' | 'questionnaire' | 'screen_time' | 'sleep' | 'profile' | 'done'

interface StepConfig {
    key: WizardStep
    label: string
}

export default function DailyWizard({ onComplete }: { onComplete: () => void }) {
    const navigate = useNavigate()
    const dispatch = useReduxDispatch()
    const surveys = useReduxSelector(s => s.surveys.surveys)

    const [loading, setLoading] = useState(true)
    const [steps, setSteps] = useState<StepConfig[]>([])
    const [currentStepIdx, setCurrentStepIdx] = useState(0)
    const [consentAgreed, setConsentAgreed] = useState(false)
    const [isFirstTime, setIsFirstTime] = useState(false)

    // Determine which steps are needed
    useEffect(() => {
        let cancelled = false
        async function init() {
            try {
                const [hasConsent, hasSRL, hasScreenTime, hasSleep, profile] = await Promise.all([
                    getConsentStatus(),
                    getTodaySRL(),
                    getTodayScreenTime(),
                    getTodaySleep(),
                    getProfile()
                ])

                if (cancelled) return

                const firstTime = !hasConsent
                setIsFirstTime(firstTime)

                const neededSteps: StepConfig[] = []

                if (!hasConsent) {
                    neededSteps.push({ key: 'consent', label: 'Consent' })
                    neededSteps.push({ key: 'intro', label: 'Introduction' })
                }

                if (!hasSRL) neededSteps.push({ key: 'questionnaire', label: 'Questionnaire' })
                if (!hasScreenTime) neededSteps.push({ key: 'screen_time', label: 'Screen Time' })
                if (!hasSleep) neededSteps.push({ key: 'sleep', label: 'Sleep Log' })

                if (firstTime && (!profile || !profile.onboarding_completed)) {
                    neededSteps.push({ key: 'profile', label: 'Profile (Optional)' })
                }

                if (neededSteps.length === 0) {
                    onComplete()
                    return
                }

                setSteps(neededSteps)
                setLoading(false)

                if (!surveys || surveys.length === 0) {
                    dispatch(loadSurveys())
                }
            } catch {
                onComplete()
            }
        }
        init()
        return () => { cancelled = true }
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    const currentStep = steps[currentStepIdx]

    const goNext = useCallback(async () => {
        if (currentStepIdx < steps.length - 1) {
            setCurrentStepIdx(prev => prev + 1)
        } else {
            if (isFirstTime) await completeOnboarding()
            onComplete()
        }
    }, [currentStepIdx, steps.length, isFirstTime, onComplete])

    if (loading) {
        return <div className='wizard-loading'>Loading...</div>
    }

    if (!currentStep) {
        onComplete()
        return null
    }

    const progress = `${currentStepIdx + 1} of ${steps.length}`

    return (
        <div className='wizard-overlay'>
            <div className='wizard-container'>
                <div className='wizard-progress-bar'>
                    <div className='wizard-progress-fill' style={{ width: `${((currentStepIdx + 1) / steps.length) * 100}%` }} />
                </div>
                <div className='wizard-progress-text'>Step {progress}</div>

                <div className='wizard-content'>
                    {currentStep.key === 'consent' && (
                        <ConsentStep
                            agreed={consentAgreed}
                            onToggle={() => setConsentAgreed(prev => !prev)}
                            onAccept={async () => {
                                await giveConsent()
                                goNext()
                            }}
                        />
                    )}
                    {currentStep.key === 'intro' && (
                        <IntroStep onContinue={goNext} />
                    )}
                    {currentStep.key === 'questionnaire' && (
                        <NavigateStep route={`/run/${surveys?.[0]?.id}`} navigate={navigate} />
                    )}
                    {currentStep.key === 'screen_time' && (
                        <NavigateStep route="/screen-time" navigate={navigate} />
                    )}
                    {currentStep.key === 'sleep' && (
                        <NavigateStep route="/sleep" navigate={navigate} />
                    )}
                    {currentStep.key === 'profile' && (
                        <ProfileStep
                            onNavigate={() => navigate('/profile', { state: { fromWizard: true } })}
                            onSkip={goNext}
                        />
                    )}
                </div>

                {currentStep.key !== 'consent' && (
                    <button className='wizard-skip-btn' onClick={async () => {
                        if (isFirstTime) await completeOnboarding()
                        onComplete()
                    }}>
                        Skip to Dashboard
                    </button>
                )}
            </div>
        </div>
    )
}

// --- Sub-components ---

function NavigateStep({ route, navigate }: { route: string; navigate: (to: string, opts?: any) => void }) {
    useEffect(() => {
        navigate(route, { state: { fromWizard: true } })
    }, [route, navigate])

    return <div className='wizard-step-loading'><p>Loading...</p></div>
}

function ConsentStep({ agreed, onToggle, onAccept }: {
    agreed: boolean; onToggle: () => void; onAccept: () => void
}) {
    return (
        <div className='wizard-step-consent'>
            <h2>Before We Begin</h2>
            <div className='consent-text'>
                <h3>What data is collected</h3>
                <ul>
                    <li>Daily questionnaire responses about your learning strategies and wellbeing</li>
                    <li>Sleep log entries (bedtime, wake time, awakenings)</li>
                    <li>Screen time usage (total, longest session, pre-sleep)</li>
                    <li>LMS activity data (quiz attempts, assignment submissions, forum posts)</li>
                </ul>
                <h3>How your data is used</h3>
                <ul>
                    <li>To provide you with AI-powered personalised learning insights</li>
                    <li>To compare your patterns with anonymised peer groups</li>
                    <li>To help you reflect on and improve your study habits</li>
                </ul>
                <h3>Who can see your data</h3>
                <ul>
                    <li>Only you and your assigned facilitator can view your individual data</li>
                    <li>Peer comparisons use anonymised, aggregated data only</li>
                </ul>
                <h3>Your rights</h3>
                <ul>
                    <li>Participation is voluntary — you can use the system without logging data</li>
                    <li>You can revoke consent at any time from your Profile page</li>
                    <li>Revoking consent permanently deletes all your collected data</li>
                </ul>
            </div>
            <label className='consent-checkbox'>
                <input type='checkbox' checked={agreed} onChange={onToggle} />
                <span>I understand and agree to the data collection described above</span>
            </label>
            <button className='wizard-primary-btn' disabled={!agreed} onClick={onAccept}>
                Continue
            </button>
        </div>
    )
}

function IntroStep({ onContinue }: { onContinue: () => void }) {
    return (
        <div className='wizard-step-intro'>
            <h2>Welcome to Your Learning Dashboard</h2>
            <p>This system helps you understand and improve your learning habits by tracking three key areas:</p>
            <div className='intro-areas'>
                <div className='intro-area'>
                    <span className='intro-area-icon'>📝</span>
                    <div>
                        <strong>Learning Strategies & Wellbeing</strong>
                        <p>Daily reflections on how you study and how you feel</p>
                    </div>
                </div>
                <div className='intro-area'>
                    <span className='intro-area-icon'>📱</span>
                    <div>
                        <strong>Screen Time</strong>
                        <p>Track your daily screen usage patterns</p>
                    </div>
                </div>
                <div className='intro-area'>
                    <span className='intro-area-icon'>🌙</span>
                    <div>
                        <strong>Sleep</strong>
                        <p>Log your sleep to understand its impact on learning</p>
                    </div>
                </div>
            </div>
            <p className='intro-note'>Your AI assistant uses this data to give you personalised insights. Everything is private — only you and your facilitator can see your data.</p>
            <button className='wizard-primary-btn' onClick={onContinue}>Let's Get Started</button>
        </div>
    )
}

function ProfileStep({ onNavigate, onSkip }: { onNavigate: () => void; onSkip: () => void }) {
    return (
        <div className='wizard-step-profile'>
            <h2>Set Up Your Profile (Optional)</h2>
            <p>Personalise your experience by telling us about your field of study and learning preferences.</p>
            <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
                <button className='wizard-primary-btn' onClick={onNavigate}>Set Up Profile</button>
                <button className='wizard-secondary-btn' onClick={onSkip}>Skip for Now</button>
            </div>
        </div>
    )
}
```

- [ ] **Step 2: Create DailyWizard.css**

```css
.wizard-overlay {
    position: fixed;
    inset: 0;
    background: #f8fafc;
    z-index: 1000;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 60px;
    overflow-y: auto;
}

.wizard-container {
    width: 100%;
    max-width: 640px;
    padding: 24px;
}

.wizard-progress-bar {
    height: 6px;
    background: #e2e8f0;
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 8px;
}

.wizard-progress-fill {
    height: 100%;
    background: #3b82f6;
    border-radius: 3px;
    transition: width 0.3s ease;
}

.wizard-progress-text {
    font-size: 13px;
    color: #94a3b8;
    margin-bottom: 24px;
    text-align: right;
}

.wizard-content {
    background: white;
    border-radius: 12px;
    padding: 32px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.wizard-primary-btn {
    display: inline-block;
    padding: 10px 24px;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    margin-top: 16px;
}

.wizard-primary-btn:disabled {
    background: #94a3b8;
    cursor: not-allowed;
}

.wizard-secondary-btn {
    display: inline-block;
    padding: 10px 24px;
    background: transparent;
    color: #64748b;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    font-size: 14px;
    cursor: pointer;
    margin-top: 16px;
}

.wizard-skip-btn {
    display: block;
    margin: 16px auto 0;
    background: none;
    border: none;
    color: #94a3b8;
    font-size: 13px;
    cursor: pointer;
    text-decoration: underline;
}

.wizard-loading {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 200px;
    color: #94a3b8;
}

/* Consent step */
.wizard-step-consent h2 { margin: 0 0 16px; font-size: 20px; color: #1e293b; }

.consent-text {
    max-height: 360px;
    overflow-y: auto;
    padding: 16px;
    background: #f8fafc;
    border-radius: 8px;
    margin-bottom: 16px;
    font-size: 13px;
    line-height: 1.6;
    color: #475569;
}

.consent-text h3 { margin: 16px 0 8px; font-size: 14px; color: #1e293b; }
.consent-text h3:first-child { margin-top: 0; }
.consent-text ul { margin: 0; padding-left: 20px; }
.consent-text li { margin-bottom: 4px; }

.consent-checkbox {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 16px 0;
    font-size: 14px;
    color: #334155;
    cursor: pointer;
}

.consent-checkbox input[type='checkbox'] { margin-top: 3px; width: 16px; height: 16px; }

/* Intro step */
.wizard-step-intro h2 { margin: 0 0 12px; font-size: 20px; color: #1e293b; }
.wizard-step-intro > p { color: #64748b; font-size: 14px; margin-bottom: 20px; }

.intro-areas {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 20px;
}

.intro-area {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 12px;
    background: #f8fafc;
    border-radius: 8px;
}

.intro-area-icon { font-size: 24px; }
.intro-area strong { display: block; font-size: 14px; color: #1e293b; margin-bottom: 2px; }
.intro-area p { margin: 0; font-size: 13px; color: #64748b; }

.intro-note { font-size: 12px; color: #94a3b8; font-style: italic; }

/* Profile step */
.wizard-step-profile h2 { margin: 0 0 8px; font-size: 20px; color: #1e293b; }
.wizard-step-profile p { color: #64748b; font-size: 14px; }

.wizard-step-loading { text-align: center; padding: 40px; color: #94a3b8; }
```

- [ ] **Step 3: Commit**

```bash
git add src/components/DailyWizard.tsx src/components/DailyWizard.css
git commit -m "feat: create DailyWizard stepper component with consent, intro, and daily steps"
```

### Task 13: Wire wizard into the app flow

**Files:**
- Modify: `src/App.tsx` (remove OnboardingModal)
- Modify: `src/pages/Home.tsx` (add wizard)
- Modify: `src/pages/Run.tsx` (handle wizard return)
- Modify: `src/pages/ScreenTimeForm.tsx` (handle wizard return)
- Modify: `src/components/SleepSlider.tsx` (handle wizard return — submit handler is HERE, not SleepPage)

**Navigation flow:**
1. Home.tsx shows DailyWizard
2. Wizard navigates to data entry pages with `state: { fromWizard: true }`
3. Data entry pages, on submit, navigate back to `/` with `state: { wizardReturning: true }`
4. Home.tsx detects `wizardReturning` and re-shows wizard, which re-checks APIs and auto-skips completed steps

- [ ] **Step 1: Remove OnboardingModal from App.tsx (line 33)**

In `src/App.tsx`:
- Remove import: `import OnboardingModal from './components/OnboardingModal';` (line 7)
- Remove render: `{isStudent && <OnboardingModal />}` (line 33)

- [ ] **Step 2: Add wizard to Home.tsx**

```tsx
import { useLocation } from 'react-router-dom'
import DailyWizard from '../components/DailyWizard'

// Inside Home component:
const location = useLocation()
const navigate = useNavigate() // if not already imported
const [showWizard, setShowWizard] = useState(true) // start with wizard visible for students

// Handle wizard return from data entry pages
useEffect(() => {
    if (location.state?.wizardReturning && !isAdmin) {
        setShowWizard(true)
        // Clear the navigation state so refresh doesn't re-trigger
        navigate('/', { replace: true })
    }
}, [location.state]) // eslint-disable-line react-hooks/exhaustive-deps

// Admin users skip wizard entirely
useEffect(() => {
    if (isAdmin) setShowWizard(false)
}, [isAdmin])

// In render, before the existing dashboard:
if (showWizard && !isAdmin) {
    return <DailyWizard onComplete={() => setShowWizard(false)} />
}

// ... existing dashboard render below
```

Remove old OnboardingModal import if it was here (it wasn't — it's in App.tsx).

- [ ] **Step 3: Update Run.tsx to support wizard flow**

```tsx
import { useLocation } from 'react-router-dom'

// Inside component:
const location = useLocation()
const fromWizard = location.state?.fromWizard === true

// In the onComplete callback (around line 47-51), change navigation:
model.onComplete.add(async (sender) => {
    await dispatch(post({ postId: id!, surveyResult: sender.data }))
    window.dispatchEvent(new CustomEvent('chatbot:dataUpdated', { detail: { dataType: 'SRL questionnaire' } }))
    if (fromWizard) {
        navigate('/', { state: { wizardReturning: true } })
    } else {
        navigate('/')
    }
})
```

- [ ] **Step 4: Update ScreenTimeForm.tsx to support wizard flow**

```tsx
import { useLocation } from 'react-router-dom'

const location = useLocation()
const fromWizard = location.state?.fromWizard === true

// In the submit handler, after success toast:
if (fromWizard) {
    navigate('/', { state: { wizardReturning: true } })
} else {
    // existing behavior (stay on page or navigate)
}
```

- [ ] **Step 5: Update SleepSlider.tsx to support wizard flow**

The sleep submit handler lives in `SleepSlider.tsx` (NOT SleepPage.tsx). Same pattern:

```tsx
import { useLocation } from 'react-router-dom'

const location = useLocation()
const fromWizard = location.state?.fromWizard === true

// After successful save:
if (fromWizard) {
    navigate('/', { state: { wizardReturning: true } })
}
```

Note: SleepSlider may not have `navigate` — check if it uses `useNavigate` already or if the save callback is passed from SleepPage. Wire accordingly.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/pages/Home.tsx src/pages/Run.tsx src/pages/ScreenTimeForm.tsx src/components/SleepSlider.tsx
git commit -m "feat: wire DailyWizard into app flow, replacing OnboardingModal"
```

---

## Chunk 6: Testing & Smoke Test

### Task 14: Run backend tests and fix failures

- [ ] **Step 1: Run tests**

Run: `cd backend && NODE_OPTIONS='--experimental-vm-modules' npx jest --no-coverage`

- [ ] **Step 2: Fix test failures**

Common fixes needed:
- Tests referencing old concept keys (clarity, focus, enjoyment, self_assessment, learning_from_feedback) → update to new keys
- Tests expecting 14 concepts → update to expect 10
- Simulator tests with old CONCEPT_GROUPS → update
- srlAnnotationService tests with old CONCEPT_SHORT_NAMES → update

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "fix: update tests for new 10-concept questionnaire structure"
```

### Task 15: End-to-end smoke test

- [ ] **Step 1: Start the application**

Run: `cd backend && npm run dev` (backend)
Run: `npm run dev` (frontend, separate terminal)

- [ ] **Step 2: Test the full flow**

1. Register a new user → verify consent form appears first
2. Accept consent → verify intro step
3. Complete questionnaire → should show 2 sections (5 wellbeing + 10 learning)
4. Complete screen time → verify wizard advances
5. Complete sleep log → verify redirect to dashboard
6. Click a gauge → verify Focus Areas are removed (only "Your Status" shown)
7. Open chatbot → verify it has wellbeing context in its responses
8. Go to Profile → verify "Revoke Consent & Delete My Data" button at bottom
9. Log out and back in → verify wizard shows daily steps (no consent/intro since already given)
10. Complete all daily steps → verify dashboard loads

- [ ] **Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "fix: final integration fixes from smoke testing"
```
