import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { LanguageProvider, useLanguage } from './LanguageContext';
import { translations, type LanguageCode } from './i18n';
import SubmitPage from './pages/SubmitPage';
import DashboardPage from './pages/DashboardPage';
import DeadLettersPage from './pages/DeadLettersPage';

function TopNav() {
  const { language, setLanguage } = useLanguage();
  const t = translations[language];

  return (
    <header style={{ 
      backgroundColor: 'var(--color-primary)', 
      color: 'white',
      padding: 'var(--spacing-md)',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    }}>
      <div style={{ display: 'flex', gap: 'var(--spacing-md)', alignItems: 'center' }}>
        <Link to="/" style={{ color: 'white', fontWeight: 'bold', fontSize: '1.25rem' }}>{t.appTitle}</Link>
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
          <Link to="/dashboard" style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.9rem' }}>Dashboard</Link>
          <Link to="/deadletters" style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.9rem' }}>Admin</Link>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
        {(['te', 'hi', 'en'] as LanguageCode[]).map(code => (
          <button 
            key={code}
            onClick={() => setLanguage(code)}
            style={{
              padding: '4px 8px',
              borderRadius: '4px',
              backgroundColor: language === code ? 'rgba(255,255,255,0.2)' : 'transparent',
              color: 'white',
              textTransform: 'uppercase',
              fontSize: '0.8rem',
              fontWeight: 'bold'
            }}
          >
            {code}
          </button>
        ))}
      </div>
    </header>
  );
}

function App() {
  return (
    <LanguageProvider>
      <BrowserRouter>
        <div id="app-container" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
          <TopNav />
          <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <Routes>
              <Route path="/" element={<SubmitPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/deadletters" element={<DeadLettersPage />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </LanguageProvider>
  );
}

export default App;
