// Student mood routes
import { Router } from 'express'
import pool from '../config/database.js'
import { requireAuth } from '../middleware/auth.js'
import { asyncRoute } from '../utils/errors.js'

const router = Router()
router.use(requireAuth)

// Helper: extract rating constructs from survey JSON
function extractConstructs(surveyJson) {
    const constructs = []
    if (surveyJson?.pages) {
        for (const page of surveyJson.pages) {
            for (const element of page.elements ?? []) {
                if (element.name && element.type === 'rating') {
                    constructs.push({ name: element.name, title: element.title })
                }
            }
        }
    }
    return constructs
}

// Get mood statistics
router.get('/', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const { period, surveyId } = req.query

    const VALID_PERIODS = new Set(['today', '7days'])
    if (period && !VALID_PERIODS.has(period)) {
        return res.status(400).json({ error: 'invalid period' })
    }

    if (!surveyId) return res.status(400).json({ error: 'surveyId required' })

    const surveyResult = await pool.query('SELECT json FROM public.surveys WHERE id = $1', [surveyId])
    if (!surveyResult.rows[0]) return res.status(404).json({ error: 'survey_not_found' })

    const constructs = extractConstructs(surveyResult.rows[0].json)

    let dateFilter = ''
    if (period === 'today')  dateFilter = "AND DATE(created_at) = CURRENT_DATE"
    if (period === '7days')  dateFilter = "AND created_at >= NOW() - INTERVAL '7 days'"

    const { rows } = await pool.query(
        `SELECT id, answers, created_at FROM public.questionnaire_results
         WHERE postid = $1 AND user_id = $2 ${dateFilter} ORDER BY created_at ASC`,
        [surveyId, userId]
    )
    const results = rows.map(r => ({
        id: r.id, createdAt: r.created_at,
        data: typeof r.answers === 'string' ? JSON.parse(r.answers) : r.answers
    }))

    if (results.length === 0) {
        return res.json({
            period,
            constructs: constructs.map(c => ({ ...c, average: null, min: null, max: null, count: 0 })),
            hasData: false,
            totalResponses: 0
        })
    }

    const constructStats = constructs.map(construct => {
        const values = results
            .map(r => r.data[construct.name])
            .filter(v => v != null && !isNaN(Number(v)))
            .map(Number)
        if (values.length === 0) return { ...construct, average: null, min: null, max: null, count: 0 }
        const sum = values.reduce((a, b) => a + b, 0)
        return {
            ...construct,
            average: Math.round((sum / values.length) * 10) / 10,
            min: Math.min(...values),
            max: Math.max(...values),
            count: values.length
        }
    })

    res.json({ period, constructs: constructStats, hasData: true, totalResponses: results.length })
}))

// Get mood history (line graph data)
router.get('/history', asyncRoute(async (req, res) => {
    const userId = req.session.user.id
    const { surveyId, period } = req.query

    const VALID_PERIODS = new Set(['today', '7days'])
    if (period && !VALID_PERIODS.has(period)) {
        return res.status(400).json({ error: 'invalid period' })
    }

    if (!surveyId) return res.status(400).json({ error: 'surveyId required' })

    const surveyResult = await pool.query('SELECT json FROM public.surveys WHERE id = $1', [surveyId])
    if (!surveyResult.rows[0]) return res.status(404).json({ error: 'survey_not_found' })

    const constructs = extractConstructs(surveyResult.rows[0].json)

    let dateFilter = ''
    if (period === 'today') dateFilter = "AND DATE(created_at) = CURRENT_DATE"
    if (period === '7days') dateFilter = "AND created_at >= NOW() - INTERVAL '7 days'"

    const { rows } = await pool.query(
        `SELECT id, answers, created_at FROM public.questionnaire_results
         WHERE postid = $1 AND user_id = $2 ${dateFilter} ORDER BY created_at ASC`,
        [surveyId, userId]
    )

    const results = rows.map(r => {
        const data = typeof r.answers === 'string' ? JSON.parse(r.answers) : r.answers
        const date = new Date(r.created_at)
        return {
            id: r.id,
            date: date.toISOString().split('T')[0],
            time: date.toTimeString().split(' ')[0].substring(0, 5),
            timestamp: r.created_at,
            data
        }
    })

    let chartData = []
    const distinctDays = new Set(results.map(r => r.date))

    if (period === 'today') {
        chartData = results.map(r => {
            const point = { time: r.time, timestamp: r.timestamp }
            constructs.forEach(c => {
                const v = r.data[c.name]
                point[c.name] = (v != null && !isNaN(Number(v))) ? Number(v) : null
            })
            return point
        })
    } else if (period === '7days') {
        chartData = results.map(r => {
            const dt = new Date(r.timestamp)
            const label = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + r.time
            const point = { date: r.date, time: r.time, datetime: label, timestamp: r.timestamp }
            constructs.forEach(c => {
                const v = r.data[c.name]
                point[c.name] = (v != null && !isNaN(Number(v))) ? Number(v) : null
            })
            return point
        })
    } else {
        const dailyData = {}
        for (const r of results) {
            if (!dailyData[r.date]) {
                dailyData[r.date] = {}
                constructs.forEach(c => { dailyData[r.date][c.name] = [] })
            }
            constructs.forEach(c => {
                const v = r.data[c.name]
                if (v != null && !isNaN(Number(v))) dailyData[r.date][c.name].push(Number(v))
            })
        }
        chartData = Object.keys(dailyData).sort().map(date => {
            const dayData = { date }
            constructs.forEach(c => {
                const values = dailyData[date][c.name]
                dayData[c.name] = values.length > 0
                    ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
                    : null
            })
            return dayData
        })
    }

    res.json({
        constructs: constructs.map(c => ({ name: c.name, title: c.title })),
        data: chartData,
        period: period || 'all',
        totalResponses: results.length,
        distinctDayCount: distinctDays.size
    })
}))

export default router
