import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import axios from 'axios'
import { apiBaseAddress } from '../models/survey'

interface ProfileState {
    data: {
        user_id?: string
        edu_level: string
        field_of_study: string
        major: string
        learning_formats: string[] // JSONB array in DB
        disabilities: string[] // JSONB array in DB
        updated_at?: string
    } | null
    status: 'idle' | 'loading' | 'succeeded' | 'failed'
    error: string | null
}

const initialState: ProfileState = {
    data: null,
    status: 'idle',
    error: null
}

export const fetchProfile = createAsyncThunk('profile/fetchProfile', async () => {
    const response = await axios.get(apiBaseAddress + '/profile')
    // Ensure we handle the transformation from DB schema if needed,
    // but assuming the API returns the JSON directly.
    return response.data
})

export const updateProfile = createAsyncThunk('profile/updateProfile', async (profileData: any) => {
    const response = await axios.put(apiBaseAddress + '/profile', profileData)
    return response.data
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
            // Fetch
            .addCase(fetchProfile.pending, (state) => {
                state.status = 'loading'
            })
            .addCase(fetchProfile.fulfilled, (state, action) => {
                state.status = 'succeeded'
                // Map API response to state if necessary, assuming 1:1 for now based on request
                state.data = action.payload
            })
            .addCase(fetchProfile.rejected, (state, action) => {
                state.status = 'succeeded' // Don't show error for missing profile
                // Keep data as null (empty profile)
                state.error = null
            })
            // Update
            .addCase(updateProfile.pending, (state) => {
                state.status = 'loading'
            })
            .addCase(updateProfile.fulfilled, (state, action) => {
                state.status = 'succeeded'
                state.data = action.payload
            })
            .addCase(updateProfile.rejected, (state, action) => {
                state.status = 'failed'
                state.error = action.error.message || 'Failed to update profile'
            })
    }
})

export const { clearProfile } = profileSlice.actions
export default profileSlice.reducer
