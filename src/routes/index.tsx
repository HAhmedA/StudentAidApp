import React, { useState } from 'react'
import { Route, NavLink, Routes } from 'react-router-dom'
import Home from "../pages/Home"
import Run from "../pages/Run"
import Login from "../pages/Login"
import Register from "../pages/Register"
import Profile from "../pages/Profile"
import ScreenTimeForm from "../pages/ScreenTimeForm"
import SleepPage from "../pages/SleepPage"
import RequireAuth from "../components/RequireAuth"
import { useReduxDispatch, useReduxSelector } from '../redux'
import { logout } from '../redux/auth'

export const NavBar = () => {
    const user = useReduxSelector(state => state.auth.user)
    const dispatch = useReduxDispatch()
    const [menuOpen, setMenuOpen] = useState(false)
    return (
        <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
                {user && (
                    <NavLink className='sjs-nav-button sjs-nav-button-gold sjs-nav-btn--home' to="/" onClick={() => setMenuOpen(false)}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
                            <path d="M3 9.5L12 3L21 9.5V20C21 20.55 20.55 21 20 21H15V15H9V21H4C3.45 21 3 20.55 3 20V9.5Z" fill="currentColor"/>
                        </svg>
                        <span>Home</span>
                    </NavLink>
                )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
                {user && (
                    <>
                        <button
                            className={`sjs-hamburger${menuOpen ? ' sjs-hamburger--open' : ''}`}
                            aria-label="Toggle navigation menu"
                            aria-expanded={menuOpen}
                            onClick={() => setMenuOpen(o => !o)}
                        >
                            <span />
                            <span />
                            <span />
                        </button>
                        <div className={`sjs-nav-links${menuOpen ? ' sjs-nav-links--open' : ''}`}>
                            {user?.role !== 'admin' && (
                                <span
                                    className='sjs-nav-button sjs-nav-button-gold sjs-nav-button-grouped sjs-nav-btn--chat'
                                    onClick={() => { window.dispatchEvent(new CustomEvent('chatbot:open')); setMenuOpen(false) }}
                                    style={{ cursor: 'pointer' }}
                                >
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
                                        <path d="M20 2H4C2.9 2 2 2.9 2 4V22L6 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2ZM13 11H7V9H13V11ZM17 7H7V5H17V7Z" fill="currentColor"/>
                                    </svg>
                                    <span>Chat about my data</span>
                                </span>
                            )}
                            <NavLink className='sjs-nav-button sjs-nav-button-gold sjs-nav-button-grouped sjs-nav-btn--profile' to="/profile" onClick={() => setMenuOpen(false)}>
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
                                    <path d="M12 12C14.21 12 16 10.21 16 8C16 5.79 14.21 4 12 4C9.79 4 8 5.79 8 8C8 10.21 9.79 12 12 12ZM12 14C9.33 14 4 15.34 4 18V20H20V18C20 15.34 14.67 14 12 14Z" fill="currentColor"/>
                                </svg>
                                <span>Profile</span>
                            </NavLink>
                            {!user?.moodleUser && (
                                <span className='sjs-nav-button sjs-nav-button-gold sjs-nav-button-grouped sjs-nav-btn--logout' onClick={() => { dispatch(logout()); setMenuOpen(false); }} style={{ cursor: 'pointer' }}>
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
                                        <path d="M17 7L15.59 8.41L18.17 11H8V13H18.17L15.59 15.58L17 17L22 12L17 7ZM4 5H12V3H4C2.9 3 2 3.9 2 5V19C2 20.1 2.9 21 4 21H12V19H4V5Z" fill="currentColor"/>
                                    </svg>
                                    <span>Logout</span>
                                </span>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}

const NoMatch = () => (<><h1>404</h1></>)

const Content = (): React.ReactElement => (
    <>
        <Routes>
            <Route path="/login" element={<Login />}></Route>
            <Route path="/register" element={<Register />}></Route>
            <Route path="/" element={<RequireAuth><Home /></RequireAuth>}></Route>
            <Route path="/questionnaire" element={<RequireAuth><Run /></RequireAuth>}></Route>
            <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>}></Route>
            <Route path="/screen-time" element={<RequireAuth><ScreenTimeForm /></RequireAuth>}></Route>
            <Route path="/sleep" element={<RequireAuth><SleepPage /></RequireAuth>}></Route>
            <Route element={<NoMatch />}></Route>
        </Routes>
    </>
)

export default Content