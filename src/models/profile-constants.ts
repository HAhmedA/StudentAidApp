export const educationLevels = ['Bachelor\'s', 'Master\'s', 'PhD', 'Post Doc']

export const fieldsOfStudy = [
    'Engineering & Technology',
    'Computer Science & Information Technology',
    'Natural Sciences',
    'Health & Medical Sciences',
    'Business & Management',
    'Social Sciences',
    'Arts & Humanities',
    'Communication & Media',
    'Education',
    'Law, Policy & Public Service'
]

export const majorsByField: Record<string, string[]> = {
    'Engineering & Technology': [
        'Mechanical Engineering', 'Civil Engineering', 'Electrical Engineering',
        'Computer Engineering', 'Chemical Engineering', 'Industrial Engineering',
        'Aerospace Engineering', 'Software Engineering', 'Biomedical Engineering',
        'Environmental Engineering'
    ],
    'Computer Science & Information Technology': [
        'Computer Science', 'Information Technology', 'Cybersecurity', 'Data Science',
        'Artificial Intelligence', 'Game Design', 'Computer Networks', 'Web Development',
        'Cloud Computing', 'Information Systems'
    ],
    'Natural Sciences': [
        'Biology', 'Chemistry', 'Physics', 'Geology', 'Environmental Science',
        'Astronomy', 'Oceanography', 'Ecology', 'Biochemistry', 'Marine Biology'
    ],
    'Health & Medical Sciences': [
        'Nursing', 'Medicine', 'Public Health', 'Pharmacy', 'Dentistry',
        'Nutrition and Dietetics', 'Physical Therapy', 'Biomedical Sciences',
        'Occupational Therapy', 'Health Administration'
    ],
    'Business & Management': [
        'Business Administration', 'Finance', 'Marketing', 'Accounting',
        'Human Resource Management', 'International Business', 'Entrepreneurship',
        'Supply Chain Management', 'Economics', 'Hospitality Management'
    ],
    'Social Sciences': [
        'Psychology', 'Sociology', 'Anthropology', 'Political Science', 'Criminology',
        'Geography', 'International Relations', 'Archaeology', 'Gender Studies',
        'Cultural Studies'
    ],
    'Arts & Humanities': [
        'English Literature', 'History', 'Philosophy', 'Linguistics', 'Religious Studies',
        'Fine Arts', 'Art History', 'Music', 'Theatre Arts', 'Creative Writing'
    ],
    'Communication & Media': [
        'Journalism', 'Media Studies', 'Public Relations', 'Film and Television Production',
        'Communication Studies', 'Advertising', 'Digital Media', 'Broadcasting',
        'Screenwriting', 'Visual Communication'
    ],
    'Education': [
        'Early Childhood Education', 'Elementary Education', 'Secondary Education',
        'Special Education', 'Educational Leadership', 'Curriculum and Instruction',
        'Adult Education', 'Educational Psychology', 'Counseling', 'TESOL'
    ],
    'Law, Policy & Public Service': [
        'Law', 'Public Policy', 'Public Administration', 'International Law',
        'Political Science', 'Criminal Justice', 'Legal Studies', 'Human Rights',
        'Urban Planning', 'Social Work'
    ]
}

export const learningFormatOptions = ['Reading', 'Listening', 'Watching', 'Hands-on Practice', 'Discussion', 'Writing']

export interface DisabilityItem {
    id: string
    label: string
    tooltip: string
}

export interface DisabilityCategory {
    id: string
    label: string
    otherKey: string
    items: DisabilityItem[]
}

