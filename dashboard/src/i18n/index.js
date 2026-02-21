import React, { createContext, useState, useContext } from 'react';
import es from './es';
import en from './en';

const translations = { es, en };
const LanguageContext = createContext(null);

export const LanguageProvider = ({ children }) => {
  const [language, setLanguage] = useState(() => localStorage.getItem('dashboard-lang') || 'es');

  const changeLanguage = (lang) => {
    setLanguage(lang);
    localStorage.setItem('dashboard-lang', lang);
  };

  const t = (key, params) => {
    let str = translations[language]?.[key] || translations.es[key] || key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        str = str.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
      });
    }
    return str;
  };

  const locale = language === 'en' ? 'en-US' : 'es-MX';

  return (
    <LanguageContext.Provider value={{ language, changeLanguage, t, locale }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useTranslation = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useTranslation must be used within a LanguageProvider');
  }
  return context;
};
