import { combineReducers } from '@reduxjs/toolkit'
import surveysReducer from './surveys'
import authReducer from './auth'
import profileReducer from './profile'
import adminReducer from './admin'

const rootReducer = combineReducers({
    surveys: surveysReducer,
    auth: authReducer,
    profile: profileReducer,
    admin: adminReducer,
})

export default rootReducer