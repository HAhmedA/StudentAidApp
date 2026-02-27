# Simulated Data Documentation

This document provides a comprehensive overview of all simulated data types, their attributes, annotation domains, and calculation methods.

---

## Overview

The system generates data for 4 domains, each based on student achievement profiles (`high_achiever`, `average`, `low_achiever`):

| Domain | Simulator File | Annotation File | Primary Purpose |
|--------|---------------|-----------------|-----------------|
| **Sleep** | `sleepDataSimulator.js` | `sleepAnnotationService.js` | Sleep patterns & quality |
| **SRL** | `srlDataSimulator.js` | `srlAnnotationService.js` | Self-regulated learning questionnaire |
| **LMS** | `lmsDataSimulator.js` | `lmsAnnotationService.js` | Learning management system activity |
| **Screen Time** | `screenTimeDataSimulator.js` | `screenTimeAnnotationService.js` | Digital device usage |

---

## 1. Sleep Data

### Simulated Attributes

| Attribute | Description | High Achiever | Average | Low Achiever |
|-----------|-------------|---------------|---------|--------------|
| `total_sleep_minutes` | Total sleep duration | ~450 ± 30 min (~7.5h) | ~400 ± 60 min (~6.7h) | ~330 ± 60 min (~5.5h) |
| `time_in_bed_minutes` | Total time in bed | ~480 ± 20 min (~8h) | ~460 ± 40 min | ~420 ± 60 min |
| `bedtime_hour` | When sleep begins | 23:00 ± 30min | 23:30 ± 1.5h | 01:00 ± 2h |
| `wake_hour` | When waking up | 07:00 ± 30min | 07:30 ± 1h | 08:00 ± 1.5h |
| `awakenings_count` | Number of wake-ups | ~1 ± 1 | ~3 ± 2 | ~5 ± 3 |
| `awake_minutes` | Time awake during night | ~5 ± 5 min | ~15 ± 10 min | ~30 ± 15 min |

### Behavioral Modifiers

| Modifier | High Achiever | Average | Low Achiever |
|----------|---------------|---------|--------------|
| Anomaly chance | 10% (bad night) | 15% (random) | 8% (good night) |
| Weekend bedtime shift | +1 hour | +1.5 hours | +2.5 hours |
| Weekend wake shift | +1.5 hours | +2 hours | +3 hours |
| Recovery factor | 0.8 (fast) | 0.5 (medium) | 0.3 (slow) |

### Annotation Domains & Calculations

| Domain | Judgment | Condition | Severity |
|--------|----------|-----------|----------|
| **Duration** | `sleep_time_very_low` | < 75% of baseline | poor |
| | `sleep_time_low` | 75-90% of baseline | warning |
| | `sleep_time_sufficient` | 90-110% of baseline | ok |
| | `sleep_time_long` | > 110% of baseline | ok |
| **Continuity** | `sleep_continuous` | ≤2 awakenings AND <10 min awake | ok |
| | `sleep_minor_interruptions` | ≤5 awakenings AND ≤30 min awake | warning |
| | `sleep_multiple_awakenings` | >5 awakenings | poor |
| | `sleep_fragmented` | >30 min awake | poor |
| **Timing** | `schedule_consistent` | <30 min deviation from baseline | ok |
| | `timing_slightly_irregular` | 30-60 min deviation | warning |
| | `schedule_inconsistent` | >60 min deviation | poor |

---

## 2. SRL (Self-Regulated Learning) Data

### Simulated Attributes

Responses are generated for 14 concepts on a 1-5 Likert scale:

