import { combineReducers } from '@reduxjs/toolkit'
import surveysReducer from './surveys'
import authReducer from './auth'
import adminReducer from './admin'

const rootReducer = combineReducers({
    surveys: surveysReducer,
    auth: authReducer,
    admin: adminReducer,
})

export default rootReducer
