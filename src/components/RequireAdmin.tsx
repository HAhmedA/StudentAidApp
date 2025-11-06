import React from 'react'
import { useReduxSelector } from '../redux'

const RequireAdmin: React.FC<{ children: React.ReactElement }> = ({ children }) => {
    const user = useReduxSelector(state => state.auth.user)
    // Check if user is admin by email (admin@example.com) or legacy role
    const isAdmin = user?.role === 'admin' || user?.email === 'admin@example.com'
    if (!isAdmin) {
        return <h1>403 - Admins only</h1>
    }
    return children
}

export default RequireAdmin


