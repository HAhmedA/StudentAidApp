import React, { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useReduxDispatch, useReduxSelector } from '../redux'
import { register, me } from '../redux/auth'
import './Login.css' // Reuse the same styles

const Register = (): React.ReactElement => {
    const dispatch = useReduxDispatch()
    const navigate = useNavigate()
    const user = useReduxSelector(state => state.auth.user)
    const status = useReduxSelector(state => state.auth.status)
    const error = useReduxSelector(state => state.auth.error)

    const [name, setName] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
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

        if (!name || !email || !password || !confirmPassword) {
            setLocalError('Please fill in all fields')
            return
        }

        if (password !== confirmPassword) {
            setLocalError('Passwords do not match')
            return
        }

        if (password.length < 8) {
            setLocalError('Password must be at least 8 characters long')
            return
        }

        try {
            await dispatch(register({ name, email, password })).unwrap()
            navigate('/')
        } catch (err: any) {
            setLocalError(err?.message || 'Registration failed. Email may already be in use.')
        }
    }

    const displayError = localError || error

    return (
        <div className="login-container">
            <div className="login-card">
                <div className="login-header">
                    <h1 className="login-title">LAILA</h1>
                    <p className="login-tagline">Learn with <strong>AI LA</strong>boratory</p>
                </div>

                <form onSubmit={handleSubmit} className="login-form">
                    <div className="form-group">
                        <label htmlFor="name">Name</label>
                        <input
                            id="name"
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Enter your name"
                            required
                            disabled={status === 'loading'}
                        />
                    </div>

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
                            placeholder="Enter your password (min. 8 characters)"
                            required
                            disabled={status === 'loading'}
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="confirmPassword">Confirm Password</label>
                        <input
                            id="confirmPassword"
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="Confirm your password"
                            required
                            disabled={status === 'loading'}
                        />
                    </div>

                    {displayError && (
                        <div className="error-message">{displayError}</div>
                    )}

                    <button
                        type="submit"
                        className="login-button"
                        disabled={status === 'loading'}
                    >
                        {status === 'loading' ? 'Registering...' : 'Register'}
                    </button>
                </form>

                <div className="login-footer">
                    <p>
                        Already have an account? <Link to="/login" className="register-link">Login here</Link>
                    </p>
                </div>
            </div>
        </div>
    )
}

export default Register

