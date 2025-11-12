import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Surveys from '../components/Surveys'
import { useReduxSelector, useReduxDispatch } from '../redux'
import { load } from '../redux/surveys'
import { loadStudentMood, ConstructStat } from '../redux/results'
import './Home.css'

const Home = () => {
    const user = useReduxSelector(state => state.auth.user)
    const surveys = useReduxSelector(state => state.surveys.surveys)
    const surveysStatus = useReduxSelector(state => state.surveys.status)
    const dispatch = useReduxDispatch()
    const navigate = useNavigate()
    const isAdmin = user?.role === 'admin' || user?.email === 'admin@example.com'
    const title = isAdmin ? 'My Surveys' : 'Available Surveys'
    
    const [moodToday, setMoodToday] = useState<{ constructs: ConstructStat[]; hasData: boolean; totalResponses: number } | null>(null)
    const [mood7Days, setMood7Days] = useState<{ constructs: ConstructStat[]; hasData: boolean; totalResponses: number } | null>(null)
    const [loadingToday, setLoadingToday] = useState(false)
    const [loading7Days, setLoading7Days] = useState(false)
    
    // Load surveys if not already loaded
    useEffect(() => {
        if (surveysStatus === 'idle' && surveys.length === 0) {
            dispatch(load())
        }
    }, [surveysStatus, dispatch, surveys.length])
    
    // Load mood data for students
    useEffect(() => {
        if (!isAdmin && surveys.length > 0) {
            const firstSurvey = surveys[0]
            setLoadingToday(true)
            setLoading7Days(true)
            
            dispatch(loadStudentMood({ surveyId: firstSurvey.id, period: 'today' }))
                .then((result: any) => {
                    if (result.type === 'results/loadStudentMood/fulfilled') {
                        setMoodToday({ 
                            constructs: result.payload.constructs || [], 
                            hasData: result.payload.hasData || false,
                            totalResponses: result.payload.totalResponses || 0
                        })
                    } else {
                        setMoodToday({ constructs: [], hasData: false, totalResponses: 0 })
                    }
                    setLoadingToday(false)
                })
                .catch((error) => {
                    setMoodToday({ constructs: [], hasData: false, totalResponses: 0 })
                    setLoadingToday(false)
                })
            
            dispatch(loadStudentMood({ surveyId: firstSurvey.id, period: '7days' }))
                .then((result: any) => {
                    if (result.type === 'results/loadStudentMood/fulfilled') {
                        setMood7Days({ 
                            constructs: result.payload.constructs || [], 
                            hasData: result.payload.hasData || false,
                            totalResponses: result.payload.totalResponses || 0
                        })
                    } else {
                        setMood7Days({ constructs: [], hasData: false, totalResponses: 0 })
                    }
                    setLoading7Days(false)
                })
                .catch((error) => {
                    setMood7Days({ constructs: [], hasData: false, totalResponses: 0 })
                    setLoading7Days(false)
                })
        }
    }, [isAdmin, surveys, dispatch])
    
    // Add class to parent main element for student mood layout
    useEffect(() => {
        if (!isAdmin) {
            const mainElement = document.querySelector('.sjs-app__content')
            if (mainElement) {
                mainElement.classList.add('mood-content-override')
            }
            return () => {
                if (mainElement) {
                    mainElement.classList.remove('mood-content-override')
                }
            }
        }
    }, [isAdmin])
    
    // Get first survey for "Fill Survey" button
    const firstSurvey = surveys.length > 0 ? surveys[0] : null
    
    const handleCardClick = (period: 'today' | '7days') => {
        if (firstSurvey) {
            navigate(`/mood-history/${firstSurvey.id}?period=${period}`)
        }
    }
    
    // Helper function to convert hex to RGB
    const hexToRgb = (hex: string): [number, number, number] => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
        return result
            ? [
                parseInt(result[1], 16),
                parseInt(result[2], 16),
                parseInt(result[3], 16)
            ]
            : [0, 0, 0]
    }
    
    // Helper function to convert RGB to hex
    const rgbToHex = (r: number, g: number, b: number): string => {
        return '#' + [r, g, b].map(x => {
            const hex = Math.round(x).toString(16)
            return hex.length === 1 ? '0' + hex : hex
        }).join('')
    }
    
    // Interpolate between two colors
    const interpolateColor = (color1: string, color2: string, factor: number): string => {
        const rgb1 = hexToRgb(color1)
        const rgb2 = hexToRgb(color2)
        const r = rgb1[0] + (rgb2[0] - rgb1[0]) * factor
        const g = rgb1[1] + (rgb2[1] - rgb1[1]) * factor
        const b = rgb1[2] + (rgb2[2] - rgb1[2]) * factor
        return rgbToHex(r, g, b)
    }
    
    const getConstructColor = (average: number | null): string => {
        if (average === null) {
            return '#F9FAFB' // Default background when no data
        }
        
        const lowColor = '#fdaeae'   // Red
        const midColor = '#FFFF99'   // Yellow
        const highColor = '#99FF99'  // Green
        const midpoint = 3
        
        // Assume rating scale is 1-5 (adjust if needed)
        const minValue = 1
        const maxValue = 5
        
        // Clamp average to valid range
        const clampedAverage = Math.max(minValue, Math.min(maxValue, average))
        
        if (clampedAverage <= midpoint) {
            // Interpolate between red and yellow
            const factor = (clampedAverage - minValue) / (midpoint - minValue)
            return interpolateColor(lowColor, midColor, factor)
        } else {
            // Interpolate between yellow and green
            const factor = (clampedAverage - midpoint) / (maxValue - midpoint)
            return interpolateColor(midColor, highColor, factor)
        }
    }
    
    const renderConstructs = (constructs: ConstructStat[], hasData: boolean) => {
        // Show "No survey responses yet" if no data or no constructs
        if (!hasData || constructs.length === 0) {
            return <div className='mood-no-data'>No survey responses yet</div>
        }
        
        // Filter out constructs that have no data (all null values)
        const constructsWithData = constructs.filter(c => 
            c.average !== null || c.min !== null || c.max !== null
        )
        
        if (constructsWithData.length === 0) {
            return <div className='mood-no-data'>No survey responses yet</div>
        }
        
        // Format construct name: remove underscores, capitalize first letter
        const formatConstructName = (name: string) => {
            return name
                .replace(/_/g, ' ')
                .split(' ')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                .join(' ')
        }
        
        return (
            <div className='mood-constructs-grid'>
                {constructs.map((construct) => {
                    const backgroundColor = getConstructColor(construct.average)
                    const formattedName = formatConstructName(construct.name)
                    return (
                        <div 
                            key={construct.name} 
                            className='mood-construct-item'
                            style={{ backgroundColor }}
                        >
                            <div className='mood-construct-name'>{formattedName}</div>
                            <div className='mood-construct-stats'>
                                <div className='mood-stat'>
                                    <span className='mood-stat-label'>Avg:</span>
                                    <span className='mood-stat-value'>{construct.average !== null ? construct.average.toFixed(1) : 'N/A'}</span>
                                </div>
                                <div className='mood-stat'>
                                    <span className='mood-stat-label'>Min:</span>
                                    <span className='mood-stat-value'>{construct.min !== null ? construct.min : 'N/A'}</span>
                                </div>
                                <div className='mood-stat'>
                                    <span className='mood-stat-label'>Max:</span>
                                    <span className='mood-stat-value'>{construct.max !== null ? construct.max : 'N/A'}</span>
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>
        )
    }
    
    // For admin users, show the surveys list
    if (isAdmin) {
        return (
            <div className='sjs-client-app__content--surveys-list'>
                <h1>{title}</h1>
                <Surveys/>
            </div>
        )
    }
    
    // For student users, show the mood tracking layout
    return (
        <div className='mood-home-wrapper'>
            <div className='mood-home-container'>
                <div className='mood-home-header'>
                    {firstSurvey && (
                        <Link to={`/run/${firstSurvey.id}`} className='fill-survey-button'>
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M2.5 5H17.5M2.5 10H17.5M2.5 15H17.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                            </svg>
                            <span>Fill Survey</span>
                        </Link>
                    )}
                    <h1 className='mood-title'>Overview</h1>
                </div>
                
                <div className='mood-cards-container'>
                    <div 
                        className='mood-card mood-card-clickable' 
                        onClick={() => handleCardClick('today')}
                    >
                        <h2 className='mood-card-title'>Mood today</h2>
                        <p className='mood-card-description'>
                            Your mood statistics for today{moodToday && moodToday.totalResponses > 0 ? `, based on ${moodToday.totalResponses} ${moodToday.totalResponses === 1 ? 'response' : 'responses'}` : ''}
                        </p>
                        <div className='mood-card-content'>
                            {loadingToday ? (
                                <div className='mood-loading'>Loading...</div>
                            ) : moodToday ? (
                                renderConstructs(moodToday.constructs, moodToday.hasData)
                            ) : (
                                <div className='mood-no-data'>No survey responses yet</div>
                            )}
                        </div>
                    </div>
                    
                    <div 
                        className='mood-card mood-card-clickable' 
                        onClick={() => handleCardClick('7days')}
                    >
                        <h2 className='mood-card-title'>Mood over the last 7 days</h2>
                        <p className='mood-card-description'>
                            Your mood statistics over the past week{mood7Days && mood7Days.totalResponses > 0 ? `, based on ${mood7Days.totalResponses} ${mood7Days.totalResponses === 1 ? 'response' : 'responses'}` : ''}
                        </p>
                        <div className='mood-card-content'>
                            {loading7Days ? (
                                <div className='mood-loading'>Loading...</div>
                            ) : mood7Days ? (
                                renderConstructs(mood7Days.constructs, mood7Days.hasData)
                            ) : (
                                <div className='mood-no-data'>No survey responses yet</div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default Home;