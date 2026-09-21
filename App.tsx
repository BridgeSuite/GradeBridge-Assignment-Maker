import React from 'react';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Editor from './pages/Editor';
import Preview from './components/Preview';
import { PrivacyNotice } from './components/PrivacyNotice';
import { HelpProvider } from './components/HelpGuide';

const App: React.FC = () => {
  return (
    <>
      <PrivacyNotice />
      {/* Above the router, so Help opens from every page and from controls
          inside a page alike. */}
      <HelpProvider>
        <Router>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/create" element={<Editor />} />
            <Route path="/edit/:id" element={<Editor />} />
            <Route path="/view/:id" element={<Preview />} />
          </Routes>
        </Router>
      </HelpProvider>
    </>
  );
};

export default App;