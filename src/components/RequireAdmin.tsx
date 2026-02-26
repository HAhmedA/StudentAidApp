import React from 'react'
import { useReduxSelector } from '../redux'

const RequireAdmin: React.FC<{ children: React.ReactElement }> = ({ children }) => {
    const user = useReduxSelector(state => state.auth.user)
    const isAdmin = user?.role === 'admin'
    if (!isAdmin) {
        return <h1>403 - Admins only</h1>
    }
    return children
}

export default RequireAdmin


