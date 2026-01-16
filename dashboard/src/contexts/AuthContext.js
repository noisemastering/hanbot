// contexts/AuthContext.js
import React, { createContext, useState, useContext, useEffect } from 'react';

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:3000";
const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(localStorage.getItem('token'));

  // Check if user is logged in on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (token) {
      verifyToken();
    } else {
      setLoading(false);
    }
  }, []);

  const verifyToken = async () => {
    try {
      const response = await fetch(`${API_URL}/auth/me`, {
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await response.json();

      if (data.success) {
        setUser(data.user);
      } else {
        localStorage.removeItem('token');
        setToken(null);
        setUser(null);
      }
    } catch (error) {
      console.error('Token verification failed:', error);
      localStorage.removeItem('token');
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const login = async (username, password) => {
    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();

      if (data.success) {
        localStorage.setItem('token', data.token);
        setToken(data.token);
        setUser(data.user);
        return { success: true };
      } else {
        return { success: false, error: data.error };
      }
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: 'Error al conectar con el servidor' };
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  };

  // Check if user has access to a section
  const canAccess = (section) => {
    if (!user) return false;

    // NEW: Use backend permissions array if available
    if (user.permissions && Array.isArray(user.permissions)) {
      console.log(`🔍 Checking access for section "${section}"`, {
        username: user.username,
        role: user.role,
        profile: user.profile,
        permissions: user.permissions,
        hasAccess: user.permissions.includes('*') || user.permissions.includes(section)
      });

      // Check if user has wildcard permission (access to everything)
      if (user.permissions.includes('*')) {
        return true;
      }

      // Check if user has specific section permission
      return user.permissions.includes(section);
    }

    console.log(`⚠️ Using fallback permissions for section "${section}"`, {
      username: user.username,
      role: user.role,
      profile: user.profile
    });

    // FALLBACK: Old hardcoded logic for existing sessions (until they log out/in)
    const permissions = {
      super_admin: ['*'],
      admin: ['*'],
      super_user: {
        accounting: ['conversations', 'campaigns', 'adsets', 'ads', 'products', 'analytics', 'families', 'master-catalog', 'usos'],
        sales: ['conversations', 'campaigns', 'adsets', 'ads', 'products', 'analytics', 'families', 'master-catalog', 'usos']
      },
      user: {
        campaign_manager: ['conversations', 'campaigns', 'adsets', 'ads', 'products'],
        salesman: ['conversations']
      }
    };

    // Super Admin and Admin have access to everything
    if (user.role === 'super_admin' || user.role === 'admin') {
      return true;
    }

    // Super User has profile-based access
    if (user.role === 'super_user' && user.profile) {
      return permissions.super_user[user.profile]?.includes(section) || false;
    }

    // User role depends on profile
    if (user.role === 'user' && user.profile) {
      return permissions.user[user.profile]?.includes(section) || false;
    }

    return false;
  };

  // Check if user can manage users (only super_admin and admin)
  const canManageUsers = () => {
    return user && (user.role === 'super_admin' || user.role === 'admin');
  };

  const value = {
    user,
    token,
    loading,
    login,
    logout,
    canAccess,
    canManageUsers,
    isAuthenticated: !!user
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
