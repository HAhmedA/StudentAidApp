// Frontend mirror of backend/config/concepts.js
// Single source of truth for concept IDs and display names on the frontend.

export const CONCEPT_IDS = ['sleep', 'srl', 'lms', 'screen_time'] as const
export type ConceptId = typeof CONCEPT_IDS[number]

export const CONCEPT_DISPLAY_NAMES: Record<ConceptId, string> = {
    sleep: 'Sleep Quality',
    srl: 'Self-Regulated Learning',
    lms: 'LMS Engagement',
    screen_time: 'Screen Time'
}

export const DOMAIN_TIPS: Record<string, string> = {
    // LMS
    volume:               'Try to log at least 30 minutes of active study per day, even if broken into shorter sessions.',
    consistency:          'Log in every day, even briefly — consistency builds momentum and keeps material fresh.',
    action_mix:           'Balance reading and videos with active tasks like quizzes and assignments. Active retrieval strengthens memory.',
    session_quality:      'Aim for focused sessions of 25–50 minutes with short breaks rather than long unfocused ones.',
    // Sleep
    duration:             'Aim for 7–9 hours per night. Set a consistent alarm to help anchor your sleep schedule.',
    continuity:           'Reduce caffeine after 2 pm, keep your room cool and dark, and wind down 30 minutes before bed.',
    timing:               'Go to bed and wake at the same time every day, even on weekends, to stabilise your body clock.',
    // Screen Time
    distribution:         'Break up long screen sessions every 20–30 minutes with a short walk or stretch to restore focus.',
    pre_sleep:            'Put devices away at least 30 minutes before bed. Use night mode or blue-light filters in the evening.',
    // SRL (survey-based concept keys)
    focus:                'Minimise distractions: put your phone away, close unrelated tabs, and use a dedicated study space.',
    effort:               'Even 20 focused minutes beats an hour of passive note-scrolling — quality of engagement matters more than time.',
    clarity:              'Before starting a task, re-read the brief or assignment prompt to confirm what is expected of you.',
    tracking:             'Keep a short log of what you studied and what still needs covering — even a few bullet points helps.',
    community:            'Peer discussion often reveals gaps in understanding that solo study misses. Try explaining a concept to someone else.',
    enjoyment:            'Connect course material to something you personally find interesting — even one real-world link can boost engagement.',
    efficiency:           'Identify the one highest-value task before each session and complete it first before moving to lower-priority work.',
    importance:           'Remind yourself how this subject connects to your broader goals or career path to reinvigorate motivation.',
    motivation:           'Break large goals into small wins — completing a section, a problem set, or a chapter gives a real sense of progress.',
    timeliness:           'Work backwards from deadlines: set personal mini-deadlines a few days ahead to reduce last-minute pressure.',
    help_seeking:         'Ask questions early — difficulties raised sooner are easier to address and prevent compounding confusion.',
    self_assessment:      'After each topic, try recalling the key points without looking — this reliably reveals gaps in real understanding.',
    learning_from_feedback: 'When you get feedback, note the single most important action point and apply it in your next submission.',
    anxiety:              'Try slow breathing before tests. Break revision into small steps and focus on progress, not perfection.',
}

// Dimensions where a higher raw score is worse (e.g. anxiety).
// Used to invert gauge needle direction on the dashboard.
export const INVERTED_CONCEPTS: string[] = ['anxiety']

// Human-readable descriptions of each scoring dimension shown in the breakdown panel.
export const DOMAIN_DESCRIPTIONS: Record<string, string> = {
    // LMS
    volume: 'Total active study minutes on the LMS. More is better.',
    consistency: 'Number of days you were active on the LMS. More is better.',
    action_mix: 'Ratio of active learning (quizzes, assignments) vs passive (reading, watching). Higher active % is better.',
    session_quality: 'Average duration of each study session. Focused sessions of 25–50 minutes are optimal — longer does not mean better if focus drops.',
    // Sleep
    duration: 'Average total sleep time per night. More sleep is better.',
    continuity: 'Number of times you woke up during the night. Fewer awakenings is better.',
    timing: 'How consistent your bedtime is each night. Lower variation is better.',
    // Screen Time
    distribution: 'Length of your longest continuous screen session. Shorter is better.',
    pre_sleep: 'Screen time before going to sleep. Less pre-sleep screen time is better.',
    // SRL
    goal_setting: 'How well you set clear learning goals before studying. Higher is better.',
    planning: 'How effectively you plan your study time and strategies. Higher is better.',
    task_strategies: 'Your use of specific strategies to complete tasks. Higher is better.',
    self_observation: 'How well you monitor your own learning progress. Higher is better.',
    self_judgement: 'How accurately you evaluate your own performance. Higher is better.',
    self_reaction: 'How constructively you respond to your own performance. Higher is better.',
    self_efficacy: 'Your confidence in your ability to learn and succeed. Higher is better.',
    intrinsic_motivation: 'Your internal drive and curiosity for learning. Higher is better.',
    extrinsic_motivation: 'Your motivation from grades and rewards. Higher is better.',
    elaboration: 'How deeply you process and connect new information. Higher is better.',
    critical_thinking: 'Your ability to question and analyze what you learn. Higher is better.',
    metacognitive_regulation: 'How well you adjust your learning strategies as needed. Higher is better.',
    anxiety: 'Your level of test and study anxiety. Lower anxiety is better.',
    // SRL (survey-based concept keys)
    focus:                'How well you sustain attention during study without being distracted. Higher is better.',
    effort:               'The effort and energy you invest in your learning tasks. Higher is better.',
    clarity:              'How clearly you understand what tasks you need to do and what is expected. Higher is better.',
    tracking:             'How well you monitor your own progress and learning goals. Higher is better.',
    community:            'How much you engage with peers for collaborative learning and discussion. Higher is better.',
    enjoyment:            'How much you enjoy and find the learning process engaging. Higher is better.',
    efficiency:           'How effectively you use your study time to achieve your learning goals. Higher is better.',
    importance:           'How important and relevant you perceive your studies to be to your goals. Higher is better.',
    motivation:           'Your overall drive and enthusiasm to actively engage with your studies. Higher is better.',
    timeliness:           'How promptly you complete tasks and assignments relative to deadlines. Higher is better.',
    help_seeking:         'Your willingness to seek help when you face challenges or confusion. Higher is better.',
    self_assessment:      'How accurately you evaluate your own understanding and performance. Higher is better.',
    learning_from_feedback: 'How effectively you use feedback to improve your future performance. Higher is better.',
}
