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

export const disabilityCategories: Record<string, string[]> = {
    'Reading Disabilities': ['Dyslexia', 'Hyperlexia', 'Visual Processing Disorder'],
    'Writing Disabilities': ['Dysgraphia', 'Written Expression Disorder', 'Motor Coordination Disorder'],
    'Mathematics Disabilities': ['Dyscalculia', 'Math Reasoning Disorder', 'Number Processing Disorder'],
    'Attention & Focus Disorders': ['Attention Deficit Disorder (ADD)', 'Attention Deficit Hyperactivity Disorder (ADHD)', 'Executive Function Disorder'],
    'Language & Communication Disorders': ['Auditory Processing Disorder (APD)', 'Expressive Language Disorder', 'Receptive Language Disorder'],
    'Memory & Cognitive Processing Disorders': ['Working Memory Deficit', 'Slow Processing Speed', 'Nonverbal Learning Disability (NVLD)'],
    'Autism Spectrum-Related Learning Differences': ['High-Functioning Autism', 'Asperger\'s Syndrome', 'Social Communication Disorder'],
    'Generalized Learning Disorders': ['Specific Learning Disorder (SLD)', 'Global Developmental Delay', 'Mild Cognitive Impairment']
}