export const disabilityCategoriesDSM5: DisabilityCategory[] = [
    {
        id: 'sld',
        label: 'Specific Learning Disorders',
        otherKey: 'sld_other',
        items: [
            { id: 'dyslexia', label: 'Dyslexia', tooltip: 'DSM-5: Specific Learning Disorder with impairment in reading — affects word recognition, decoding, and spelling.' },
            { id: 'dysgraphia', label: 'Dysgraphia', tooltip: 'DSM-5: Specific Learning Disorder with impairment in written expression — affects handwriting, spelling, and composition.' },
            { id: 'dyscalculia', label: 'Dyscalculia', tooltip: 'DSM-5: Specific Learning Disorder with impairment in mathematics — affects number sense, arithmetic facts, and calculation.' },
            { id: 'reading_nos', label: 'Reading Disorder (NOS)', tooltip: 'Reading difficulties that do not fully meet Dyslexia criteria but significantly affect academic performance.' },
            { id: 'written_expression', label: 'Written Expression Disorder', tooltip: 'DSM-5: Difficulties in written expression beyond spelling, including grammar, punctuation, and idea organisation.' },
        ]
    },
    {
        id: 'adhd',
        label: 'ADHD',
        otherKey: 'adhd_other',
        items: [
            { id: 'adhd_inattentive', label: 'Predominantly Inattentive', tooltip: 'DSM-5 ADHD: Primary difficulties with sustained attention, organisation, and following through on tasks.' },
            { id: 'adhd_hyperactive', label: 'Predominantly Hyperactive-Impulsive', tooltip: 'DSM-5 ADHD: Primary difficulties with hyperactivity, fidgeting, and impulsive decision-making.' },
            { id: 'adhd_combined', label: 'Combined Presentation', tooltip: 'DSM-5 ADHD: Meets criteria for both inattentive and hyperactive-impulsive presentations.' },
        ]
    },
    {
        id: 'asd',
        label: 'Autism Spectrum Disorder',
        otherKey: 'asd_other',
        items: [
            { id: 'asd_level1', label: 'ASD Level 1', tooltip: 'DSM-5 ASD Level 1 (formerly Asperger\'s Syndrome / High-Functioning Autism): Requires support; social communication differences with average or above-average intellectual ability.' },
            { id: 'asd_level2', label: 'ASD Level 2', tooltip: 'DSM-5 ASD Level 2: Requires substantial support; more pronounced social communication and behavioural challenges.' },
        ]
    },
    {
        id: 'lang',
        label: 'Language & Communication',
        otherKey: 'lang_other',
        items: [
            { id: 'lang_disorder', label: 'Language Disorder', tooltip: 'DSM-5: Persistent difficulties in the acquisition and use of language across modalities (spoken, written, or sign).' },
            { id: 'social_communication', label: 'Social (Pragmatic) Communication Disorder', tooltip: 'DSM-5: Primary difficulties with the social use of verbal and nonverbal communication, distinct from ASD.' },
            { id: 'apd', label: 'Auditory Processing Disorder (APD)', tooltip: 'Difficulty processing auditory information despite normal hearing — affects listening in noisy environments and following spoken instructions.' },
        ]
    },
    {
        id: 'dev_motor',
        label: 'Developmental & Motor',
        otherKey: 'dev_motor_other',
        items: [
            { id: 'dcd', label: 'DCD (Dyspraxia)', tooltip: 'DSM-5 Developmental Coordination Disorder: Difficulties with motor skill acquisition affecting daily activities and academic tasks.' },
            { id: 'sensory_processing', label: 'Sensory Processing Differences', tooltip: 'Atypical responses to sensory input (e.g., noise, light, touch) that affect concentration and learning environments.' },
        ]
    },
    {
        id: 'cog',
        label: 'Cognitive Processing',
        otherKey: 'cog_other',
        items: [
            { id: 'nvld', label: 'NVLD', tooltip: 'Nonverbal Learning Disability: Strong verbal skills alongside difficulties with visual-spatial processing, maths, and social cues.' },
            { id: 'working_memory', label: 'Working Memory Deficit', tooltip: 'Reduced capacity to hold and manipulate information in short-term memory, affecting multi-step tasks and following instructions.' },
            { id: 'slow_processing', label: 'Slow Processing Speed', tooltip: 'Takes significantly longer to process and respond to information, affecting timed tasks and note-taking.' },
        ]
    },
    {
        id: 'other',
        label: 'Other / Prefer Not to Specify',
        otherKey: 'other_text',
        items: [
            { id: 'prefer_not', label: 'Prefer not to specify', tooltip: 'You can still receive personalised support without specifying a diagnosis.' },
        ]
    },
]

/** Maps old string disability labels (stored in DB before DSM-5 migration) to new IDs */
export const DISABILITY_LEGACY_MAP: Record<string, string> = {
    'Dyslexia': 'dyslexia',
    'Dysgraphia': 'dysgraphia',
    'Dyscalculia': 'dyscalculia',
    'Written Expression Disorder': 'written_expression',
    'Motor Coordination Disorder': 'dcd',
    'Attention Deficit Disorder (ADD)': 'adhd_inattentive',
    'Attention Deficit Hyperactivity Disorder (ADHD)': 'adhd_combined',
    'Executive Function Disorder': 'adhd_combined',
    'Auditory Processing Disorder (APD)': 'apd',
    'Expressive Language Disorder': 'lang_disorder',
    'Receptive Language Disorder': 'lang_disorder',
    'Working Memory Deficit': 'working_memory',
    'Slow Processing Speed': 'slow_processing',
    'Nonverbal Learning Disability (NVLD)': 'nvld',
    "High-Functioning Autism": 'asd_level1',
    "Asperger's Syndrome": 'asd_level1',
    'Social Communication Disorder': 'social_communication',
    'Specific Learning Disorder (SLD)': 'dyslexia',
}

// Keep legacy export for any remaining references
export const disabilityCategories: Record<string, string[]> = {}
