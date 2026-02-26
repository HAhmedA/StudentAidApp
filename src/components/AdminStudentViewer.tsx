import { useEffect, useState } from 'react'

const API_BASE = '/api'

interface StudentInfo { id: string; name: string; email: string }

interface Props {
    onStudentSelect: (studentId: string, studentName: string) => void
    selectedStudentId: string
}

const AdminStudentViewer = ({ onStudentSelect, selectedStudentId }: Props) => {
    const [students, setStudents] = useState<StudentInfo[]>([])
    const [studentsLoading, setStudentsLoading] = useState(false)

    useEffect(() => {
        setStudentsLoading(true)
        fetch(`${API_BASE}/admin/students`, { credentials: 'include' })
            .then(res => res.json())
            .then(data => {
                if (data.students) {
                    setStudents(data.students)
                }
                setStudentsLoading(false)
            })
            .catch(() => setStudentsLoading(false))
    }, [])

    const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const id = e.target.value
        const student = students.find(s => s.id === id)
        onStudentSelect(id, student?.name ?? '')
    }

    return (
        <div className='admin-student-selector'>
            <div className='admin-selector-header'>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                <h2>View Student Dashboard</h2>
            </div>
            <p className='admin-selector-description'>Select a student to view their performance dashboard</p>
            <select
                className='admin-student-select'
                value={selectedStudentId}
                onChange={handleChange}
            >
                <option value=''>— Select a student —</option>
                {studentsLoading ? (
                    <option disabled>Loading...</option>
                ) : (
                    students.map(s => (
                        <option key={s.id} value={s.id}>{s.name} ({s.email})</option>
                    ))
                )}
            </select>
        </div>
    )
}

export default AdminStudentViewer
