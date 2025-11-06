import Surveys from '../components/Surveys'
import { useReduxSelector } from '../redux'

const Home = () => {
    const user = useReduxSelector(state => state.auth.user)
    const isAdmin = user?.role === 'admin' || user?.email === 'admin@example.com'
    const title = isAdmin ? 'My Surveys' : 'Available Surveys'
    
    return (
        <div className='sjs-client-app__content--surveys-list'>
            <h1>{title}</h1>
            <Surveys/>
        </div>
    )
}

export default Home;