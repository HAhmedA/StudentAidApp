import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useReduxSelector } from '../redux'

const RequireAuth: React.FC<{ children: React.ReactElement }> = ({ children }) => {
    const user = useReduxSelector(state => state.auth.user)
    const status = useReduxSelector(state => state.auth.status)
    const location = useLocation()

    // Auth check in flight — show loading indicator
    if (status === 'idle' || status === 'loading') {
        return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
            <div>Loading...</div>
        </div>
    }

    if (!user) {
        return <Navigate to="/login" state={{ from: location }} replace />
    }
    return children
}

export default RequireAuth


