// Canonical concept configuration — single source of truth for all concept metadata.
// Any file that needs concept IDs, display names, or table names must import from here.

export const CONCEPTS = {
    sleep: {
        id: 'sleep',
        displayName: 'Sleep Quality',
        table: 'sleep_sessions',
        dimensions: ['duration', 'continuity', 'timing']
    },
    srl: {
        id: 'srl',
        displayName: 'Self-Regulated Learning',
        table: 'srl_annotations',
        dimensions: ['efficiency', 'importance', 'tracking', 'effort', 'help_seeking', 'community', 'timeliness', 'motivation', 'anxiety', 'reflection']
    },
    lms: {
        id: 'lms',
        displayName: 'LMS Engagement',
        table: 'lms_sessions',
        dimensions: ['volume', 'consistency', 'participation_variety', 'session_quality']
    },
    screen_time: {
        id: 'screen_time',
        displayName: 'Screen Time',
        table: 'screen_time_sessions',
        dimensions: ['volume', 'distribution', 'pre_sleep']
    }
}

// ['sleep', 'srl', 'lms', 'screen_time']
export const CONCEPT_IDS = Object.keys(CONCEPTS)

// { sleep: 'Sleep Quality', srl: 'Self-Regulated Learning', ... }
export const CONCEPT_NAMES = Object.fromEntries(
    Object.entries(CONCEPTS).map(([id, c]) => [id, c.displayName])
)
