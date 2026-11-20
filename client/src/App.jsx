/**
 * React Frontend Entry Point (client/src/App.jsx)
 * Bilingual Kurdish Sorani (RTL) & English (LTR) Library System
 */

import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import BookCatalog from './components/BookCatalog';
import MyLoans from './components/MyLoans';
import RulesGuide from './components/RulesGuide';
import AdminDashboard from './components/AdminDashboard';
import SignInModal from './components/SignInModal';
import BookDetailsModal from './components/BookDetailsModal';
import { translations, getTranslation } from './i18n';

export default function App() {
  const [currentView, setCurrentView] = useState('catalog');
  const [language, setLanguage] = useState(localStorage.getItem('library_lang') || 'ckb');
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('library_user') || 'null'));
  const [showSignInModal, setShowSignInModal] = useState(false);
  const [selectedBookId, setSelectedBookId] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    const isRtl = language === 'ckb';
    document.documentElement.setAttribute('lang', isRtl ? 'ckb' : 'en');
    document.documentElement.setAttribute('dir', isRtl ? 'rtl' : 'ltr');
    document.body.className = isRtl ? 'lang-ckb rtl' : 'lang-en ltr';
    localStorage.setItem('library_lang', language);
  }, [language]);

  const showNotification = (message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const handleSignOut = () => {
    localStorage.removeItem('library_token');
    localStorage.removeItem('library_user');
    setUser(null);
    setCurrentView('catalog');
    showNotification(language === 'ckb' ? 'بە سەرکەوتوویی دەرچوویت' : 'Signed out successfully');
  };

  return (
    <div className="app-root">
      <Header 
        currentView={currentView}
        setCurrentView={setCurrentView}
        language={language}
        setLanguage={setLanguage}
        user={user}
        onOpenSignIn={() => setShowSignInModal(true)}
        onSignOut={handleSignOut}
      />

      <main>
        {currentView === 'catalog' && (
          <BookCatalog 
            user={user}
            language={language}
            onOpenBookDetails={(id) => setSelectedBookId(id)}
            onRequireSignIn={() => setShowSignInModal(true)}
            notify={showNotification}
          />
        )}

        {currentView === 'inventory' && (
          <MyLoans 
            user={user}
            language={language}
            notify={showNotification}
          />
        )}

        {currentView === 'rules' && (
          <RulesGuide language={language} />
        )}

        {currentView === 'admin' && user?.role === 'admin' && (
          <AdminDashboard 
            user={user}
            language={language}
            notify={showNotification}
            onOpenBookDetails={(id) => setSelectedBookId(id)}
          />
        )}
      </main>

      {/* Modals */}
      {showSignInModal && (
        <SignInModal 
          language={language}
          onClose={() => setShowSignInModal(false)}
          onSuccess={(loggedInUser) => {
            setUser(loggedInUser);
            setShowSignInModal(false);
            showNotification(language === 'ckb' ? 'بە سەرکەوتوویی چوویتە ژوورەوە' : 'Signed in successfully', 'success');
          }}
        />
      )}

      {selectedBookId && (
        <BookDetailsModal 
          bookId={selectedBookId}
          user={user}
          language={language}
          onClose={() => setSelectedBookId(null)}
          notify={showNotification}
        />
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="toast-container">
          <div className={`toast ${toast.type}`}>
            {toast.message}
          </div>
        </div>
      )}
    </div>
  );
}
