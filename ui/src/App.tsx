import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import DashboardPage from './pages/DashboardPage'
import ProjectsPage from './pages/ProjectsPage'
import ProjectDetailPage from './pages/ProjectDetailPage'
import MissionDetailPage from './pages/MissionDetailPage'
import MissionReviewPage, { ObjectiveReviewPage } from './pages/MissionReviewPage'
import WorkersPage from './pages/WorkersPage'
import LogsPage from './pages/LogsPage'
import SettingsPage from './pages/SettingsPage'
import DocsPage from './pages/DocsPage'
import { ToastProvider } from './components/Toasts'

export default function App() {
  return (
    <ToastProvider>
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:id" element={<ProjectDetailPage />} />
        <Route path="/projects/:id/missions/:missionId" element={<MissionDetailPage />} />
        <Route path="/projects/:id/missions/:missionId/review" element={<MissionReviewPage />} />
        <Route path="/projects/:id/missions/:missionId/review/:taskId" element={<ObjectiveReviewPage />} />
        <Route path="/projects/:id/missions/:missionId/run" element={<MissionDetailPage />} />
        <Route path="/workers" element={<WorkersPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/docs" element={<DocsPage />} />
      </Routes>
    </Layout>
    </ToastProvider>
  )
}
