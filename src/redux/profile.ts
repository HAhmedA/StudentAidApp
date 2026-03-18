import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import { api, ApiError } from '../api/client'

interface ProfileData {
    user_id?: string
    onboarding_completed?: boolean
    updated_at?: string
}

interface ProfileState {
    data: ProfileData | null
    status: 'idle' | 'loading' | 'succeeded' | 'failed'
    error: string | null
}

const initialState: ProfileState = {
    data: null,
    status: 'idle',
    error: null
}

export const fetchProfile = createAsyncThunk('profile/fetchProfile', async (_, { rejectWithValue }) => {
    try {
        return await api.get<ProfileData>('/profile')
    } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
            return null as ProfileData | null // Profile doesn't exist yet — not an error
        }
        return rejectWithValue(err instanceof Error ? err.message : 'Failed to fetch profile')
    }
})

const profileSlice = createSlice({
    name: 'profile',
    initialState,
    reducers: {
        clearProfile: (state) => {
            state.data = null
            state.status = 'idle'
            state.error = null
        }
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchProfile.pending, (state) => {
                state.status = 'loading'
            })
            .addCase(fetchProfile.fulfilled, (state, action) => {
                state.status = 'succeeded'
                state.data = action.payload
            })
            .addCase(fetchProfile.rejected, (state, action) => {
                state.status = 'failed'
                state.error = (action.payload as string) || action.error.message || 'Failed to fetch profile'
            })
    }
})

export const { clearProfile } = profileSlice.actions
export default profileSlice.reducer
