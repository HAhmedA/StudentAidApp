import React, { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useReduxDispatch, useReduxSelector } from '../redux'
import { loginEmailPassword, me } from '../redux/auth'
import './Login.css'

const Login = (): React.ReactElement => {
    const dispatch = useReduxDispatch()
    const navigate = useNavigate()
    const user = useReduxSelector(state => state.auth.user)
    const status = useReduxSelector(state => state.auth.status)
    const error = useReduxSelector(state => state.auth.error)

    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [keepLoggedIn, setKeepLoggedIn] = useState(false)
    const [localError, setLocalError] = useState<string | null>(null)

    useEffect(() => {
        // If already logged in, redirect to home
        if (user) {
            navigate('/')
        }
    }, [user, navigate])

    useEffect(() => {
        // Check if user is already logged in
        dispatch(me())
    }, [dispatch])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLocalError(null)

        if (!email || !password) {
            setLocalError('Please enter both email and password')
            return
        }

        try {
            await dispatch(loginEmailPassword({ email, password })).unwrap()
            navigate('/')
        } catch (err: any) {
            // The error from rejectWithValue is the payload itself (a string)
            const errorMessage = typeof err === 'string' ? err : (err?.message || err?.response?.data?.error || 'Invalid email or password')
            setLocalError(errorMessage)
        }
    }

    const displayError = localError || error

    return (
        <div className="login-container">
            <div className="login-card">
                <div className="login-header">
                    <h1 className="login-title">AIEDAI</h1>
                    <p className="login-tagline">Learn with <strong>AI ED</strong>ucation <strong>AI</strong></p>
                </div>

                <form onSubmit={handleSubmit} className="login-form">
                    <div className="form-group">
                        <label htmlFor="email">Email</label>
                        <input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="Enter your email"
                            required
                            disabled={status === 'loading'}
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="password">Password</label>
                        <input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter your password"
                            required
                            disabled={status === 'loading'}
                        />
                    </div>

                    <div className="form-group checkbox-group">
                        <input
                            id="keepLoggedIn"
                            type="checkbox"
                            checked={keepLoggedIn}
                            onChange={(e) => setKeepLoggedIn(e.target.checked)}
                            disabled={status === 'loading'}
                        />
                        <label htmlFor="keepLoggedIn">Keep me logged in for 30 days</label>
                    </div>

                    {displayError && (
                        <div className="error-message">{displayError}</div>
                    )}

                    <button
                        type="submit"
                        className="login-button"
                        disabled={status === 'loading'}
                    >
                        {status === 'loading' ? 'Logging in...' : 'Login'}
                    </button>
                </form>

                <div className="login-footer">
                    <p>
                        Don't have an account? <Link to="/register" className="register-link">Register here</Link>
                    </p>
                    <p className="password-reset-text">
                        Need password reset? Contact an administrator.
                    </p>
                </div>
            </div>
        </div>
    )
}

export default Login