| Concept | Short Name | Inverted? | High Achiever | Average | Low Achiever |
|---------|------------|-----------|---------------|---------|--------------|
| `efficiency` | Efficiency | No | 4-5 | 2-4 | 1-3 |
| `importance` | Perceived Importance | No | 4-5 | 2-4 | 1-3 |
| `tracking` | Progress Tracking | No | 4-5 | 2-4 | 1-3 |
| `clarity` | Task Clarity | No | 4-5 | 2-4 | 1-3 |
| `effort` | Effort | No | 4-5 | 2-4 | 1-3 |
| `focus` | Focus | No | 4-5 | 2-4 | 1-3 |
| `help_seeking` | Help Seeking | No | 4-5 | 2-4 | 1-3 |
| `community` | Peer Learning | No | 4-5 | 2-4 | 1-3 |
| `timeliness` | Timeliness | No | 4-5 | 2-4 | 1-3 |
| `motivation` | Motivation | No | 4-5 | 2-4 | 1-3 |
| `anxiety` | Anxiety | **Yes** | 1-2 | 2-4 | 3-5 |
| `enjoyment` | Enjoyment | No | 4-5 | 2-4 | 1-3 |
| `learning_from_feedback` | Learning from Feedback | No | 4-5 | 2-4 | 1-3 |
| `self_assessment` | Self Assessment | No | 4-5 | 2-4 | 1-3 |

### Behavioral Modifiers

| Modifier | High Achiever | Average | Low Achiever |
|----------|---------------|---------|--------------|
| Consistency factor | 0.85 | 0.65 | 0.70 |
| Anomaly chance | 12% | 18% | 10% |
| Anomaly shift | -2 | 0 (random ±2) | +2 |
| Weekend effect | -0.3 | -0.5 | -0.8 |
| Weekly trend | +0.05 | 0 | -0.03 |

### Annotation Calculations

| Metric | Calculation Method |
|--------|-------------------|
| **Average Score** | Mean of all responses for concept in time window |
| **Trend** | Compare earlier half vs recent half (threshold: 0.5 change) |
| **Fluctuating** | ≥1 direction change AND range ≥2 |
| **Stable Level** | High: ≥4.0, Avg: 2.5-4.0, Low: <2.5 |
| **Data Sufficiency** | ≥3 distinct days in 7-day window |

### Trend Classifications

| Trend | Normal Concepts | Inverted (Anxiety) |
|-------|----------------|-------------------|
| `improving` | Score increasing | Score decreasing (good) |
| `declining` | Score decreasing | Score increasing (bad) |
| `fluctuating` | High variance oscillation | Same |
| `stable_high` | Avg ≥ 4.0 | Needs attention |
| `stable_avg` | Avg 2.5-4.0 | Moderate |
| `stable_low` | Avg < 2.5 | Good (low anxiety) |

---

## 3. LMS (Learning Management System) Data

### Simulated Attributes

| Attribute | Description | High Achiever | Average | Low Achiever |
|-----------|-------------|---------------|---------|--------------|
| `total_active_minutes` | Total learning time | ~80 ± 20 min | ~50 ± 25 min | ~20 ± 15 min |
| `sessions_per_week` | Sessions count | ~6 ± 1 | ~4 ± 2 | ~2 ± 1 |
| `avg_session_length` | Average session | ~30 ± 10 min | ~20 ± 10 min | ~15 ± 10 min |
| `longest_session_minutes` | Longest session | Calculated | Calculated | Calculated |
| `passive_ratio` | Reading/watching % | ~0.60 ± 0.10 | ~0.75 ± 0.10 | ~0.90 ± 0.10 |
| `exercise_practice_events` | Practice activities | ~4 ± 2 | ~2 ± 2 | ~0 ± 1 |
| `forum_posts` | Discussion posts | ~2 ± 1 | ~1 ± 1 | ~0 ± 0 |

### Annotation Domains & Calculations

