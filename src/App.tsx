import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { ErrorBoundary, RequireAuth, RequireRole, RoleHome } from './components/guards';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import LoginPage from './pages/LoginPage';
import StudentDashboard from './pages/StudentDashboard';
import NewRequestPage from './pages/NewRequestPage';
import MyRequestsPage from './pages/MyRequestsPage';
import RequestDetailPage from './pages/RequestDetailPage';
import ReentryPage from './pages/ReentryPage';
import PassPage from './pages/PassPage';
import NotificationsPage from './pages/NotificationsPage';
import ProfilePage from './pages/ProfilePage';
import AbsencePage from './pages/AbsencePage';
import { ApprovalsPage, DecisionHistoryPage } from './pages/ApprovalsPage';
import { AccessDeniedPage, NotFoundPage } from './pages/StatusPages';
import { AdminOverview, AdminPolicies, AdminReports, AdminUsers } from './pages/AdminPages';

// The gate page pulls in the camera library, so it loads on demand.
const GatePage = lazy(() => import('./pages/GatePage'));

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<RequireAuth />}>
                <Route element={<Layout />}>
                  <Route index element={<RoleHome />} />
                  <Route element={<RequireRole roles={['student']} />}>
                    <Route path="dashboard" element={<StudentDashboard />} />
                    <Route path="requests" element={<MyRequestsPage />} />
                    <Route path="requests/new" element={<NewRequestPage />} />
                    <Route path="requests/:id/pass" element={<PassPage />} />
                    <Route path="requests/:id/reentry" element={<ReentryPage />} />
                  </Route>
                  <Route element={<RequireRole roles={['student', 'program_manager', 'swo', 'admin']} />}>
                    <Route path="requests/:id" element={<RequestDetailPage />} />
                  </Route>
                  <Route element={<RequireRole roles={['program_manager', 'swo']} />}>
                    <Route path="approvals" element={<ApprovalsPage />} />
                    <Route path="approvals/history" element={<DecisionHistoryPage />} />
                  </Route>
                  <Route element={<RequireRole roles={['program_manager', 'swo', 'admin']} />}>
                    <Route path="absence" element={<AbsencePage />} />
                  </Route>
                  <Route element={<RequireRole roles={['security']} />}>
                    <Route path="gate" element={<Suspense fallback={<Spinner />}><GatePage /></Suspense>} />
                  </Route>
                  <Route element={<RequireRole roles={['admin']} />}>
                    <Route path="admin" element={<AdminOverview />} />
                    <Route path="admin/users" element={<AdminUsers />} />
                    <Route path="admin/reports" element={<AdminReports />} />
                    <Route path="admin/policies" element={<AdminPolicies />} />
                  </Route>
                  <Route path="notifications" element={<NotificationsPage />} />
                  <Route path="profile" element={<ProfilePage />} />
                  <Route path="access-denied" element={<AccessDeniedPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
