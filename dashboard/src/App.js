/*
 * HanlobBot Dashboard - App.js
 *
 * Recent Updates:
 * - Added Master Catalog functionality:
 *   - MasterCatalogView component for listing subfamilies with master catalog data
 *   - MasterCatalogModal component for creating/editing master catalog entries
 *   - Full CRUD operations integrated with /master-catalog API endpoints
 *   - Support for: family selection, subfamily names, materials, general uses,
 *     general specifications (JSON), and general appliances
 */

import React, { useEffect, useState } from "react";
import { Routes, Route, NavLink, useLocation, useNavigate } from "react-router-dom";
import io from "socket.io-client";
import API from "./api";
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
import MasterCatalogView from "./components/MasterCatalogView";
import MasterCatalogModal from "./components/MasterCatalogModal";
import UsosView from "./components/UsosView";
import UsosModal from "./components/UsosModal";
import ProductFamilyTreeView from "./components/ProductFamilyTreeView";
import ProductFamilyModal from "./components/ProductFamilyModal";
import Messages from "./pages/Messages";

const API_URL = process.env.REACT_APP_API_URL || "https://hanbot-production.up.railway.app";
const socket = io(API_URL, {
  reconnection: false, // Don't keep trying to reconnect
  autoConnect: false   // Don't connect automatically
});

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
    path: "/",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    )
  },
  {
    id: "conversations",
    label: "Conversaciones",
    path: "/conversations",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    )
  },
  {
    id: "analytics",
    label: "Analíticas",
    path: "/analytics",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    )
  },
  {
    id: "familias",
    label: "Familias",
    path: "/familias",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    )
  },
  {
    id: "usos",
    label: "Usos",
    path: "/usos",
    icon: (
      <>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v7m0 0l-4 4m4-4l4 4" />
        <circle cx="12" cy="4" r="1.5" fill="currentColor" />
        <circle cx="8" cy="15" r="1.5" fill="currentColor" />
        <circle cx="16" cy="15" r="1.5" fill="currentColor" />
      </>
    )
  },
  {
    id: "products",
    label: "Productos",
    path: "/products",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    )
  },
  {
    id: "campaigns",
    label: "Campañas",
    path: "/campaigns",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
    )
  },
  {
    id: "campaign-products",
    label: "Productos de Campaña",
    path: "/campaign-products",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
    )
  },
  {
    id: "users",
    label: "Usuarios",
    path: "/users",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    )
  },
  {
    id: "settings",
    label: "Configuración",
    path: "/settings",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    )
  }
];

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [conversationStatuses, setConversationStatuses] = useState({});
  const [handoverLoading, setHandoverLoading] = useState({});
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

  // Master Catalog state
  const [subfamilies, setSubfamilies] = useState([]);
  const [subfamiliesLoading, setSubfamiliesLoading] = useState(false);
  const [showMasterCatalogModal, setShowMasterCatalogModal] = useState(false);
  const [editingSubfamily, setEditingSubfamily] = useState(null);
  const [deleteConfirmSubfamily, setDeleteConfirmSubfamily] = useState(null);

  // Usos state
  const [showUsosModal, setShowUsosModal] = useState(false);
  const [selectedUso, setSelectedUso] = useState(null);
  const [usos, setUsos] = useState([]);

  // Product Families state
  const [productFamilyTree, setProductFamilyTree] = useState([]);
  const [productFamiliesLoading, setProductFamiliesLoading] = useState(false);
  const [showProductFamilyModal, setShowProductFamilyModal] = useState(false);
  const [selectedProductFamily, setSelectedProductFamily] = useState(null);
  const [selectedParentId, setSelectedParentId] = useState(null);
  const [deleteConfirmProductFamily, setDeleteConfirmProductFamily] = useState(null);

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

  const fetchSubfamilies = async () => {
    setSubfamiliesLoading(true);
    try {
      const res = await fetch(`${API_URL}/master-catalog`);
      const data = await res.json();
      if (data.success) {
        setSubfamilies(data.data || []);
      }
    } catch (error) {
      console.error("Error fetching subfamilies:", error);
    } finally {
      setSubfamiliesLoading(false);
    }
  };

  const handleDeleteSubfamily = async (subfamilyId) => {
    try {
      const res = await fetch(`${API_URL}/master-catalog/${subfamilyId}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (data.success) {
        setSubfamilies(subfamilies.filter(s => s._id !== subfamilyId));
        setDeleteConfirmSubfamily(null);
      }
    } catch (error) {
      console.error("Error deleting subfamily:", error);
      alert("Error al eliminar la entrada del catálogo maestro");
    }
  };

  const handleSaveSubfamily = async (subfamilyData) => {
    try {
      const url = editingSubfamily
        ? `${API_URL}/master-catalog/${editingSubfamily._id}`
        : `${API_URL}/master-catalog`;
      const method = editingSubfamily ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subfamilyData)
      });

      const data = await res.json();
      if (data.success) {
        if (editingSubfamily) {
          setSubfamilies(subfamilies.map(s => s._id === editingSubfamily._id ? data.data : s));
        } else {
          setSubfamilies([data.data, ...subfamilies]);
        }
        setShowMasterCatalogModal(false);
        setEditingSubfamily(null);
      }
    } catch (error) {
      console.error("Error saving subfamily:", error);
      alert("Error al guardar la entrada del catálogo maestro");
    }
  };

  const fetchUsos = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/usos`);
      const data = await res.json();
      if (data.success) {
        setUsos(data.data || []);
      }
    } catch (error) {
      console.error("Error fetching usos:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUso = async (usoId) => {
    try {
      const res = await fetch(`${API_URL}/usos/${usoId}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (data.success) {
        setUsos(usos.filter(u => u._id !== usoId));
      }
    } catch (error) {
      console.error("Error deleting uso:", error);
      alert("Error al eliminar el uso");
    }
  };

  const handleSaveUso = async (usoData) => {
    try {
      const url = selectedUso
        ? `${API_URL}/usos/${selectedUso._id}`
        : `${API_URL}/usos`;
      const method = selectedUso ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(usoData)
      });

      const data = await res.json();
      if (data.success) {
        if (selectedUso) {
          setUsos(usos.map(u => u._id === selectedUso._id ? data.data : u));
        } else {
          setUsos([data.data, ...usos]);
        }
        setShowUsosModal(false);
        setSelectedUso(null);
      }
    } catch (error) {
      console.error("Error saving uso:", error);
      alert("Error al guardar el uso");
    }
  };

  const fetchProductFamilies = async () => {
    setProductFamiliesLoading(true);
    try {
      const res = await fetch(`${API_URL}/product-families/tree`);
      const data = await res.json();
      if (data.success) {
        setProductFamilyTree(data.data || []);
      }
    } catch (error) {
      console.error("Error fetching product families:", error);
    } finally {
      setProductFamiliesLoading(false);
    }
  };

  const handleSaveProductFamily = async (productFamilyData) => {
    try {
      // Use the presence of _id to determine if this is an update (PUT) or create (POST)
      const isUpdate = selectedProductFamily && selectedProductFamily._id;
      const url = isUpdate
        ? `${API_URL}/product-families/${selectedProductFamily._id}`
        : `${API_URL}/product-families`;
      const method = isUpdate ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(productFamilyData)
      });

      const data = await res.json();
      if (data.success) {
        // Refresh the tree view
        await fetchProductFamilies();
        setShowProductFamilyModal(false);
        setSelectedProductFamily(null);
        setSelectedParentId(null);
      }
    } catch (error) {
      console.error("Error saving product family:", error);
      alert("Error saving product family");
    }
  };

  const handleDeleteProductFamily = async (productId) => {
    if (!productId) {
      console.error("Cannot delete product family: ID is undefined or null");
      alert("Error: No se puede eliminar el producto porque el ID no es válido");
      setDeleteConfirmProductFamily(null);
      return;
    }

    try {
      const res = await fetch(`${API_URL}/product-families/${productId}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (data.success) {
        // Refresh the tree view
        await fetchProductFamilies();
        setDeleteConfirmProductFamily(null);
      }
    } catch (error) {
      console.error("Error deleting product family:", error);
      alert("Error deleting product family");
    }
  };

  const handleAddChild = (parentProduct) => {
    setSelectedProductFamily(null);
    setSelectedParentId(parentProduct._id);
    setShowProductFamilyModal(true);
  };

  const fetchConversationStatus = async (psid) => {
    try {
      const res = await API.get(`/api/conversation/${psid}/status`);
      setConversationStatuses(prev => ({
        ...prev,
        [psid]: res.data
      }));
    } catch (err) {
      console.error(`Error fetching status for ${psid}:`, err);
    }
  };

  const handleTakeover = async (psid) => {
    setHandoverLoading(prev => ({ ...prev, [psid]: true }));
    try {
      await API.post(`/api/conversation/${psid}/takeover`, {
        agentName: "Dashboard User",
        reason: "Manual takeover from dashboard"
      });

      await fetchConversationStatus(psid);
      alert(`Control tomado del PSID: ${psid.slice(0, 16)}...\nEl bot dejara de responder.`);
    } catch (err) {
      console.error("Error taking over:", err);
      alert(`Error: ${err.response?.data?.error || err.message}`);
    } finally {
      setHandoverLoading(prev => ({ ...prev, [psid]: false }));
    }
  };

  const handleRelease = async (psid) => {
    setHandoverLoading(prev => ({ ...prev, [psid]: true }));
    try {
      await API.post(`/api/conversation/${psid}/release`);

      await fetchConversationStatus(psid);
      alert(`Conversacion liberada: ${psid.slice(0, 16)}...\nEl bot puede responder de nuevo.`);
    } catch (err) {
      console.error("Error releasing:", err);
      alert(`Error: ${err.response?.data?.error || err.message}`);
    } finally {
      setHandoverLoading(prev => ({ ...prev, [psid]: false }));
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
    if (location.pathname === "/products") {
      fetchProducts();
    }
  }, [location.pathname]);

  useEffect(() => {
    if (location.pathname === "/campaigns") {
      fetchCampaigns();
    }
  }, [location.pathname]);

  useEffect(() => {
    if (location.pathname === "/campaign-products") {
      fetchCampaignProducts();
      // Also fetch campaigns for the dropdown in the modal
      if (campaigns.length === 0) {
        fetchCampaigns();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  useEffect(() => {
    if (location.pathname === "/master-catalog") {
      fetchSubfamilies();
    }
  }, [location.pathname]);

  useEffect(() => {
    if (location.pathname === "/usos") {
      fetchUsos();
    }
  }, [location.pathname]);

  useEffect(() => {
    if (location.pathname === "/familias") {
      fetchProductFamilies();
    }
  }, [location.pathname]);

  // Helper function to get today's date range in Mexico City time
  const getTodayRange = () => {
    const now = new Date();
    const mexicoTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Mexico_City" }));

    const startOfDay = new Date(mexicoTime);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(mexicoTime);
    endOfDay.setHours(23, 59, 59, 999);

    return { start: startOfDay, end: endOfDay };
  };

  // Filter messages for today only
  const { start: todayStart, end: todayEnd } = getTodayRange();
  const todayMessages = messages.filter((m) => {
    const msgDate = new Date(m.timestamp);
    return msgDate >= todayStart && msgDate <= todayEnd;
  });

  // Metrics (using today's messages only)
  const totalMessages = todayMessages.length;
  const totalUsers = new Set(todayMessages.map((m) => m.psid)).size;
  const botMessages = todayMessages.filter((m) => m.senderType === "bot").length;
  const botResponseRate = totalMessages
    ? ((botMessages / totalMessages) * 100).toFixed(1)
    : 0;

  const lastMessagesByUser = {};
  todayMessages.forEach((m) => {
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
    // Filter messages to last 12 hours
    const now = new Date();
    const last12Hours = new Date(now.getTime() - 12 * 60 * 60 * 1000);

    const recentMessages = messages.filter(m => new Date(m.timestamp) >= last12Hours);

    // Group by hour with both received and answered counts
    const hourlyData = {};

    recentMessages.forEach((m) => {
      const date = new Date(m.timestamp);
      // Format as "Nov 12, 10:00"
      const hourKey = date.toLocaleString('es-MX', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Mexico_City'
      });

      if (!hourlyData[hourKey]) {
        hourlyData[hourKey] = { date: hourKey, received: 0, answered: 0, timestamp: date.getTime() };
      }

      // Count user messages as "received", answered user messages as "answered"
      if (m.senderType === 'user') {
        hourlyData[hourKey].received += 1;
        if (m.answered === true) {
          hourlyData[hourKey].answered += 1;
        }
      }
    });

    // Convert to array and sort by timestamp
    return Object.values(hourlyData).sort((a, b) => a.timestamp - b.timestamp);
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
              <NavLink
                key={item.id}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) => `w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-all ${
                  isActive
                    ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30'
                    : 'text-gray-400 hover:bg-gray-800/50 hover:text-white'
                }`}
                end={item.path === "/"}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {item.icon}
                </svg>
                <span className="font-medium">{item.label}</span>
              </NavLink>
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
                    {menuItems.find(item => item.path === location.pathname)?.label || "Panel General"}
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
        <Routes>
          {/* Overview Route */}
          <Route path="/" element={
          <>
        {/* Today's Stats Header */}
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-white mb-2">
            📊 Estadísticas de Hoy
          </h2>
          <p className="text-sm text-gray-400">
            {new Date().toLocaleDateString('es-MX', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              timeZone: 'America/Mexico_City'
            })}
          </p>
        </div>

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
              navigate("/users");
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
            Resumen de Actividad (Últimas 12 horas)
          </h2>
          <ResponsiveContainer width="100%" height={450}>
            <BarChart data={getChartData(messages)} barSize={40} barGap={-15}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="date" stroke="#9CA3AF" angle={-45} textAnchor="end" height={80} fontSize={10} />
              <YAxis stroke="#9CA3AF" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1F2937',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                  color: '#fff'
                }}
              />
              <Bar dataKey="answered" fill="#22c55e" fillOpacity={0.85} radius={[8, 8, 0, 0]} name="Respondidos" />
              <Bar dataKey="received" fill="#3b82f6" fillOpacity={0.95} radius={[8, 8, 0, 0]} name="Recibidos" />
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

          </>
          } />

          {/* Conversaciones Route */}
          <Route path="/conversations" element={<Messages />} />

          {/* Analytics Route */}
          <Route path="/analytics" element={(
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
                Actividad por Hora (Últimas 12 horas)
              </h2>
              <ResponsiveContainer width="100%" height={450}>
                <BarChart data={getChartData(messages)} barSize={40} barGap={-15}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="date" stroke="#9CA3AF" angle={-45} textAnchor="end" height={80} fontSize={10} />
                  <YAxis stroke="#9CA3AF" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1F2937',
                      border: '1px solid #374151',
                      borderRadius: '8px',
                      color: '#fff'
                    }}
                  />
                  <Bar dataKey="answered" fill="#22c55e" fillOpacity={0.85} radius={[8, 8, 0, 0]} name="Respondidos" />
                  <Bar dataKey="received" fill="#3b82f6" fillOpacity={0.95} radius={[8, 8, 0, 0]} name="Recibidos" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          )} />

          {/* Products Route */}
          <Route path="/products" element={
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
          } />

          {/* Campaigns Route */}
          <Route path="/campaigns" element={
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
          } />

          {/* Campaign Products Route */}
          <Route path="/campaign-products" element={
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
          } />

          {/* Master Catalog Route */}
          <Route path="/master-catalog" element={
            <MasterCatalogView
              subfamilies={subfamilies}
              loading={subfamiliesLoading}
              onAdd={() => {
                setEditingSubfamily(null);
                setShowMasterCatalogModal(true);
              }}
              onEdit={(subfamily) => {
                setEditingSubfamily(subfamily);
                setShowMasterCatalogModal(true);
              }}
              onDelete={(subfamily) => {
                setDeleteConfirmSubfamily(subfamily);
              }}
            />
          } />

          {/* Usos Route */}
          <Route path="/usos" element={
            <UsosView
              usos={usos}
              loading={loading}
              onAdd={() => {
                setSelectedUso(null);
                setShowUsosModal(true);
              }}
              onEdit={(uso) => {
                setSelectedUso(uso);
                setShowUsosModal(true);
              }}
              onDelete={handleDeleteUso}
            />
          } />

          {/* Familias Route */}
          <Route path="/familias" element={
            <ProductFamilyTreeView
              products={productFamilyTree}
              loading={productFamiliesLoading}
              onAdd={() => {
                setSelectedProductFamily(null);
                setSelectedParentId(null);
                setShowProductFamilyModal(true);
              }}
              onEdit={(product) => {
                setSelectedProductFamily(product);
                setSelectedParentId(null);
                setShowProductFamilyModal(true);
              }}
              onDelete={(product) => {
                setDeleteConfirmProductFamily(product);
              }}
              onAddChild={handleAddChild}
              onCopy={(product) => {
                // Create a copy with the same parent (sibling)
                const copiedProduct = {
                  name: product.name + ' (Copia)',
                  description: product.description,
                  parentId: product.parentId,
                  sellable: product.sellable,
                  price: product.price,
                  sku: product.sku,
                  stock: product.stock
                };
                setSelectedProductFamily(copiedProduct);
                setSelectedParentId(null);
                setShowProductFamilyModal(true);
              }}
            />
          } />

          {/* Users and Settings Routes - Placeholder */}
          <Route path="/users" element={<div className="text-white">Users View - Coming Soon</div>} />
          <Route path="/settings" element={<div className="text-white">Settings View - Coming Soon</div>} />
        </Routes>

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

        {/* Master Catalog Modal */}
        {showMasterCatalogModal && (
          <MasterCatalogModal
            subfamily={editingSubfamily}
            onSave={handleSaveSubfamily}
            onClose={() => {
              setShowMasterCatalogModal(false);
              setEditingSubfamily(null);
            }}
          />
        )}

        {/* Usos Modal */}
        {showUsosModal && (
          <UsosModal
            uso={selectedUso}
            onSave={handleSaveUso}
            onClose={() => {
              setShowUsosModal(false);
              setSelectedUso(null);
            }}
          />
        )}

        {/* Product Family Modal */}
        {showProductFamilyModal && (
          <ProductFamilyModal
            product={selectedProductFamily}
            allProducts={productFamilyTree}
            presetParentId={selectedParentId}
            onSave={handleSaveProductFamily}
            onClose={() => {
              setShowProductFamilyModal(false);
              setSelectedProductFamily(null);
              setSelectedParentId(null);
            }}
          />
        )}

        {/* Product Family Delete Confirmation Modal */}
        {deleteConfirmProductFamily && deleteConfirmProductFamily._id && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-md w-full p-6">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center">
                  <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Eliminar Familia de Productos</h3>
                  <p className="text-sm text-gray-400">Esta acción no se puede deshacer</p>
                </div>
              </div>
              <p className="text-gray-300 mb-6">
                ¿Estás seguro de que deseas eliminar <span className="font-semibold text-white">{deleteConfirmProductFamily.name}</span>? Esto también eliminará todos sus hijos.
              </p>
              <div className="flex space-x-2">
                <button
                  onClick={() => setDeleteConfirmProductFamily(null)}
                  className="flex-1 px-4 py-2 bg-gray-700/50 text-white rounded-lg hover:bg-gray-600/50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => handleDeleteProductFamily(deleteConfirmProductFamily._id)}
                  className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                >
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Master Catalog Delete Confirmation Modal */}
        {deleteConfirmSubfamily && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-md w-full p-6">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center">
                  <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Eliminar Entrada del Catálogo</h3>
                  <p className="text-sm text-gray-400">Esta acción no se puede deshacer</p>
                </div>
              </div>
              <p className="text-gray-300 mb-6">
                ¿Estás seguro de que deseas eliminar la entrada <span className="font-semibold text-white">{deleteConfirmSubfamily.name}</span> del catálogo maestro?
              </p>
              <div className="flex space-x-2">
                <button
                  onClick={() => setDeleteConfirmSubfamily(null)}
                  className="flex-1 px-4 py-2 bg-gray-700/50 text-white rounded-lg hover:bg-gray-600/50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => handleDeleteSubfamily(deleteConfirmSubfamily._id)}
                  className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                >
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Conversation Detail Modal - Global */}
        {selectedConversation && (
          <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
            onClick={() => setSelectedConversation(null)}
          >
            <div
              className="bg-gray-900 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex justify-between items-center p-4 border-b border-gray-700">
                <h2 className="text-xl font-bold text-white">
                  Detalle de Conversacion
                </h2>
                <button
                  onClick={() => setSelectedConversation(null)}
                  className="text-gray-400 hover:text-white text-2xl"
                >
                  &times;
                </button>
              </div>

              {/* Modal Body - Scrollable Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {getUserConversation(selectedConversation).map((msg, i) => (
                  <div
                    key={i}
                    className={`p-3 rounded-lg ${
                      msg.senderType === "bot"
                        ? "bg-blue-900 text-blue-100"
                        : "bg-gray-800 text-gray-100"
                    }`}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-xs font-semibold uppercase">
                        {msg.senderType === "bot" ? "🤖 Bot" : "👤 Usuario"}
                      </span>
                      <span className="text-xs text-gray-400">
                        {new Date(msg.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap">{msg.text}</p>
                  </div>
                ))}
              </div>

              {/* Modal Footer */}
              <div className="p-4 border-t border-gray-700 space-y-3">
                {/* Status Indicator */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-300">Estado actual:</span>
                  {conversationStatuses[selectedConversation]?.humanActive ? (
                    <span className="px-3 py-1 bg-orange-500 text-white rounded-full text-sm font-medium">
                      👨‍💼 Humano Activo
                    </span>
                  ) : (
                    <span className="px-3 py-1 bg-green-500 text-white rounded-full text-sm font-medium">
                      🤖 Bot Activo
                    </span>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2">
                  {conversationStatuses[selectedConversation]?.humanActive ? (
                    <button
                      onClick={() => handleRelease(selectedConversation)}
                      disabled={handoverLoading[selectedConversation]}
                      className="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {handoverLoading[selectedConversation] ? "..." : "🤖 Liberar al Bot"}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleTakeover(selectedConversation)}
                      disabled={handoverLoading[selectedConversation]}
                      className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {handoverLoading[selectedConversation] ? "..." : "👨‍💼 Tomar Control"}
                    </button>
                  )}

                  <button
                    onClick={() => {
                      setSelectedConversation(null);
                      navigate("/conversations");
                    }}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                  >
                    Ver en Tabla
                  </button>

                  <button
                    onClick={() => setSelectedConversation(null)}
                    className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                  >
                    Cerrar
                  </button>
                </div>
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
