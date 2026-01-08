import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import axios from 'axios'
import { apiBaseAddress } from '../models/survey'

interface AdminState {
    systemPrompt: string
    lastUpdated: string | null
    status: 'idle' | 'loading' | 'succeeded' | 'failed'
    error: string | null
}

const initialState: AdminState = {
    systemPrompt: 'Be Ethical',
    lastUpdated: null,
    status: 'idle',
    error: null
}

export const fetchSystemPrompt = createAsyncThunk('admin/fetchSystemPrompt', async () => {
    const response = await axios.get(apiBaseAddress + '/admin/system-prompt')
    return response.data
})

export const updateSystemPrompt = createAsyncThunk('admin/updateSystemPrompt', async (prompt: string) => {
    const response = await axios.put(apiBaseAddress + '/admin/system-prompt', { prompt })
    return response.data
})

const adminSlice = createSlice({
    name: 'admin',
    initialState,
    reducers: {},
    extraReducers: (builder) => {
        builder
            // Fetch
            .addCase(fetchSystemPrompt.pending, (state) => {
                state.status = 'loading'
            })
            .addCase(fetchSystemPrompt.fulfilled, (state, action) => {
                state.status = 'succeeded'
                state.systemPrompt = action.payload.prompt || 'Be Ethical'
                state.lastUpdated = action.payload.updated_at
            })
            .addCase(fetchSystemPrompt.rejected, (state, action) => {
                state.status = 'succeeded' // Don't show error, just use default
                // Keep the default "Be Ethical" value
                state.error = null
            })
            // Update
            .addCase(updateSystemPrompt.pending, (state) => {
                state.status = 'loading'
            })
            .addCase(updateSystemPrompt.fulfilled, (state, action) => {
                state.status = 'succeeded'
                state.systemPrompt = action.payload.prompt
                state.lastUpdated = action.payload.updated_at
            })
            .addCase(updateSystemPrompt.rejected, (state, action) => {
                state.status = 'failed'
                state.error = action.error.message || 'Failed to update system prompt'
            })
    }
})

export default adminSlice.reducer
