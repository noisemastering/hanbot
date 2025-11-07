import React, { useEffect, useState } from "react";
import io from "socket.io-client";
import {
  ResponsiveContainer,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Bar
} from "recharts";
import ProductModal from "./components/ProductModal";
import ProductsView from "./components/ProductsView";
import CampaignModal from "./components/CampaignModal";
import CampaignsView from "./components/CampaignsView";
import CampaignProductModal from "./components/CampaignProductModal";
import CampaignProductsView from "./components/CampaignProductsView";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:3000";
const socket = io(API_URL);

function playPopSound() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(880, ctx.currentTime);
  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.08);
}

const menuItems = [
  {
    id: "overview",
    label: "Panel General",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    )
  },
  {
    id: "conversations",
    label: "Conversaciones",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    )
  },
  {
    id: "analytics",
    label: "Analíticas",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    )
  },
  {
    id: "products",
    label: "Productos",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    )
  },
  {
    id: "campaigns",
    label: "Campañas",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
    )
  },
  {
    id: "campaign-products",
    label: "Productos de Campaña",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
    )
  },
  {
    id: "users",
    label: "Usuarios",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    )
  },
  {
    id: "settings",
    label: "Configuración",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    )
  }
];

function App() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState("overview");
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [conversationFilter, setConversationFilter] = useState(null);

  // Products state
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [deleteConfirmProduct, setDeleteConfirmProduct] = useState(null);

  // Campaigns state
  const [campaigns, setCampaigns] = useState([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState(null);
  const [deleteConfirmCampaign, setDeleteConfirmCampaign] = useState(null);

  // Campaign Products state
  const [campaignProducts, setCampaignProducts] = useState([]);
  const [campaignProductsLoading, setCampaignProductsLoading] = useState(false);
  const [showCampaignProductModal, setShowCampaignProductModal] = useState(false);
  const [editingCampaignProduct, setEditingCampaignProduct] = useState(null);
  const [deleteConfirmCampaignProduct, setDeleteConfirmCampaignProduct] = useState(null);

  const fetchMessages = async () => {
    try {
      const res = await fetch(`${API_URL}/messages`, {
        headers: { Authorization: "Bearer hanlob_admin_2025" }
      });
      const data = await res.json();
      setMessages(data.data || []);
    } catch (error) {
      console.error("Error fetching messages:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchProducts = async () => {
    setProductsLoading(true);
    try {
      console.log("Fetching products from:", `${API_URL}/products`);
      const res = await fetch(`${API_URL}/products`);
      console.log("Response status:", res.status);
      const data = await res.json();
      console.log("Response data:", data);
      if (data.success) {
        console.log("Setting products:", data.data?.length, "products");
        setProducts(data.data || []);
      } else {
        console.warn("API returned success=false:", data);
      }
    } catch (error) {
      console.error("Error fetching products:", error);
    } finally {
      setProductsLoading(false);
    }
  };

  const handleDeleteProduct = async (productId) => {
    try {
      const res = await fetch(`${API_URL}/products/${productId}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (data.success) {
        setProducts(products.filter(p => p._id !== productId));
        setDeleteConfirmProduct(null);
      }
    } catch (error) {
      console.error("Error deleting product:", error);
      alert("Error al eliminar el producto");
    }
  };

  const handleSaveProduct = async (productData) => {
    try {
      const url = editingProduct
        ? `${API_URL}/products/${editingProduct._id}`
        : `${API_URL}/products`;
      const method = editingProduct ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(productData)
      });

      const data = await res.json();
      if (data.success) {
        if (editingProduct) {
          setProducts(products.map(p => p._id === editingProduct._id ? data.data : p));
        } else {
          setProducts([data.data, ...products]);
        }
        setShowProductModal(false);
        setEditingProduct(null);
      }
    } catch (error) {
      console.error("Error saving product:", error);
      alert("Error al guardar el producto");
    }
  };

  const fetchCampaigns = async () => {
    setCampaignsLoading(true);
    try {
      const res = await fetch(`${API_URL}/campaigns`);
      const data = await res.json();
      if (data.success) {
        setCampaigns(data.data || []);
      }
    } catch (error) {
      console.error("Error fetching campaigns:", error);
    } finally {
      setCampaignsLoading(false);
    }
  };

  const handleDeleteCampaign = async (campaignId) => {
    try {
      const res = await fetch(`${API_URL}/campaigns/${campaignId}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (data.success) {
        setCampaigns(campaigns.filter(c => c._id !== campaignId));
        setDeleteConfirmCampaign(null);
      }
    } catch (error) {
      console.error("Error deleting campaign:", error);
      alert("Error al eliminar la campaña");
    }
  };

  const handleSaveCampaign = async (campaignData) => {
    try {
      const url = editingCampaign
        ? `${API_URL}/campaigns/${editingCampaign._id}`
        : `${API_URL}/campaigns`;
      const method = editingCampaign ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(campaignData)
      });

      const data = await res.json();
      if (data.success) {
        if (editingCampaign) {
          setCampaigns(campaigns.map(c => c._id === editingCampaign._id ? data.data : c));
        } else {
          setCampaigns([data.data, ...campaigns]);
        }
        setShowCampaignModal(false);
        setEditingCampaign(null);
      }
    } catch (error) {
      console.error("Error saving campaign:", error);
      alert("Error al guardar la campaña");
    }
  };

  const fetchCampaignProducts = async () => {
    setCampaignProductsLoading(true);
    try {
      const res = await fetch(`${API_URL}/campaign-products`);
      const data = await res.json();
      if (data.success) {
        setCampaignProducts(data.data || []);
      }
    } catch (error) {
      console.error("Error fetching campaign products:", error);
    } finally {
      setCampaignProductsLoading(false);
    }
  };

  const handleDeleteCampaignProduct = async (campaignProductId) => {
    try {
      const res = await fetch(`${API_URL}/campaign-products/${campaignProductId}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (data.success) {
        setCampaignProducts(campaignProducts.filter(cp => cp._id !== campaignProductId));
        setDeleteConfirmCampaignProduct(null);
      }
    } catch (error) {
      console.error("Error deleting campaign product:", error);
      alert("Error al eliminar el producto de campaña");
    }
  };

  const handleSaveCampaignProduct = async (campaignProductData) => {
    try {
      const url = editingCampaignProduct
        ? `${API_URL}/campaign-products/${editingCampaignProduct._id}`
        : `${API_URL}/campaign-products`;
      const method = editingCampaignProduct ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(campaignProductData)
      });

      const data = await res.json();
      if (data.success) {
        if (editingCampaignProduct) {
          setCampaignProducts(campaignProducts.map(cp => cp._id === editingCampaignProduct._id ? data.data : cp));
        } else {
          setCampaignProducts([data.data, ...campaignProducts]);
        }
        setShowCampaignProductModal(false);
        setEditingCampaignProduct(null);
      }
    } catch (error) {
      console.error("Error saving campaign product:", error);
      alert("Error al guardar el producto de campaña");
    }
  };

  useEffect(() => {
    fetchMessages();

    socket.on("new_message", (msg) => {
      setMessages((prev) => [msg, ...prev]);
      playPopSound();
    });

    return () => socket.disconnect();
  }, []);

  useEffect(() => {
    if (activeMenu === "products") {
      fetchProducts();
    }
  }, [activeMenu]);

  useEffect(() => {
    if (activeMenu === "campaigns") {
      fetchCampaigns();
    }
  }, [activeMenu]);

  useEffect(() => {
    if (activeMenu === "campaign-products") {
      fetchCampaignProducts();
      // Also fetch campaigns for the dropdown in the modal
      if (campaigns.length === 0) {
        fetchCampaigns();
      }
    }
  }, [activeMenu]);

  // Metrics
  const totalMessages = messages.length;
  const totalUsers = new Set(messages.map((m) => m.psid)).size;
  const botMessages = messages.filter((m) => m.senderType === "bot").length;
  const botResponseRate = totalMessages
    ? ((botMessages / totalMessages) * 100).toFixed(1)
    : 0;

  const lastMessagesByUser = {};
  messages.forEach((m) => {
    if (!lastMessagesByUser[m.psid]) lastMessagesByUser[m.psid] = m;
  });
  const unanswered = Object.values(lastMessagesByUser).filter(
    (m) => m.senderType === "user"
  ).length;

  let filteredMessages = messages;

  // Apply sender type filter
  if (filter !== "all") {
    filteredMessages = filteredMessages.filter((msg) => msg.senderType === filter);
  }

  // Apply conversation filter (by PSID)
  if (conversationFilter) {
    filteredMessages = filteredMessages.filter((msg) => msg.psid === conversationFilter);
  }

  // Get user's full conversation history
  const getUserConversation = (psid) => {
    return messages
      .filter((msg) => msg.psid === psid)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  };

  function getChartData(messages) {
    const counts = {};
    messages.forEach((m) => {
      const date = new Date(m.timestamp);
      const hour = date.getHours();
      counts[hour] = (counts[hour] || 0) + 1;
    });
    return Object.entries(counts).map(([hour, count]) => ({
      hour: `${hour}:00`,
      count
    }));
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      {/* Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        ></div>
      )}

      {/* Sidebar */}
      <aside className={`fixed top-0 left-0 h-full w-64 bg-gray-900/95 backdrop-blur-lg border-r border-gray-700/50 z-50 transform transition-transform duration-300 ease-in-out ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      } lg:translate-x-0`}>
        <div className="flex flex-col h-full">
          {/* Sidebar Header */}
          <div className="p-6 border-b border-gray-700/50">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-700 rounded-lg flex items-center justify-center">
                <span className="text-white text-xl font-bold">H</span>
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Hanlob Bot</h2>
                <p className="text-xs text-gray-400">Dashboard</p>
              </div>
            </div>
          </div>

          {/* Menu Items */}
          <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
            {menuItems.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setActiveMenu(item.id);
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-all ${
                  activeMenu === item.id
                    ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30'
                    : 'text-gray-400 hover:bg-gray-800/50 hover:text-white'
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {item.icon}
                </svg>
                <span className="font-medium">{item.label}</span>
              </button>
            ))}
          </nav>

          {/* Sidebar Footer */}
          <div className="p-4 border-t border-gray-700/50">
            <div className="flex items-center space-x-2 bg-primary-500/10 px-3 py-2 rounded-lg">
              <div className="w-2 h-2 bg-primary-500 rounded-full animate-pulse"></div>
              <span className="text-sm font-medium text-primary-400">En Vivo</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="lg:ml-64">
        {/* Header */}
        <header className="bg-gray-900/50 backdrop-blur-lg border-b border-gray-700/50 sticky top-0 z-30">
          <div className="px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center justify-between">
              {/* Left: Hamburger + Title */}
              <div className="flex items-center space-x-4">
                <button
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  className="lg:hidden p-2 rounded-lg text-gray-400 hover:bg-gray-800/50 hover:text-white transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
                <div>
                  <h1 className="text-xl font-bold text-white">
                    {menuItems.find(item => item.id === activeMenu)?.label || "Panel General"}
                  </h1>
                  <p className="text-sm text-gray-400">Monitorea tu chatbot en tiempo real</p>
                </div>
              </div>

              {/* Right: Top Menu */}
              <div className="flex items-center space-x-2">
                {/* Notifications */}
                <button className="p-2 rounded-lg text-gray-400 hover:bg-gray-800/50 hover:text-white transition-colors relative">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  <span className="absolute top-1 right-1 w-2 h-2 bg-amber-500 rounded-full"></span>
                </button>

                {/* Help */}
                <button className="p-2 rounded-lg text-gray-400 hover:bg-gray-800/50 hover:text-white transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>

                {/* User Profile */}
                <button className="flex items-center space-x-2 p-2 rounded-lg text-gray-400 hover:bg-gray-800/50 hover:text-white transition-colors">
                  <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-primary-700 rounded-full flex items-center justify-center">
                    <span className="text-white text-sm font-bold">A</span>
                  </div>
                  <span className="hidden sm:block text-sm font-medium text-white">Administrador</span>
                </button>
              </div>
            </div>
          </div>
        </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Overview Content */}
        {activeMenu === "overview" && (
          <>
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {/* Total Messages */}
          <button
            onClick={() => {
              setFilter("all");
              setConversationFilter(null);
            }}
            className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 backdrop-blur-lg border border-blue-500/20 rounded-xl p-6 hover:from-blue-500/20 hover:to-blue-600/10 transition-all cursor-pointer text-left w-full"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-400 mb-1">Mensajes Totales</p>
                <h3 className="text-3xl font-bold text-white">{totalMessages}</h3>
              </div>
              <div className="w-12 h-12 bg-blue-500/20 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
              </div>
            </div>
          </button>

          {/* Unique Users */}
          <button
            onClick={() => {
              setActiveMenu("users");
              setFilter("all");
              setConversationFilter(null);
            }}
            className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 backdrop-blur-lg border border-purple-500/20 rounded-xl p-6 hover:from-purple-500/20 hover:to-purple-600/10 transition-all cursor-pointer text-left w-full"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-400 mb-1">Usuarios Únicos</p>
                <h3 className="text-3xl font-bold text-white">{totalUsers}</h3>
              </div>
              <div className="w-12 h-12 bg-purple-500/20 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              </div>
            </div>
          </button>

          {/* Response Rate */}
          <button
            onClick={() => {
              setFilter("bot");
              setConversationFilter(null);
            }}
            className="bg-gradient-to-br from-primary-500/10 to-primary-600/5 backdrop-blur-lg border border-primary-500/20 rounded-xl p-6 hover:from-primary-500/20 hover:to-primary-600/10 transition-all cursor-pointer text-left w-full"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-400 mb-1">Tasa de Respuesta</p>
                <h3 className="text-3xl font-bold text-white">{botResponseRate}%</h3>
              </div>
              <div className="w-12 h-12 bg-primary-500/20 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
          </button>

          {/* Unanswered */}
          <button
            onClick={() => {
              setFilter("user");
              setConversationFilter(null);
            }}
            className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 backdrop-blur-lg border border-amber-500/20 rounded-xl p-6 hover:from-amber-500/20 hover:to-amber-600/10 transition-all cursor-pointer text-left w-full"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-400 mb-1">Sin Responder</p>
                <h3 className="text-3xl font-bold text-white">{unanswered}</h3>
              </div>
              <div className="w-12 h-12 bg-amber-500/20 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
            </div>
          </button>
        </div>

        {/* Activity Chart */}
        <div className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl p-6 mb-8">
          <h2 className="text-xl font-bold text-white mb-6 flex items-center">
            <svg className="w-5 h-5 text-primary-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Resumen de Actividad
          </h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={getChartData(messages)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="hour" stroke="#9CA3AF" />
              <YAxis stroke="#9CA3AF" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1F2937',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  color: '#fff'
                }}
              />
              <Bar dataKey="count" fill="#22c55e" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Filters */}
        <div className="flex items-center space-x-2 mb-6">
          <button
            onClick={() => setFilter("all")}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              filter === "all"
                ? "bg-primary-500 text-white"
                : "bg-gray-800/50 text-gray-400 hover:bg-gray-700/50"
            }`}
          >
            Todos los Mensajes
          </button>
          <button
            onClick={() => setFilter("user")}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              filter === "user"
                ? "bg-blue-500 text-white"
                : "bg-gray-800/50 text-gray-400 hover:bg-gray-700/50"
            }`}
          >
            Solo Usuarios
          </button>
          <button
            onClick={() => setFilter("bot")}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              filter === "bot"
                ? "bg-purple-500 text-white"
                : "bg-gray-800/50 text-gray-400 hover:bg-gray-700/50"
            }`}
          >
            Solo Bot
          </button>
        </div>

        {/* Messages Table */}
        <div className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-700/50">
            <h2 className="text-xl font-bold text-white">Conversaciones Recientes</h2>
          </div>
          {loading ? (
            <div className="p-8 text-center">
              <div className="inline-block w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-gray-400 mt-4">Cargando mensajes...</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-900/50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Fecha y Hora
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Tipo
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      ID de Usuario
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Mensaje
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/50">
                  {filteredMessages.map((msg) => (
                    <tr
                      key={msg._id}
                      onClick={() => setSelectedConversation(msg.psid)}
                      className="hover:bg-gray-700/30 transition-colors cursor-pointer"
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                        {new Date(msg.timestamp).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            msg.senderType === "bot"
                              ? "bg-purple-500/20 text-purple-300"
                              : "bg-blue-500/20 text-blue-300"
                          }`}
                        >
                          {msg.senderType}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400 font-mono">
                        {msg.psid.slice(0, 12)}...
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-300 max-w-md truncate">
                        {msg.text}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Conversation Detail Modal */}
        {selectedConversation && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col">
              {/* Modal Header */}
              <div className="px-6 py-4 border-b border-gray-700/50 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-white">Detalle de Conversación</h2>
                  <p className="text-sm text-gray-400 font-mono mt-1">
                    Usuario: {selectedConversation.slice(0, 16)}...
                  </p>
                </div>
                <button
                  onClick={() => setSelectedConversation(null)}
                  className="p-2 rounded-lg text-gray-400 hover:bg-gray-700/50 hover:text-white transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Conversation Messages */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {getUserConversation(selectedConversation).map((msg, index) => (
                  <div
                    key={index}
                    className={`flex ${msg.senderType === "bot" ? "justify-start" : "justify-end"}`}
                  >
                    <div
                      className={`max-w-[70%] rounded-lg px-4 py-3 ${
                        msg.senderType === "bot"
                          ? "bg-gray-700/50 border border-gray-600/50"
                          : "bg-primary-500/20 border border-primary-500/30"
                      }`}
                    >
                      <div className="flex items-center space-x-2 mb-1">
                        <span
                          className={`text-xs font-medium ${
                            msg.senderType === "bot" ? "text-purple-400" : "text-blue-400"
                          }`}
                        >
                          {msg.senderType === "bot" ? "Bot" : "Usuario"}
                        </span>
                        <span className="text-xs text-gray-500">
                          {new Date(msg.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-sm text-gray-200">{msg.text}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-4 border-t border-gray-700/50 flex justify-between items-center">
                <div className="text-sm text-gray-400">
                  {getUserConversation(selectedConversation).length} mensajes en total
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => {
                      setConversationFilter(selectedConversation);
                      setSelectedConversation(null);
                      setFilter("all");
                    }}
                    className="px-4 py-2 bg-primary-500/20 text-primary-400 rounded-lg hover:bg-primary-500/30 transition-colors"
                  >
                    Ver en Tabla
                  </button>
                  <button
                    onClick={() => setSelectedConversation(null)}
                    className="px-4 py-2 bg-gray-700/50 text-white rounded-lg hover:bg-gray-600/50 transition-colors"
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
          </>
        )}

        {/* Conversaciones View */}
        {activeMenu === "conversations" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-white">Conversaciones</h2>
            </div>

            {/* Filters */}
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setFilter("all")}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  filter === "all"
                    ? "bg-primary-500 text-white"
                    : "bg-gray-800/50 text-gray-400 hover:bg-gray-700/50"
                }`}
              >
                Todos los Mensajes
              </button>
              <button
                onClick={() => setFilter("user")}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  filter === "user"
                    ? "bg-blue-500 text-white"
                    : "bg-gray-800/50 text-gray-400 hover:bg-gray-700/50"
                }`}
              >
                Solo Usuarios
              </button>
              <button
                onClick={() => setFilter("bot")}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  filter === "bot"
                    ? "bg-purple-500 text-white"
                    : "bg-gray-800/50 text-gray-400 hover:bg-gray-700/50"
                }`}
              >
                Solo Bot
              </button>
            </div>

            {/* Messages Table */}
            <div className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-700/50">
                <h2 className="text-xl font-bold text-white">Mensajes Recientes</h2>
              </div>
              {loading ? (
                <div className="p-8 text-center">
                  <div className="inline-block w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-gray-400 mt-4">Cargando mensajes...</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-900/50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                          Fecha y Hora
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                          Tipo
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                          ID de Usuario
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                          Mensaje
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700/50">
                      {filteredMessages.length === 0 ? (
                        <tr>
                          <td colSpan="4" className="px-6 py-8 text-center text-gray-400">
                            No se encontraron mensajes
                          </td>
                        </tr>
                      ) : (
                        filteredMessages.map((msg) => (
                          <tr
                            key={msg._id}
                            onClick={() => {
                              setConversationFilter(msg.psid);
                              setActiveMenu("overview");
                            }}
                            className="hover:bg-gray-700/30 transition-colors cursor-pointer"
                          >
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                              {new Date(msg.createdAt).toLocaleString("es-MX")}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              {msg.from === "bot" ? (
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-500/20 text-purple-300 border border-purple-500/30">
                                  Bot
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30">
                                  Usuario
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300 font-mono">
                              {msg.psid.substring(0, 12)}...
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-300 max-w-md truncate">
                              {msg.text}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Analytics View */}
        {activeMenu === "analytics" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-white">Analíticas</h2>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* Total Messages */}
              <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 backdrop-blur-lg border border-blue-500/20 rounded-xl p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-400 mb-1">Mensajes Totales</p>
                    <h3 className="text-3xl font-bold text-white">{totalMessages}</h3>
                  </div>
                  <div className="w-12 h-12 bg-blue-500/20 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                  </div>
                </div>
              </div>

              {/* Unique Users */}
              <div className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 backdrop-blur-lg border border-purple-500/20 rounded-xl p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-400 mb-1">Usuarios Únicos</p>
                    <h3 className="text-3xl font-bold text-white">{totalUsers}</h3>
                  </div>
                  <div className="w-12 h-12 bg-purple-500/20 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  </div>
                </div>
              </div>

              {/* Response Rate */}
              <div className="bg-gradient-to-br from-primary-500/10 to-primary-600/5 backdrop-blur-lg border border-primary-500/20 rounded-xl p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-400 mb-1">Tasa de Respuesta</p>
                    <h3 className="text-3xl font-bold text-white">{botResponseRate}%</h3>
                  </div>
                  <div className="w-12 h-12 bg-primary-500/20 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
              </div>

              {/* Unanswered */}
              <div className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 backdrop-blur-lg border border-amber-500/20 rounded-xl p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-400 mb-1">Sin Responder</p>
                    <h3 className="text-3xl font-bold text-white">{unanswered}</h3>
                  </div>
                  <div className="w-12 h-12 bg-amber-500/20 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            {/* Activity Chart */}
            <div className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl p-6">
              <h2 className="text-xl font-bold text-white mb-6 flex items-center">
                <svg className="w-5 h-5 text-primary-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                Actividad por Hora
              </h2>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={getChartData(messages)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="hour" stroke="#9CA3AF" />
                  <YAxis stroke="#9CA3AF" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1F2937',
                      border: '1px solid #374151',
                      borderRadius: '8px',
                      color: '#fff'
                    }}
                  />
                  <Bar dataKey="count" fill="#22c55e" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Products View */}
        {activeMenu === "products" && (
          <ProductsView
            products={products}
            loading={productsLoading}
            onAdd={() => {
              setEditingProduct(null);
              setShowProductModal(true);
            }}
            onEdit={(product) => {
              setEditingProduct(product);
              setShowProductModal(true);
            }}
            onDelete={(product) => {
              setDeleteConfirmProduct(product);
            }}
          />
        )}

        {/* Campaigns View */}
        {activeMenu === "campaigns" && (
          <CampaignsView
            campaigns={campaigns}
            loading={campaignsLoading}
            onAdd={() => {
              setEditingCampaign(null);
              setShowCampaignModal(true);
            }}
            onEdit={(campaign) => {
              setEditingCampaign(campaign);
              setShowCampaignModal(true);
            }}
            onDelete={(campaign) => {
              setDeleteConfirmCampaign(campaign);
            }}
          />
        )}

        {/* Campaign Products View */}
        {activeMenu === "campaign-products" && (
          <CampaignProductsView
            campaignProducts={campaignProducts}
            loading={campaignProductsLoading}
            onAdd={() => {
              setEditingCampaignProduct(null);
              setShowCampaignProductModal(true);
            }}
            onEdit={(campaignProduct) => {
              setEditingCampaignProduct(campaignProduct);
              setShowCampaignProductModal(true);
            }}
            onDelete={(campaignProduct) => {
              setDeleteConfirmCampaignProduct(campaignProduct);
            }}
          />
        )}

        {/* Product Modal */}
        {showProductModal && (
          <ProductModal
            product={editingProduct}
            onSave={handleSaveProduct}
            onClose={() => {
              setShowProductModal(false);
              setEditingProduct(null);
            }}
          />
        )}

        {/* Delete Confirmation Modal */}
        {deleteConfirmProduct && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-md w-full p-6">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center">
                  <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Eliminar Producto</h3>
                  <p className="text-sm text-gray-400">Esta acción no se puede deshacer</p>
                </div>
              </div>
              <p className="text-gray-300 mb-6">
                ¿Estás seguro de que deseas eliminar <span className="font-semibold text-white">{deleteConfirmProduct.name}</span>?
              </p>
              <div className="flex space-x-2">
                <button
                  onClick={() => setDeleteConfirmProduct(null)}
                  className="flex-1 px-4 py-2 bg-gray-700/50 text-white rounded-lg hover:bg-gray-600/50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => handleDeleteProduct(deleteConfirmProduct._id)}
                  className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                >
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Campaign Modal */}
        {showCampaignModal && (
          <CampaignModal
            campaign={editingCampaign}
            onSave={handleSaveCampaign}
            onClose={() => {
              setShowCampaignModal(false);
              setEditingCampaign(null);
            }}
          />
        )}

        {/* Campaign Delete Confirmation Modal */}
        {deleteConfirmCampaign && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-md w-full p-6">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center">
                  <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Eliminar Campaña</h3>
                  <p className="text-sm text-gray-400">Esta acción no se puede deshacer</p>
                </div>
              </div>
              <p className="text-gray-300 mb-6">
                ¿Estás seguro de que deseas eliminar la campaña <span className="font-semibold text-white">{deleteConfirmCampaign.name}</span>?
              </p>
              <div className="flex space-x-2">
                <button
                  onClick={() => setDeleteConfirmCampaign(null)}
                  className="flex-1 px-4 py-2 bg-gray-700/50 text-white rounded-lg hover:bg-gray-600/50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => handleDeleteCampaign(deleteConfirmCampaign._id)}
                  className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                >
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Campaign Product Modal */}
        {showCampaignProductModal && (
          <CampaignProductModal
            campaignProduct={editingCampaignProduct}
            campaigns={campaigns}
            onSave={handleSaveCampaignProduct}
            onClose={() => {
              setShowCampaignProductModal(false);
              setEditingCampaignProduct(null);
            }}
          />
        )}

        {/* Campaign Product Delete Confirmation Modal */}
        {deleteConfirmCampaignProduct && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-md w-full p-6">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center">
                  <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Eliminar Producto de Campaña</h3>
                  <p className="text-sm text-gray-400">Esta acción no se puede deshacer</p>
                </div>
              </div>
              <p className="text-gray-300 mb-6">
                ¿Estás seguro de que deseas eliminar el producto <span className="font-semibold text-white">{deleteConfirmCampaignProduct.name}</span>?
              </p>
              <div className="flex space-x-2">
                <button
                  onClick={() => setDeleteConfirmCampaignProduct(null)}
                  className="flex-1 px-4 py-2 bg-gray-700/50 text-white rounded-lg hover:bg-gray-600/50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => handleDeleteCampaignProduct(deleteConfirmCampaignProduct._id)}
                  className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                >
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
      </div>
    </div>
  );
}

export default App;
