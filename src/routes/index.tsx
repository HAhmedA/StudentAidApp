import React, { useState } from 'react'
import { Route, NavLink, Routes } from 'react-router-dom'
import Home from "../pages/Home"
import Run from "../pages/Run"
import Edit from "../pages/Edit"
import Login from "../pages/Login"
import Register from "../pages/Register"
import Profile from "../pages/Profile"
import ScreenTimeForm from "../pages/ScreenTimeForm"
import SleepPage from "../pages/SleepPage"
import RequireAdmin from "../components/RequireAdmin"
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
                {user && <NavLink className='sjs-nav-button sjs-nav-button-gold' to="/" onClick={() => setMenuOpen(false)}><span>Home</span></NavLink>}
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
                                <NavLink className='sjs-nav-button sjs-nav-button-gold sjs-nav-button-grouped' to="/sleep" onClick={() => setMenuOpen(false)}><span>Sleep Log</span></NavLink>
                            )}
                            <NavLink className='sjs-nav-button sjs-nav-button-gold sjs-nav-button-grouped' to="/profile" onClick={() => setMenuOpen(false)}><span>Profile</span></NavLink>
                            <span className='sjs-nav-button sjs-nav-button-gold sjs-nav-button-grouped' onClick={() => { dispatch(logout()); setMenuOpen(false); }}><span>Logout</span></span>
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
            <Route path="/run/:id" element={<RequireAuth><Run /></RequireAuth>}></Route>
            <Route path="/edit/:id" element={<RequireAuth><RequireAdmin><Edit /></RequireAdmin></RequireAuth>}></Route>
            <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>}></Route>
            <Route path="/screen-time" element={<RequireAuth><ScreenTimeForm /></RequireAuth>}></Route>
            <Route path="/sleep" element={<RequireAuth><SleepPage /></RequireAuth>}></Route>
            <Route element={<NoMatch />}></Route>
        </Routes>
    </>
)

export default Content