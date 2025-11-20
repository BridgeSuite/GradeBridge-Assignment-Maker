import React from 'react';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Editor from './pages/Editor';
import Preview from './components/Preview';
import { PrivacyNotice } from './components/PrivacyNotice';

const App: React.FC = () => {
  return (
    <>
      <PrivacyNotice />
      <Router>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/create" element={<Editor />} />
          <Route path="/edit/:id" element={<Editor />} />
          <Route path="/view/:id" element={<Preview />} />
        </Routes>
      </Router>
    </>
  );
};

export default App;