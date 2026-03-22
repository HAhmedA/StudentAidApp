import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'
import { api, ApiError } from '../api/client'

export type UserRole = 'admin' | 'student'

export interface AuthUser {
    id: string
    email: string
    name: string
    role?: UserRole // Optional for backwards compatibility
    moodleUser?: boolean
}

interface AuthState {
    user: AuthUser | null
    status: 'idle' | 'loading' | 'succeeded' | 'failed'
    error?: string | null
}

const initialState: AuthState = {
    user: null,
    status: 'idle',
    error: null
}

// Legacy role-based login (for backwards compatibility)
export const login = createAsyncThunk('auth/login', async (role: UserRole) => {
    return await api.post<AuthUser>('/auth/legacy-login', { role })
})

// Email/password login
export const loginEmailPassword = createAsyncThunk(
    'auth/loginEmailPassword',
    async ({ email, password }: { email: string; password: string }, { rejectWithValue }) => {
        try {
            return await api.post<AuthUser>('/auth/login', { email, password })
        } catch (err) {
            if (err instanceof ApiError) return rejectWithValue(err.message || 'Login failed')
            return rejectWithValue('Login failed')
        }
    }
)

// Registration
export const register = createAsyncThunk(
    'auth/register',
    async ({ name, email, password }: { name: string; email: string; password: string }, { rejectWithValue }) => {
        try {
            return await api.post<AuthUser>('/auth/register', { name, email, password })
        } catch (err) {
            if (err instanceof ApiError) return rejectWithValue(err.message || 'Registration failed')
            return rejectWithValue('Registration failed')
        }
    }
)

export const me = createAsyncThunk('auth/me', async () => {
    return await api.get<AuthUser | null>('/me')
})

export const logout = createAsyncThunk('auth/logout', async () => {
    await api.post('/logout', {})
    return null
})

const authSlice = createSlice({
    name: 'auth',
    initialState,
    reducers: {
        setUser(state, action: PayloadAction<AuthUser | null>) {
            state.user = action.payload
        }
    },
    extraReducers(builder) {
        builder
            .addCase(login.pending, (state) => { state.status = 'loading'; state.error = null })
            .addCase(login.fulfilled, (state, action) => { state.status = 'succeeded'; state.user = action.payload; state.error = null })
            .addCase(login.rejected, (state, action) => { state.status = 'failed'; state.error = action.error.message || null })
            .addCase(loginEmailPassword.pending, (state) => { state.status = 'loading'; state.error = null })
            .addCase(loginEmailPassword.fulfilled, (state, action) => { state.status = 'succeeded'; state.user = action.payload; state.error = null })
            .addCase(loginEmailPassword.rejected, (state, action) => { state.status = 'failed'; state.error = action.payload as string || 'Login failed' })
            .addCase(register.pending, (state) => { state.status = 'loading'; state.error = null })
            .addCase(register.fulfilled, (state, action) => { state.status = 'succeeded'; state.user = action.payload; state.error = null })
            .addCase(register.rejected, (state, action) => { state.status = 'failed'; state.error = action.payload as string || 'Registration failed' })
            .addCase(me.pending, (state) => { state.status = 'loading' })
            .addCase(me.fulfilled, (state, action) => { state.status = 'succeeded'; state.user = action.payload })
            .addCase(me.rejected, (state) => { state.status = 'failed' })
            .addCase(logout.fulfilled, (state) => { state.user = null; state.status = 'succeeded'; state.error = null })
    }
})

export const { setUser } = authSlice.actions
export default authSlice.reducer


