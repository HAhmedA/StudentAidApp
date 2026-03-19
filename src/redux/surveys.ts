import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
// axios with credentials configured in src/index.tsx
import axios from 'axios'
// All API calls use the shared base URL
import { API_BASE as apiBaseAddress, } from '../api/client'
import { ISurveyDefinition } from '../models/survey'

const initialState: { surveys: Array<ISurveyDefinition>, status: string, error: any } = {
  surveys: [],
  status: 'idle',
  error: null
}

const surveysSlice = createSlice({
  name: 'surveys',
  initialState,
  reducers: {},
  extraReducers(builder) {
    builder
      .addCase(load.pending, (state, action) => {
        state.status = 'loading'
      })
      .addCase(load.fulfilled, (state, action) => {
        if (state.status === 'loading') {
          state.status = 'succeeded'
          // Add any fetched surveys to the array
          state.surveys = state.surveys.concat(action.payload)
        }
      })
      .addCase(load.rejected, (state, action) => {
        state.status = 'failed'
        state.error = action.error.message
      })
  }
})

export const load = createAsyncThunk('surveys/load', async () => {
  const response = await axios.get(apiBaseAddress + '/getActive')
  return response.data
})

export default surveysSlice.reducer
