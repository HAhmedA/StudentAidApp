import type { SliderQuestion } from '../components/QuestionnaireSliders'

// ── WHO-5 wellbeing questions (0–10 slider) ──────────────────
export const WHO5_QUESTIONS: SliderQuestion[] = [
    { key: 'cheerfulness', text: 'I have felt cheerful and in good spirits.' },
    { key: 'calmness', text: 'I have felt calm and relaxed.' },
    { key: 'vitality', text: 'I have felt active and vigorous.' },
    { key: 'restedness', text: 'I woke up feeling fresh and rested.' },
    { key: 'interest', text: 'My daily life has been filled with things that interest me.' },
]

// ── SRL learning questions (1–5 slider) ──────────────────────
export const SRL_QUESTIONS: SliderQuestion[] = [
    { key: 'efficiency', text: 'I believe I can accomplish my learning duties and learning tasks efficiently.', lowLabel: 'Strongly disagree', highLabel: 'Strongly agree' },
    { key: 'importance', text: 'I believe that my learning tasks are very important to me.', lowLabel: 'Not important', highLabel: 'Very important' },
    { key: 'tracking', text: 'I keep track of what I need to do and understand what I must do to accomplish my learning tasks.', lowLabel: 'Never', highLabel: 'Always' },
    { key: 'effort', text: 'I put enough effort into my learning tasks and stay focused while working on them.', lowLabel: 'Not enough effort', highLabel: 'A lot of effort' },
    { key: 'help_seeking', text: 'I seek help from teachers, friends, or the internet when I need explanation or help with difficult tasks.', lowLabel: 'Never seek help', highLabel: 'Always seek help' },
    { key: 'community', text: 'I am having nice interactions and feeling at home within the college community.', lowLabel: 'Not at all', highLabel: 'Very much' },
    { key: 'timeliness', text: 'I am doing my studies on time and keeping up with tasks/deadlines.', lowLabel: 'Always late', highLabel: 'Always on time' },
    { key: 'motivation', text: 'I feel motivated to learn and enjoy working on my learning tasks.', lowLabel: 'Not motivated', highLabel: 'Highly motivated' },
    { key: 'anxiety', text: 'I feel anxious or stressed working on learning tasks, assignments, or in class.', lowLabel: 'Never anxious', highLabel: 'Very anxious' },
    { key: 'reflection', text: 'I reflect on my performance and learn from feedback or mistakes to improve my learning.', lowLabel: 'Never reflect', highLabel: 'Always reflect' },
]

// ── Scale definitions ────────────────────────────────────────
export const WELLBEING_SCALE = { min: 0, max: 10, step: 0.1, defaultValue: 5 } as const
export const SRL_SCALE = { min: 1, max: 5, step: 0.1, defaultValue: 3 } as const

// ── Page structure for Run.tsx multi-page questionnaire ──────
export const QUESTIONNAIRE_PAGES = [
    {
        name: 'wellbeing',
        title: 'How are you feeling today?',
        description: 'Rate how you have felt over the past day.',
        questions: WHO5_QUESTIONS,
        scale: WELLBEING_SCALE,
    },
    {
        name: 'learning',
        title: 'Your Learning Today',
        description: 'Reflect on your learning strategies and experience.',
        questions: SRL_QUESTIONS,
        scale: SRL_SCALE,
    },
] as const
