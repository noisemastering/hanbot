import React, { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useTranslation } from "../i18n";

function Settings() {
  const { user } = useAuth();
  const { t, language, changeLanguage } = useTranslation();
  const [formData, setFormData] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: ""
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });

  // Push notification state
  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushMessage, setPushMessage] = useState({ type: "", text: "" });

  // Check push notification support and status on mount
  useEffect(() => {
    const checkPushSupport = async () => {
      // Check if browser supports push notifications
      if ('serviceWorker' in navigator && 'PushManager' in window) {
        setPushSupported(true);

        // Check if already subscribed
        try {
          const registration = await navigator.serviceWorker.ready;
          const subscription = await registration.pushManager.getSubscription();
          setPushEnabled(!!subscription);
        } catch (err) {
          console.error("Error checking push subscription:", err);
        }
      }
    };

    checkPushSupport();
  }, []);

  // Register service worker
  const registerServiceWorker = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      return registration;
    } catch (err) {
      console.error("Service worker registration failed:", err);
      throw err;
    }
  };

  // Subscribe to push notifications
  const subscribeToPush = async () => {
    setPushLoading(true);
    setPushMessage({ type: "", text: "" });

    try {
      // Request notification permission
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPushMessage({ type: "error", text: t('settings.pushDenied') });
        return;
      }

      // Register service worker
      const registration = await registerServiceWorker();

      // Get VAPID public key from server
      const token = localStorage.getItem("token");
      const keyResponse = await fetch(`${process.env.REACT_APP_API_URL}/push/vapid-key`);
      const keyData = await keyResponse.json();

      if (!keyData.success || !keyData.publicKey) {
        throw new Error("Failed to get VAPID key");
      }

      // Convert VAPID key
      const applicationServerKey = urlBase64ToUint8Array(keyData.publicKey);

      // Subscribe to push
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey
      });

      // Send subscription to server
      const response = await fetch(`${process.env.REACT_APP_API_URL}/push/subscribe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(subscription.toJSON())
      });

      const data = await response.json();

      if (data.success) {
        setPushEnabled(true);
        setPushMessage({ type: "success", text: t('settings.pushEnabled') });
      } else {
        throw new Error(data.error || "Failed to subscribe");
      }
    } catch (err) {
      console.error("Error subscribing to push:", err);
      setPushMessage({ type: "error", text: t('settings.pushErrorEnable') });
    } finally {
      setPushLoading(false);
    }
  };

  // Unsubscribe from push notifications
  const unsubscribeFromPush = async () => {
    setPushLoading(true);
    setPushMessage({ type: "", text: "" });

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        // Unsubscribe locally
        await subscription.unsubscribe();

        // Notify server
        const token = localStorage.getItem("token");
        await fetch(`${process.env.REACT_APP_API_URL}/push/unsubscribe`, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({ endpoint: subscription.endpoint })
        });
      }

      setPushEnabled(false);
      setPushMessage({ type: "success", text: t('settings.pushDisabled') });
    } catch (err) {
      console.error("Error unsubscribing from push:", err);
      setPushMessage({ type: "error", text: t('settings.pushErrorDisable') });
    } finally {
      setPushLoading(false);
    }
  };

  // Helper function to convert VAPID key
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage({ type: "", text: "" });

    // Validation
    if (!formData.currentPassword || !formData.newPassword || !formData.confirmPassword) {
      setMessage({ type: "error", text: t('settings.errorAllRequired') });
      return;
    }

    if (formData.newPassword.length < 6) {
      setMessage({ type: "error", text: t('settings.errorMinLength') });
      return;
    }

    if (formData.newPassword !== formData.confirmPassword) {
      setMessage({ type: "error", text: t('settings.errorMismatch') });
      return;
    }

    setLoading(true);

    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${process.env.REACT_APP_API_URL}/auth/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          currentPassword: formData.currentPassword,
          newPassword: formData.newPassword
        })
      });

      const data = await response.json();

      if (data.success) {
        setMessage({ type: "success", text: t('settings.passwordChanged') });
        setFormData({ currentPassword: "", newPassword: "", confirmPassword: "" });
      } else {
        setMessage({ type: "error", text: data.error || t('settings.errorChangePassword') });
      }
    } catch (error) {
      console.error("Error changing password:", error);
      setMessage({ type: "error", text: t('settings.errorChangePassword') });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold mb-6">{t('settings.title')}</h2>

      {/* User Info Section */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6 mb-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-200">{t('settings.userInfo')}</h3>
        <div className="space-y-3">
          <div className="flex justify-between py-2 border-b border-gray-700">
            <span className="text-gray-400">{t('settings.usernameLabel')}</span>
            <span className="text-white font-medium">{user?.username}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-gray-700">
            <span className="text-gray-400">{t('settings.fullName')}</span>
            <span className="text-white">{user?.fullName || "—"}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-gray-700">
            <span className="text-gray-400">{t('settings.emailLabel')}</span>
            <span className="text-white">{user?.email || "—"}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-gray-700">
            <span className="text-gray-400">{t('settings.roleLabel')}</span>
            <span className="text-white">{user?.roleLabel || user?.role}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-gray-400">{t('settings.profileLabel')}</span>
            <span className="text-white">{user?.profileLabel || user?.profile || "—"}</span>
          </div>
        </div>
      </div>

      {/* Language Section */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6 mb-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-200">{t('settings.language')}</h3>
        <p className="text-gray-400 text-sm mb-4">{t('settings.languageDescription')}</p>
        <div className="flex gap-3">
          <button
            onClick={() => changeLanguage('es')}
            className={`px-6 py-3 rounded-lg font-medium transition-colors ${
              language === 'es'
                ? 'bg-primary-600 text-white'
                : 'bg-gray-700/50 text-gray-300 hover:bg-gray-600/50'
            }`}
          >
            Español
          </button>
          <button
            onClick={() => changeLanguage('en')}
            className={`px-6 py-3 rounded-lg font-medium transition-colors ${
              language === 'en'
                ? 'bg-primary-600 text-white'
                : 'bg-gray-700/50 text-gray-300 hover:bg-gray-600/50'
            }`}
          >
            English
          </button>
        </div>
      </div>

      {/* Push Notifications Section */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6 mb-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-200">{t('settings.pushNotifications')}</h3>

        {!pushSupported ? (
          <p className="text-gray-400">
            {t('settings.pushNotSupported')}
          </p>
        ) : (
          <div className="space-y-4">
            <p className="text-gray-400 text-sm">
              {t('settings.pushDescription')}
            </p>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`w-3 h-3 rounded-full ${pushEnabled ? 'bg-green-500' : 'bg-gray-500'}`}></span>
                <span className="text-white">
                  {pushEnabled ? t('settings.pushEnabled') : t('settings.pushDisabled')}
                </span>
              </div>

              <button
                onClick={pushEnabled ? unsubscribeFromPush : subscribeToPush}
                disabled={pushLoading}
                className={`px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  pushEnabled
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : 'bg-primary-600 hover:bg-primary-700 text-white'
                }`}
              >
                {pushLoading
                  ? t('common.processing')
                  : pushEnabled
                    ? t('common.disable')
                    : t('common.enable')
                }
              </button>
            </div>

            {/* Push Message */}
            {pushMessage.text && (
              <div
                className={`p-3 rounded-lg ${
                  pushMessage.type === "success"
                    ? "bg-green-500/20 border border-green-500 text-green-400"
                    : "bg-red-500/20 border border-red-500 text-red-400"
                }`}
              >
                {pushMessage.text}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Change Password Section */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-200">{t('settings.changePassword')}</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Current Password */}
          <div>
            <label className="block text-gray-300 text-sm font-medium mb-2">
              {t('settings.currentPassword')}
            </label>
            <input
              type="password"
              value={formData.currentPassword}
              onChange={(e) => setFormData({ ...formData, currentPassword: e.target.value })}
              className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder={t('settings.currentPasswordPlaceholder')}
              disabled={loading}
            />
          </div>

          {/* New Password */}
          <div>
            <label className="block text-gray-300 text-sm font-medium mb-2">
              {t('settings.newPassword')}
            </label>
            <input
              type="password"
              value={formData.newPassword}
              onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
              className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder={t('settings.newPasswordPlaceholder')}
              disabled={loading}
            />
          </div>

          {/* Confirm Password */}
          <div>
            <label className="block text-gray-300 text-sm font-medium mb-2">
              {t('settings.confirmNewPassword')}
            </label>
            <input
              type="password"
              value={formData.confirmPassword}
              onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
              className="w-full px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder={t('settings.confirmPasswordPlaceholder')}
              disabled={loading}
            />
          </div>

          {/* Message */}
          {message.text && (
            <div
              className={`p-3 rounded-lg ${
                message.type === "success"
                  ? "bg-green-500/20 border border-green-500 text-green-400"
                  : "bg-red-500/20 border border-red-500 text-red-400"
              }`}
            >
              {message.text}
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary-600 hover:bg-primary-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? t('settings.changingPassword') : t('settings.submitChangePassword')}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Settings;
