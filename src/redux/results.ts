import { createAsyncThunk } from '@reduxjs/toolkit'
// axios with credentials configured in src/index.tsx
import axios from 'axios'
import { API_BASE as apiBaseAddress } from '../api/client'

export const post = createAsyncThunk('results/post', async (data: { postId: string, surveyResult: any, surveyResultText: string }) => {
  // Persist a survey result; backend stores the JSON payload in public.questionnaire_results
  const response = await axios.post(apiBaseAddress + '/post', data);
  return response.data
})