| Domain | Sub-domain | Judgment | Condition |
|--------|------------|----------|-----------|
| **Volume** | — | `volume_low` | < 70% of baseline |
| | | `volume_moderate` | 70-110% of baseline |
| | | `volume_high` | > 110% of baseline |
| **Distribution** | — | `dist_condensed` | ≤2 sessions AND ≥60 min longest |
| | | `dist_spread` | 3-5 sessions AND <60 min longest |
| | | `dist_fragmented` | >5 sessions AND <10 min avg |
| **Consistency** | — | `cons_consistent` | ≥5 days active |
| | | `cons_somewhat` | 3-4 days active |
| | | `cons_inconsistent` | ≤2 days active |
| **Participation Variety** | Type | `no_active_work` | tool_count = 0 (no quizzes/assignments/forum) |
| | | `single_tool` | tool_count = 1 (only one activity type) |
| | | `multi_tool` | tool_count = 2 (two activity types) |
| | | `fully_engaged` | tool_count = 3 (all three: quizzes + assignments + forum) |
| | | `participation_score` | `MIN(quiz,3)/3×34 + MIN(assign,2)/2×33 + MIN(forum,2)/2×33` |
| | Practice | `prac_low` | 0 events |
| | | `prac_moderate` | 1-3 events |
| | | `prac_high` | ≥4 events |
| | Discussion | `disc_low` | 0 posts |
| | | `disc_moderate` | 1-2 posts |
| | | `disc_high` | ≥3 posts |
| **Session Quality** | — | `qual_focused` | ≥25 min avg AND ≥45 min longest |
| | | `qual_short` | <45 min total AND <10 min avg |
| | | `qual_interrupted` | <10 min avg AND ≥5 sessions |
| | | `qual_standard` | Default |

---

## 4. Screen Time Data

### Simulated Attributes

| Attribute | Description | High Achiever | Average | Low Achiever |
|-----------|-------------|---------------|---------|--------------|
| `total_screen_minutes` | Daily screen time | ~180 ± 40 min (~3h) | ~300 ± 60 min (~5h) | ~450 ± 80 min (~7.5h) |
| `late_night_screen_minutes` | Before sleep | ~10 ± 8 min | ~30 ± 15 min | ~60 ± 25 min |
| `longest_continuous_session` | Max unbroken session | ~35 ± 10 min | ~55 ± 20 min | ~100 ± 30 min |

### Behavioral Modifiers

| Modifier | High Achiever | Average | Low Achiever |
|----------|---------------|---------|--------------|
| Anomaly chance | 10% | 15% | 8% |
| Weekend increase | +60 min | +90 min | +120 min |
| Recovery factor | 0.8 | 0.5 | 0.3 |

### Annotation Domains & Calculations

| Domain | Judgment | Condition | Severity |
|--------|----------|-----------|----------|
| **Volume** | `screen_time_low` | < 70% of baseline | ok |
| | `screen_time_moderate` | 70-110% of baseline | ok |
| | `screen_time_high` | 110-140% of baseline | warning |
| | `screen_time_excessive` | ≥ 140% of baseline | poor |
| **Distribution** | `screen_usage_balanced` | Longest < 45 min | ok |
| | `screen_usage_moderate_sessions` | Longest 45-90 min | warning |
| | `screen_usage_extended` | Longest > 90 min | poor |
| **Pre-Sleep** | `pre_sleep_minimal` | < 15 min before bed | ok |
| | `pre_sleep_some` | 15-45 min before bed | warning |
| | `pre_sleep_high` | > 45 min before bed | poor |

---

## Severity Levels Reference

| Severity | Meaning | Chatbot Treatment |
|----------|---------|-------------------|
| `ok` | Healthy/normal behavior | Positive reinforcement |
| `warning` | Minor concerns | Gentle suggestions |
| `poor` | Significant issues | Areas needing attention |

---

## Profile Assignment

Profiles are assigned by the **Simulation Orchestrator** and stored in `student_profiles.simulated_profile`. All simulators read this profile and generate correlated data patterns.

---

## 5. Realistic 40-Day Simulation (`simulateRealisticData.js`)

A standalone batch script that generates 40 days of realistic, varied data for all 20 named test students. Unlike the per-user simulators, this script bypasses `simulationOrchestratorService.js` and calls annotation/scoring services directly.

### Student Personas

