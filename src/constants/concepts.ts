// Frontend mirror of backend/config/concepts.js
// Single source of truth for concept IDs and display names on the frontend.

export const CONCEPT_IDS = ['sleep', 'srl', 'lms', 'screen_time'] as const
export type ConceptId = typeof CONCEPT_IDS[number]

export const CONCEPT_DISPLAY_NAMES: Record<ConceptId, string> = {
    sleep: 'Sleep Quality',
    srl: 'My Learning',
    lms: 'Course Activity',
    screen_time: 'Screen Time'
}

export const DOMAIN_TIPS: Record<string, string> = {
    // LMS
    volume:               'Try to log at least 30 minutes of active study per day, even if broken into shorter sessions.',
    consistency:          'Log in every day, even briefly — consistency builds momentum and keeps material fresh.',
    session_quality:      'Aim for focused sessions of 25–50 minutes with short breaks rather than long unfocused ones.',
    // Sleep
    duration:             'Aim for 7–9 hours per night. Set a consistent alarm to help anchor your sleep schedule.',
    continuity:           'Reduce caffeine after 2 pm, keep your room cool and dark, and wind down 30 minutes before bed.',
    timing:               'Go to bed and wake at the same time every day, even on weekends, to stabilise your body clock.',
    // Screen Time
    distribution:         'Break up long screen sessions every 20–30 minutes with a short walk or stretch to restore focus.',
    pre_sleep:            'Put devices away at least 30 minutes before bed. Use night mode or blue-light filters in the evening.',
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
}

// Dimensions where a higher raw score is worse (e.g. anxiety).
// Used to invert gauge needle direction on the dashboard.
export const INVERTED_CONCEPTS: string[] = ['anxiety']

// Human-readable descriptions of each scoring dimension shown in the breakdown panel.
export const DOMAIN_DESCRIPTIONS: Record<string, string> = {
    // LMS
    volume: 'Total active study minutes on the LMS. More is better.',
    consistency: 'Number of days you were active on the LMS. More is better.',
    session_quality: 'Average duration of each study session. Focused sessions of 25–50 minutes are optimal — longer does not mean better if focus drops.',
    participation_variety: 'Breadth of LMS activity types (quizzes, assignments, forums). Higher variety is better.',
    // Sleep
    duration: 'Average total sleep time per night. More sleep is better.',
    continuity: 'Number of times you woke up during the night. Fewer awakenings is better.',
    timing: 'How consistent your bedtime is each night. Lower variation is better.',
    // Screen Time
    distribution: 'Length of your longest continuous screen session. Shorter is better.',
    pre_sleep: 'Screen time before going to sleep. Less pre-sleep screen time is better.',
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
}
