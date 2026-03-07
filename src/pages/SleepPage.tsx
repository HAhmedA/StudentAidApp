import { Link } from 'react-router-dom'
import SleepSlider from '../components/SleepSlider'
import './SleepPage.css'

const SleepPage = () => {
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