| # | Name | Background | Profile | Chronotype | LMS Pattern | SRL Freq | Trend | Disability |
|---|------|------------|---------|------------|-------------|----------|-------|------------|
| 1 | Wei Chen | East Asian | high_achiever | early_bird | consistent | frequent | stable | — |
| 2 | Arjun Patel | South Asian | average | normal | deadline_driven | regular | improving | — |
| 3 | Amara Osei | West African | low_achiever | night_owl | minimal | sparse | declining | Dyslexia |
| 4 | Sofia Reyes | Hispanic/Latina | high_achiever | early_bird | consistent | frequent | improving | — |
| 5 | Hiroshi Tanaka | East Asian | average | normal | binge_then_rest | regular | stable | — |
| 6 | Chidinma Eze | West African | low_achiever | night_owl | minimal | sparse | declining | ADHD |
| 7 | Elias Bergström | Nordic/European | high_achiever | early_bird | consistent | frequent | stable | — |
| 8 | Priya Krishnamurthy | South Asian | average | normal | deadline_driven | regular | improving | — |
| 9 | Omar Al-Farsi | Middle Eastern | low_achiever | night_owl | minimal | frequent | stable | WMD |
| 10 | Anika Müller | German/European | high_achiever | early_bird | consistent | frequent | improving | — |
| 11 | Camille Dupont | French/European | average | normal | deadline_driven | regular | stable | — |
| 12 | Tariq Mensah | West African | low_achiever | night_owl | binge_then_rest | sparse | declining | Dyslexia |
| 13 | Yuna Kim | Korean | high_achiever | early_bird | consistent | frequent | improving | — |
| 14 | Marcus Johnson | African-American | average | normal | deadline_driven | regular | stable | — |
| 15 | Fatima Al-Rashidi | Middle Eastern | low_achiever | night_owl | minimal | sparse | declining | ADHD |
| 16 | Isabela Santos | Brazilian/Hispanic | high_achiever | early_bird | consistent | frequent | stable | — |
| 17 | Nour Hassan | Middle Eastern | average | normal | binge_then_rest | regular | improving | — |
| 18 | Sebastian Kowalski | Eastern European | low_achiever | night_owl | minimal | frequent | declining | WMD |
| 19 | Aaliya Sharma | South Asian | high_achiever | early_bird | consistent | frequent | stable | — |
| 20 | Lucas Andrade | Brazilian/Hispanic | average | normal | deadline_driven | regular | stable | — |

### Realism Dimensions

| Dimension | Description |
|-----------|-------------|
| Chronotypes | 3 types (early_bird/normal/night_owl) driving bedtime/wake distributions |
| LMS Sparsity | 4 patterns: consistent (65% active days), deadline_driven (85% near deadlines), binge_then_rest (5-on/5-off), minimal (22%) |
| SRL Irregularity | Per-student daily submission probability: frequent=40%, regular=15%, sparse=7% |
| Longitudinal Trend | 40-day improving/stable/declining arc (`0.85→1.15` multiplier) applied to raw metrics |
| Exam Weeks | Days 0–4 and 35–39: LMS spike ×1.5, bedtime +1.5h, sleep −60 min, SRL paused |
| Weekend Effects | +1.5h bedtime, +60–90 min screen time, 70% chance LMS inactive |
| Bad-Sleep Carry-over | Poor night (<85% baseline sleep) → −20 min next night sleep, +30 min screen |
| Disability Effects | ADHD: sleep variance ×1.4, screen variance ×1.5; Dyslexia: LMS longest session ×1.5; WMD: SRL frequency ×1.5, +0.5 anxiety |
| Submission Timing | SRL: 8 AM–10 PM with random minutes; LMS assignments biased to Thu/Fri evenings |

### Running the Script

```bash
PGHOST=localhost PGPORT=5433 PGUSER=postgres PGPASSWORD=password PGDATABASE=postgres \
  node backend/scripts/simulateRealisticData.js
```

### Profile-Based History Normalization (Phase 7 formulas)

| Concept | Formula |
|---------|---------|
| **Sleep** | `clamp((sleepMin − 270) / (540 − 270) × 100, 0, 100)` |
| **Screen** (inverted) | `clamp(100 − (screenMin − 60) / (600 − 60) × 100, 0, 100)` |
| **LMS** | `participation_score + (activeMin / 90) × 40`; inactive days decay prev score × 0.9 |
| **SRL** | Average of last-7-days responses per concept → `(avg−1)/4×100`; anxiety inverted as `(5−avg)/4×100` |
