import React from 'react'
import axios from 'axios'
import { apiBaseAddress } from '../models/survey'
import './Dashboard.css'

interface DashboardData {
  surveyId: string
  surveyName: string
  totalSubmissions: number
  questions: Array<{
    questionName: string
    questionTitle: string
    questionType: string
    totalResponses: number
    responseRate: number
    totalSubmissions: number
    average?: number
    min?: number
    max?: number
    distribution?: Record<number, number>
    choiceCounts?: Record<string, number>
    allResponses?: any[]
    uniqueResponses?: string[]
  }>
}

interface DashboardProps {
  surveyId: string
}

const Dashboard: React.FC<DashboardProps> = ({ surveyId }) => {
  const [data, setData] = React.useState<DashboardData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    const fetchDashboard = async () => {
      try {
        setLoading(true)
        const response = await axios.get(`${apiBaseAddress}/results/dashboard/${surveyId}`)
        setData(response.data)
        setError(null)
      } catch (err: any) {
        setError(err.response?.data?.error || 'Failed to load dashboard data')
        console.error('Dashboard fetch error:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchDashboard()
  }, [surveyId])

  if (loading) {
    return <div className="dashboard-loading">Loading dashboard...</div>
  }

  if (error) {
    return <div className="dashboard-error">Error: {error}</div>
  }

  if (!data || data.questions.length === 0) {
    return (
      <div className="dashboard-empty">
        <p>No responses yet for this survey.</p>
        <p>Once students start filling out the survey, aggregated results will appear here.</p>
      </div>
    )
  }

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h2>{data.surveyName} - Results Dashboard</h2>
        <div className="dashboard-stats">
          <div className="stat-card">
            <div className="stat-value">{data.totalSubmissions}</div>
            <div className="stat-label">Total Submissions</div>
          </div>
        </div>
      </div>

      <div className="dashboard-questions">
        {data.questions.map((question, idx) => (
          <div key={question.questionName || idx} className="question-card">
            <div className="question-header">
              <h3 className="question-title">{idx + 1}. {question.questionTitle}</h3>
              <div className="question-meta">
                <span className="question-type">{question.questionType}</span>
                <span className="response-count">
                  {question.totalResponses} / {question.totalSubmissions} responses ({question.responseRate}%)
                </span>
              </div>
            </div>

            <div className="question-content">
              {question.questionType === 'rating' && question.average !== undefined && (
                <div className="rating-summary">
                  <div className="rating-stats">
                    <div className="rating-stat">
                      <span className="stat-label">Average</span>
                      <span className="stat-value-large">{question.average}</span>
                    </div>
                    <div className="rating-stat">
                      <span className="stat-label">Min</span>
                      <span className="stat-value">{question.min}</span>
                    </div>
                    <div className="rating-stat">
                      <span className="stat-label">Max</span>
                      <span className="stat-value">{question.max}</span>
                    </div>
                  </div>
                  {question.distribution && (
                    <div className="rating-distribution">
                      <h4>Distribution</h4>
                      <div className="distribution-bars">
                        {Object.entries(question.distribution)
                          .sort(([a], [b]) => Number(a) - Number(b))
                          .map(([rating, count]) => {
                            const percentage = (count / question.totalResponses) * 100
                            return (
                              <div key={rating} className="distribution-item">
                                <div className="distribution-label">{rating}</div>
                                <div className="distribution-bar-container">
                                  <div
                                    className="distribution-bar"
                                    style={{ width: `${percentage}%` }}
                                  >
                                    <span className="distribution-count">{count}</span>
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {(question.questionType === 'radiogroup' || question.questionType === 'dropdown' || question.questionType === 'checkbox') && question.choiceCounts && (
                <div className="choice-summary">
                  <div className="choice-list">
                    {Object.entries(question.choiceCounts)
                      .sort(([, a], [, b]) => b - a)
                      .map(([choice, count]) => {
                        const percentage = (count / question.totalResponses) * 100
                        return (
                          <div key={choice} className="choice-item">
                            <div className="choice-label">{choice}</div>
                            <div className="choice-bar-container">
                              <div
                                className="choice-bar"
                                style={{ width: `${percentage}%` }}
                              >
                                <span className="choice-count">{count}</span>
                              </div>
                            </div>
                            <div className="choice-percentage">{Math.round(percentage)}%</div>
                          </div>
                        )
                      })}
                  </div>
                </div>
              )}

              {(question.questionType === 'text' || question.questionType === 'comment') && question.allResponses && (
                <div className="text-summary">
                  <div className="text-responses">
                    {question.allResponses.length > 0 ? (
                      <ul className="response-list">
                        {question.allResponses.map((response, idx) => (
                          <li key={idx} className="response-item">{String(response)}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="no-responses">No text responses</p>
                    )}
                  </div>
                </div>
              )}

              {question.questionType !== 'rating' && 
               question.questionType !== 'radiogroup' && 
               question.questionType !== 'dropdown' && 
               question.questionType !== 'checkbox' && 
               question.questionType !== 'text' && 
               question.questionType !== 'comment' && 
               question.allResponses && (
                <div className="generic-summary">
                  <div className="responses-list">
                    {question.allResponses.map((response, idx) => (
                      <div key={idx} className="response-badge">{String(response)}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default Dashboard

