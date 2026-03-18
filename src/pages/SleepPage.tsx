import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import SleepSlider from '../components/SleepSlider'
import './SleepPage.css'

const SleepPage = () => {
    useEffect(() => {
        const el = document.querySelector('.sjs-app__content')
        if (el) el.classList.add('mood-content-override')
        return () => { if (el) el.classList.remove('mood-content-override') }
    }, [])

    return (
        <div className='sleep-page'>
            <div className='sleep-page-container'>
                <Link to='/' className='sleep-page-back-btn'>
                    ← Back to Home
                </Link>
                <SleepSlider />
            </div>
        </div>
    )
}

export default SleepPage
