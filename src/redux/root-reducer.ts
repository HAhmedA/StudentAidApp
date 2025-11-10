import { combineReducers } from '@reduxjs/toolkit'
import surveysReducer from './surveys'
import authReducer from './auth'

const rootReducer = combineReducers({
    surveys: surveysReducer,
    auth: authReducer,
})

export default rootReducer