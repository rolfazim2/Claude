import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';
import { Login } from './pages/Login';
import { MyTasks } from './pages/MyTasks';
import { Inbox } from './pages/Inbox';
import { BoardPage } from './pages/BoardPage';
import { Scheme } from './pages/Scheme';
import { Reports } from './pages/Reports';
import { CalendarPage } from './pages/CalendarPage';
import { PaymentsPage } from './pages/PaymentsPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route element={<AppLayout />}>
        <Route path="/my" element={<MyTasks />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/board/:projectId" element={<BoardPage />} />
        <Route path="/scheme" element={<Scheme />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/payments" element={<PaymentsPage />} />
        <Route path="/reports" element={<Reports />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
