export interface AdminTab {
    id: string
    label: string
    badge?: number
}

interface Props {
    tabs: AdminTab[]
    activeTab: string
    onTabChange: (id: string) => void
}

const AdminTabNav = ({ tabs, activeTab, onTabChange }: Props) => (
    <nav className='admin-tab-nav'>
        {tabs.map(tab => (
            <button
                key={tab.id}
                className={`admin-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => onTabChange(tab.id)}
            >
                {tab.label}
                {!!tab.badge && tab.badge > 0 && (
                    <span className='admin-tab-badge'>{tab.badge}</span>
                )}
            </button>
        ))}
    </nav>
)

export default AdminTabNav
