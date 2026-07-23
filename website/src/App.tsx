import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import SiteLayout from '@/components/site/SiteLayout';
import HomePage from '@/pages/HomePage';
import AboutPage from '@/pages/AboutPage';
import TeamPage from '@/pages/TeamPage';
import FaqPage from '@/pages/FaqPage';
import DocsPage from '@/pages/DocsPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<SiteLayout />}>
          <Route index element={<HomePage />} />
          <Route path="about" element={<AboutPage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="faq" element={<FaqPage />} />
          <Route path="docs" element={<DocsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
