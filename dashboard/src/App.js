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
import { Toaster } from 'react-hot-toast';
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
import CampaignTreeView from "./components/CampaignTreeView";
import AdSetModal from "./components/AdSetModal";
import AdModal from "./components/AdModal";
import CampaignItemDetailsModal from "./components/CampaignItemDetailsModal";
import AdSetsView from "./components/AdSetsView";
import AdsView from "./components/AdsView";
import CampaignProductModal from "./components/CampaignProductModal";
import CampaignProductsView from "./components/CampaignProductsView";
import MasterCatalogView from "./components/MasterCatalogView";
import MasterCatalogModal from "./components/MasterCatalogModal";
import UsosYGruposView from "./components/UsosYGruposView";
import UsosModal from "./components/UsosModal";
import GruposModal from "./components/GruposModal";
import ProductFamilyTreeView from "./components/ProductFamilyTreeView";
import CopyProductModal from "./components/CopyProductModal";
import ProductDetailsModal from "./components/ProductDetailsModal";
import ProductFamilyModal from "./components/ProductFamilyModal";
import ImportProductsModal from "./components/ImportProductsModal";
import Messages from "./pages/Messages";
import Login from "./pages/Login";
import Settings from "./pages/Settings";
import InventarioView from "./pages/InventarioView";
import PuntosDeVentaView from "./pages/PuntosDeVentaView";
import OrdersView from "./pages/OrdersView";
import PuntoDeVentaModal from "./components/PuntoDeVentaModal";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import UsersView from "./components/UsersView";
import RolesView from "./components/RolesView";
import ProfilesView from "./components/ProfilesView";
import ClickLogsView from "./components/ClickLogsView";
import ConversionsView from "./pages/ConversionsView";

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
  // Stand-alone items
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

  // Expandable sections
  {
    id: "estadisticas",
    label: "Estadísticas",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    ),
    isExpandable: true,
    children: [
      {
        id: "analytics",
        label: "Analíticas",
        path: "/analytics",
        icon: (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        )
      },
      {
        id: "click-logs",
        label: "Clicks",
        path: "/click-logs",
        icon: (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        )
      },
      {
        id: "conversions",
        label: "Conversiones",
        path: "/conversions",
        icon: (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        )
      }
    ]
  },
  {
    id: "catalogo",
    label: "Catálogo",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    ),
    isExpandable: true,
    children: [
      {
        id: "familias",
        label: "Familias",
        path: "/familias",
        icon: (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        )
      },
      {
        id: "usos-grupos",
        label: "Usos y Grupos",
        path: "/usos-grupos",
        icon: (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        )
      },
      {
        id: "inventario",
        label: "Inventario",
        path: "/inventario",
        icon: (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        )
      },
      {
        id: "pos",
        label: "Puntos de Venta",
        path: "/pos",
        icon: (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
        )
      }
    ]
  },
  {
    id: "campanas",
    label: "Campañas",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
    ),
    isExpandable: true,
    children: [
      {
        id: "campaigns",
        label: "Campañas",
        path: "/campaigns",
        icon: (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
        )
      },
      {
        id: "adsets",
        label: "Ad Sets",
        path: "/adsets",
        icon: (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        )
      },
      {
        id: "ads",
        label: "Anuncios",
        path: "/ads",
        icon: (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
        )
      }
    ]
  },
  {
    id: "usuarios",
    label: "Usuarios",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    ),
    isExpandable: true,
    children: [
      {
        id: "users",
        label: "Usuarios",
        path: "/users",
        icon: (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        )
      },
      {
        id: "roles",
        label: "Roles",
        path: "/roles",
        icon: (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        )
      },
      {
        id: "profiles",
        label: "Perfiles",
        path: "/profiles",
        icon: (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
        )
      }
    ]
  },
  {
    id: "mercadolibre",
    label: "Mercado Libre",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
    ),
    isExpandable: true,
    children: [
      {
        id: "ml-orders",
        label: "Pedidos",
        path: "/ml-orders",
        icon: (
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        )
      }
    ]
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
  const { user, loading: authLoading, canAccess, canManageUsers, logout } = useAuth();

  // All useState hooks must be called BEFORE any early returns
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState({}); // Track expanded menu sections
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

  // AdSets state
  const [adSets, setAdSets] = useState([]);
  const [showAdSetModal, setShowAdSetModal] = useState(false);
  const [editingAdSet, setEditingAdSet] = useState(null);
  const [parentCampaignId, setParentCampaignId] = useState(null);

  // Ads state
  const [showAdModal, setShowAdModal] = useState(false);
  const [editingAd, setEditingAd] = useState(null);
  const [parentAdSetId, setParentAdSetId] = useState(null);

  // Details modal state
  const [detailsItem, setDetailsItem] = useState(null);

  // Unified delete confirmation
  const [deleteConfirmItem, setDeleteConfirmItem] = useState(null);

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

  // Grupos state
  const [showGruposModal, setShowGruposModal] = useState(false);
  const [selectedGrupo, setSelectedGrupo] = useState(null);
  const [grupos, setGrupos] = useState([]);

  // Puntos de Venta state
  const [showPuntoDeVentaModal, setShowPuntoDeVentaModal] = useState(false);
  const [selectedPuntoDeVenta, setSelectedPuntoDeVenta] = useState(null);
  const [pointsOfSale, setPointsOfSale] = useState([]);
  const [pointsOfSaleLoading, setPointsOfSaleLoading] = useState(false);

  // Product Families state
  const [productFamilyTree, setProductFamilyTree] = useState([]);
  const [productFamiliesLoading, setProductFamiliesLoading] = useState(false);
  const [showProductFamilyModal, setShowProductFamilyModal] = useState(false);
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [productToCopy, setProductToCopy] = useState(null);
  const [productToShowDetails, setProductToShowDetails] = useState(null);
  const [productDetailsParentChain, setProductDetailsParentChain] = useState([]);
  const [importTargetFamily, setImportTargetFamily] = useState(null);
  const [selectedProductFamily, setSelectedProductFamily] = useState(null);
  const [selectedParentId, setSelectedParentId] = useState(null);
  const [deleteConfirmProductFamily, setDeleteConfirmProductFamily] = useState(null);

  const fetchMessages = async () => {
    try {
      const res = await fetch(`${API_URL}/conversations`, {
        credentials: 'include',
        headers: { Authorization: "Bearer hanlob_admin_2025" }
      });
      const data = await res.json();
      setMessages(data || []);
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
      const res = await fetch(`${API_URL}/campaigns/tree`);
      const data = await res.json();
      if (data.success) {
        console.log("Campaigns loaded:", data.data);
        console.log("Active campaigns:", data.data.filter(c => c.active === true));
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
      let response;
      if (editingCampaign) {
        response = await API.put(`/campaigns/${editingCampaign._id}`, campaignData);
      } else {
        response = await API.post(`/campaigns`, campaignData);
      }

      if (response.data.success) {
        setShowCampaignModal(false);
        setEditingCampaign(null);
        // Refetch campaigns tree to get updated structure
        fetchCampaigns();
      }
    } catch (error) {
      console.error("Error saving campaign:", error);
      alert("Error al guardar la campaña: " + (error.response?.data?.error || error.message));
    }
  };

  // AdSet handlers
  const fetchAdSets = async () => {
    try {
      const res = await fetch(`${API_URL}/adsets`);
      const data = await res.json();
      if (data.success) {
        setAdSets(data.data || []);
      }
    } catch (error) {
      console.error("Error fetching adsets:", error);
    }
  };

  const handleSaveAdSet = async (adSetData) => {
    try {
      let response;
      if (editingAdSet) {
        response = await API.put(`/adsets/${editingAdSet._id}`, adSetData);
      } else {
        response = await API.post(`/adsets`, adSetData);
      }

      if (response.data.success) {
        setShowAdSetModal(false);
        setEditingAdSet(null);
        setParentCampaignId(null);
        // Refetch campaigns tree to show new adset
        fetchCampaigns();
        fetchAdSets(); // Also update adsets list for Ad modal dropdown
      }
    } catch (error) {
      console.error("Error saving adset:", error);
      alert("Error al guardar el conjunto de anuncios: " + (error.response?.data?.error || error.message));
    }
  };

  const handleDeleteAdSet = async (adSetId) => {
    try {
      const res = await fetch(`${API_URL}/adsets/${adSetId}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (data.success) {
        fetchCampaigns();
        fetchAdSets();
      }
    } catch (error) {
      console.error("Error deleting adset:", error);
      alert("Error al eliminar el conjunto de anuncios");
    }
  };

  // Ad handlers
  const handleSaveAd = async (adData) => {
    try {
      let response;
      if (editingAd) {
        response = await API.put(`/ads/${editingAd._id}`, adData);
      } else {
        response = await API.post(`/ads`, adData);
      }

      if (response.data.success) {
        setShowAdModal(false);
        setEditingAd(null);
        setParentAdSetId(null);
        // Refetch campaigns tree to show new ad
        fetchCampaigns();
      }
    } catch (error) {
      console.error("Error saving ad:", error);
      alert("Error al guardar el anuncio: " + (error.response?.data?.error || error.message));
    }
  };

  const handleDeleteAd = async (adId) => {
    try {
      const res = await fetch(`${API_URL}/ads/${adId}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (data.success) {
        fetchCampaigns();
      }
    } catch (error) {
      console.error("Error deleting ad:", error);
      alert("Error al eliminar el anuncio");
    }
  };

  // Unified delete handler for tree view
  const handleDeleteItem = async (item) => {
    const itemType = item.type || 'campaign';

    if (itemType === 'campaign') {
      await handleDeleteCampaign(item._id);
    } else if (itemType === 'adset') {
      await handleDeleteAdSet(item._id);
    } else if (itemType === 'ad') {
      await handleDeleteAd(item._id);
    }

    setDeleteConfirmItem(null);
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

  const handleDeleteUso = async (uso) => {
    const confirmed = window.confirm(
      `¿Estás seguro de eliminar el uso "${uso.name}"?\n\nEsta acción no se puede deshacer.`
    );

    if (!confirmed) return;

    try {
      const res = await fetch(`${API_URL}/usos/${uso._id}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (data.success) {
        setUsos(usos.filter(u => u._id !== uso._id));
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

  const fetchGrupos = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/grupos`);
      const data = await res.json();
      if (data.success) {
        setGrupos(data.data || []);
      }
    } catch (error) {
      console.error("Error fetching grupos:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteGrupo = async (grupo) => {
    const confirmed = window.confirm(
      `¿Estás seguro de eliminar el grupo "${grupo.name}"?\n\nEsta acción no se puede deshacer.`
    );

    if (!confirmed) return;

    try {
      const res = await fetch(`${API_URL}/grupos/${grupo._id}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (data.success) {
        setGrupos(grupos.filter(g => g._id !== grupo._id));
      }
    } catch (error) {
      console.error("Error deleting grupo:", error);
      alert("Error al eliminar el grupo");
    }
  };

  const handleSaveGrupo = async (grupoData) => {
    try {
      const url = selectedGrupo
        ? `${API_URL}/grupos/${selectedGrupo._id}`
        : `${API_URL}/grupos`;
      const method = selectedGrupo ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(grupoData)
      });

      const data = await res.json();
      if (data.success) {
        if (selectedGrupo) {
          setGrupos(grupos.map(g => g._id === selectedGrupo._id ? data.data : g));
        } else {
          setGrupos([data.data, ...grupos]);
        }
        setShowGruposModal(false);
        setSelectedGrupo(null);
      }
    } catch (error) {
      console.error("Error saving grupo:", error);
      alert("Error al guardar el grupo");
    }
  };

  // Points of Sale CRUD functions
  const fetchPointsOfSale = async () => {
    setPointsOfSaleLoading(true);
    try {
      const res = await fetch(`${API_URL}/points-of-sale`);
      const data = await res.json();
      if (data.success) {
        setPointsOfSale(data.data || []);
      }
    } catch (error) {
      console.error("Error fetching points of sale:", error);
    } finally {
      setPointsOfSaleLoading(false);
    }
  };

  const handleDeletePuntoDeVenta = async (pos) => {
    const confirmed = window.confirm(
      `¿Estás seguro de eliminar el punto de venta "${pos.name}"?\n\nEsta acción no se puede deshacer.`
    );

    if (!confirmed) return;

    try {
      const res = await fetch(`${API_URL}/points-of-sale/${pos._id}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (data.success) {
        setPointsOfSale(pointsOfSale.filter(p => p._id !== pos._id));
      }
    } catch (error) {
      console.error("Error deleting point of sale:", error);
      alert("Error al eliminar el punto de venta");
    }
  };

  const handleSavePuntoDeVenta = async (posData) => {
    try {
      const url = selectedPuntoDeVenta
        ? `${API_URL}/points-of-sale/${selectedPuntoDeVenta._id}`
        : `${API_URL}/points-of-sale`;
      const method = selectedPuntoDeVenta ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(posData)
      });

      const data = await res.json();
      if (data.success) {
        if (selectedPuntoDeVenta) {
          setPointsOfSale(pointsOfSale.map(p => p._id === selectedPuntoDeVenta._id ? data.data : p));
        } else {
          setPointsOfSale([data.data, ...pointsOfSale]);
        }
        setShowPuntoDeVentaModal(false);
        setSelectedPuntoDeVenta(null);
      }
    } catch (error) {
      console.error("Error saving point of sale:", error);
      alert("Error al guardar el punto de venta");
    }
  };

  const fetchProductFamilies = async () => {
    setProductFamiliesLoading(true);
    try {
      const response = await API.get('/product-families/tree');
      if (response.data.success) {
        console.log('Fetched product families:', response.data.data.length, 'roots');
        setProductFamilyTree(response.data.data || []);
      }
    } catch (error) {
      console.error("Error fetching product families:", error);
    } finally {
      setProductFamiliesLoading(false);
    }
  };

  const handleSaveProductFamily = async (productFamilyData) => {
    try {
      console.log('📥 App.js received data from modal:');
      console.log('   Name:', productFamilyData.name);
      console.log('   Sellable:', productFamilyData.sellable);
      console.log('   onlineStoreLinks:', productFamilyData.onlineStoreLinks);
      console.log('   Full data:', productFamilyData);

      // Use the presence of _id to determine if this is an update (PUT) or create (POST)
      const isUpdate = selectedProductFamily && selectedProductFamily._id;
      console.log('   Is update?', isUpdate, 'ID:', selectedProductFamily?._id);

      const response = isUpdate
        ? await API.put(`/product-families/${selectedProductFamily._id}`, productFamilyData)
        : await API.post('/product-families', productFamilyData);

      if (response.data.success) {
        console.log('✅ Product family saved successfully');
        console.log('   Response data:', response.data.data);
        console.log('   onlineStoreLinks in response:', response.data.data.onlineStoreLinks);
        // Refresh the tree view
        await fetchProductFamilies();
        setShowProductFamilyModal(false);
        setSelectedProductFamily(null);
        setSelectedParentId(null);
      }
    } catch (error) {
      console.error("❌ Error saving product family:", error);
      alert("Error saving product family: " + (error.response?.data?.error || error.message));
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

  const handleCopyProduct = async (selectedChildIds, selectedParentId) => {
    if (!productToCopy) return;

    try {
      const res = await fetch(`${API_URL}/product-families/${productToCopy._id}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          childIds: selectedChildIds,
          targetParentId: selectedParentId
        })
      });

      const data = await res.json();
      if (data.success) {
        // Refresh the tree to show the copied product
        fetchProductFamilies();
        setShowCopyModal(false);
        setProductToCopy(null);
      } else {
        alert('Error al copiar producto: ' + data.error);
      }
    } catch (error) {
      console.error('Error copying product:', error);
      alert('Error al copiar producto');
    }
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
    if (location.pathname === "/campaigns" || location.pathname === "/") {
      fetchCampaigns();
      fetchAdSets(); // Also fetch adsets for Ad modal dropdown
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
    if (location.pathname === "/usos-grupos") {
      fetchUsos();
      fetchGrupos();
    }
  }, [location.pathname]);

  useEffect(() => {
    if (location.pathname === "/pos") {
      fetchPointsOfSale();
    }
  }, [location.pathname]);

  useEffect(() => {
    if (location.pathname === "/familias") {
      fetchProductFamilies();
    }
  }, [location.pathname]);

  // Auth checks - must be AFTER all hooks
  // Show login page if not authenticated (except for login route)
  if (!authLoading && !user && location.pathname !== '/login') {
    return <Login />;
  }

  // If on login page but authenticated, redirect to home
  if (!authLoading && user && location.pathname === '/login') {
    navigate('/');
    return null;
  }

  // Show loading while checking auth
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-primary-500 mx-auto"></div>
          <p className="mt-4 text-gray-400">Cargando...</p>
        </div>
      </div>
    );
  }

  // Filter menu items based on user permissions
  const filteredMenuItems = menuItems.filter(item => {
    // Users section only visible to super_admin and admin
    if (item.id === 'users') {
      return canManageUsers();
    }
    // Roles and Profiles sections only visible to super_admin
    if (item.id === 'roles' || item.id === 'profiles') {
      return user?.role === 'super_admin';
    }

    // For items with children, check if user has access to ANY child
    if (item.children && item.children.length > 0) {
      const accessibleChildren = item.children.filter(child => canAccess(child.id));
      return accessibleChildren.length > 0;
    }

    // Filter other sections based on canAccess
    return canAccess(item.id);
  }).map(item => {
    // If item has children, filter them based on permissions
    if (item.children && item.children.length > 0) {
      return {
        ...item,
        children: item.children.filter(child => canAccess(child.id))
      };
    }
    return item;
  });

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

  // Count active campaigns
  const activeCampaigns = campaigns.filter((c) => c.active === true).length;
  console.log("Campaigns state:", campaigns);
  console.log("Active campaigns count:", activeCampaigns);

  let filteredMessages = messages;

  // Apply sender type filter
  if (filter !== "all") {
    filteredMessages = filteredMessages.filter((msg) => msg.senderType === filter);
  }

  // Apply conversation filter (by PSID)
  if (conversationFilter) {
    filteredMessages = filteredMessages.filter((msg) => msg.psid === conversationFilter);
  }

  // Group messages by PSID to show only the latest message per conversation
  const latestMessagesByConversation = filteredMessages.reduce((acc, msg) => {
    if (!acc[msg.psid] || new Date(msg.timestamp) > new Date(acc[msg.psid].timestamp)) {
      acc[msg.psid] = msg;
    }
    return acc;
  }, {});

  // Get 10 most recent conversations
  filteredMessages = Object.values(latestMessagesByConversation)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 10);

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
      {/* Toast Notifications */}
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#1f2937',
            color: '#f3f4f6',
            border: '1px solid #374151',
          },
          success: {
            iconTheme: {
              primary: '#10b981',
              secondary: '#f3f4f6',
            },
          },
          error: {
            iconTheme: {
              primary: '#ef4444',
              secondary: '#f3f4f6',
            },
          },
        }}
      />
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
            {filteredMenuItems.map((item) => {
              // Expandable section
              if (item.isExpandable && item.children) {
                const isExpanded = expandedSections[item.id];
                return (
                  <div key={item.id} className="space-y-1">
                    {/* Section Header */}
                    <button
                      onClick={() => setExpandedSections(prev => ({ ...prev, [item.id]: !prev[item.id] }))}
                      className="w-full flex items-center justify-between px-4 py-3 rounded-lg text-gray-300 hover:bg-gray-800/50 hover:text-white transition-all"
                    >
                      <div className="flex items-center space-x-3">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          {item.icon}
                        </svg>
                        <span className="font-medium">{item.label}</span>
                      </div>
                      <svg
                        className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {/* Submenu Items */}
                    {isExpanded && (
                      <div className="ml-4 space-y-1 border-l-2 border-gray-700/50 pl-2">
                        {item.children.map((child) => (
                          <NavLink
                            key={child.id}
                            to={child.path}
                            onClick={() => setSidebarOpen(false)}
                            className={({ isActive }) => `w-full flex items-center space-x-3 px-4 py-2 rounded-lg transition-all text-sm ${
                              isActive
                                ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30'
                                : 'text-gray-400 hover:bg-gray-800/50 hover:text-white'
                            }`}
                            end={child.path === "/"}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              {child.icon}
                            </svg>
                            <span className="font-medium">{child.label}</span>
                          </NavLink>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }

              // Regular menu item
              return (
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
              );
            })}
          </nav>

          {/* Sidebar Footer */}
          <div className="p-4 border-t border-gray-700/50 space-y-3">
            {/* User Info */}
            <div className="bg-gray-800/50 rounded-lg p-3">
              <div className="flex items-center space-x-3 mb-2">
                <div className="w-10 h-10 bg-primary-500/20 rounded-full flex items-center justify-center">
                  <span className="text-primary-400 font-semibold">
                    {user?.firstName?.[0]}{user?.lastName?.[0]}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{user?.fullName}</p>
                  <p className="text-xs text-gray-400 truncate">{user?.roleLabel}</p>
                  {user?.profileLabel && (
                    <p className="text-xs text-gray-500 truncate">{user?.profileLabel}</p>
                  )}
                </div>
              </div>
              <button
                onClick={logout}
                className="w-full flex items-center justify-center space-x-2 px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors text-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span>Cerrar Sesión</span>
              </button>
            </div>

            {/* Live Indicator */}
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
          {/* Login Route (Public) */}
          <Route path="/login" element={<Login />} />

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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6 mb-8">
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

          {/* Active Campaigns */}
          <button
            onClick={() => {
              navigate("/campaigns");
            }}
            className="bg-gradient-to-br from-green-500/10 to-green-600/5 backdrop-blur-lg border border-green-500/20 rounded-xl p-6 hover:from-green-500/20 hover:to-green-600/10 transition-all cursor-pointer text-left w-full"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-400 mb-1">Campañas Activas</p>
                <h3 className="text-3xl font-bold text-white">{activeCampaigns}</h3>
              </div>
              <div className="w-12 h-12 bg-green-500/20 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
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
            <h2 className="text-xl font-bold text-white">Conversaciones Recientes - Últimas 10</h2>
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
            <CampaignTreeView
              campaigns={campaigns}
              loading={campaignsLoading}
              editingItem={editingCampaign}
              onAdd={() => {
                setEditingCampaign(null);
                setShowCampaignModal(true);
              }}
              onEdit={(item) => {
                console.log('🔍 Edit clicked - Item:', item);
                console.log('🔍 Item type:', item.type);
                console.log('🔍 Item name:', item.name);
                console.log('🔍 Has fbAdId?', !!item.fbAdId);
                console.log('🔍 Has adSetId?', !!item.adSetId);

                const itemType = item.type || 'campaign';
                console.log('🔍 Determined type:', itemType);

                if (itemType === 'campaign') {
                  console.log('✅ Opening Campaign modal');
                  setEditingCampaign(item);
                  setShowCampaignModal(true);
                } else if (itemType === 'adset') {
                  console.log('✅ Opening AdSet modal');
                  setEditingAdSet(item);
                  setShowAdSetModal(true);
                } else if (itemType === 'ad') {
                  console.log('✅ Opening Ad modal');
                  setEditingAd(item);
                  setShowAdModal(true);
                }
              }}
              onDelete={(item) => {
                setDeleteConfirmItem(item);
              }}
              onAddChild={(parent) => {
                const parentType = parent.type || 'campaign';
                if (parentType === 'campaign') {
                  // Add adset to campaign
                  setParentCampaignId(parent._id);
                  setEditingAdSet(null);
                  setShowAdSetModal(true);
                } else if (parentType === 'adset') {
                  // Add ad to adset
                  setParentAdSetId(parent._id);
                  setEditingAd(null);
                  setShowAdModal(true);
                }
              }}
              onDetails={(item) => {
                setDetailsItem(item);
              }}
            />
          } />

          {/* AdSets Route */}
          <Route path="/adsets" element={<AdSetsView />} />

          {/* Ads Route */}
          <Route path="/ads" element={<AdsView />} />

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

          {/* Usos y Grupos Route */}
          <Route path="/usos-grupos" element={
            <UsosYGruposView
              usos={usos}
              usosLoading={loading}
              onAddUso={() => {
                setSelectedUso(null);
                setShowUsosModal(true);
              }}
              onEditUso={(uso) => {
                setSelectedUso(uso);
                setShowUsosModal(true);
              }}
              onDeleteUso={(uso) => handleDeleteUso(uso)}
              grupos={grupos}
              gruposLoading={loading}
              onAddGrupo={() => {
                setSelectedGrupo(null);
                setShowGruposModal(true);
              }}
              onEditGrupo={(grupo) => {
                setSelectedGrupo(grupo);
                setShowGruposModal(true);
              }}
              onDeleteGrupo={(grupo) => handleDeleteGrupo(grupo)}
            />
          } />

          {/* Puntos de Venta Route */}
          <Route path="/pos" element={
            <PuntosDeVentaView
              pointsOfSale={pointsOfSale}
              loading={pointsOfSaleLoading}
              onAdd={() => {
                setSelectedPuntoDeVenta(null);
                setShowPuntoDeVentaModal(true);
              }}
              onEdit={(pos) => {
                setSelectedPuntoDeVenta(pos);
                setShowPuntoDeVentaModal(true);
              }}
              onDelete={(pos) => handleDeletePuntoDeVenta(pos)}
            />
          } />

          {/* Familias Route */}
          <Route path="/familias" element={
            <ProductFamilyTreeView
              products={productFamilyTree}
              loading={productFamiliesLoading}
              editingProduct={selectedProductFamily}
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
                setProductToCopy(product);
                setShowCopyModal(true);
              }}
              onImport={(product) => {
                setImportTargetFamily(product);
                setShowImportModal(true);
              }}
              onDetails={(product, parentChain = []) => {
                setProductToShowDetails(product);
                setProductDetailsParentChain(parentChain);
                setShowDetailsModal(true);
              }}
            />
          } />

          {/* Inventario Route */}
          <Route path="/inventario" element={<InventarioView />} />

          {/* Users, Roles, and Profiles Routes */}
          <Route path="/users" element={<UsersView />} />
          <Route path="/roles" element={<RolesView />} />
          <Route path="/profiles" element={<ProfilesView />} />
          <Route path="/click-logs" element={<ClickLogsView />} />
          <Route path="/conversions" element={<ConversionsView />} />

          {/* Mercado Libre Routes */}
          <Route path="/ml-orders" element={<OrdersView />} />

          <Route path="/settings" element={<Settings />} />
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

        {/* Campaign Delete Confirmation Modal (legacy - kept for other campaign delete flows) */}
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

        {/* AdSet Modal */}
        {showAdSetModal && (
          <AdSetModal
            adSet={editingAdSet}
            campaigns={campaigns}
            parentCampaignId={parentCampaignId}
            onSave={handleSaveAdSet}
            onClose={() => {
              setShowAdSetModal(false);
              setEditingAdSet(null);
              setParentCampaignId(null);
            }}
          />
        )}

        {/* Ad Modal */}
        {showAdModal && (
          <AdModal
            ad={editingAd}
            adSets={adSets}
            parentAdSetId={parentAdSetId}
            onSave={handleSaveAd}
            onClose={() => {
              setShowAdModal(false);
              setEditingAd(null);
              setParentAdSetId(null);
            }}
          />
        )}

        {/* Campaign Item Details Modal */}
        {detailsItem && (
          <CampaignItemDetailsModal
            item={detailsItem}
            onClose={() => setDetailsItem(null)}
          />
        )}

        {/* Unified Delete Confirmation Modal for Campaigns/AdSets/Ads */}
        {deleteConfirmItem && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-md w-full p-6">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center">
                  <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Confirmar Eliminación</h3>
                  <p className="text-sm text-gray-400">Esta acción no se puede deshacer</p>
                </div>
              </div>
              <p className="text-gray-300 mb-6">
                ¿Estás seguro de que deseas eliminar "{deleteConfirmItem.name || 'este elemento'}"?
              </p>
              <div className="flex space-x-2">
                <button
                  onClick={() => setDeleteConfirmItem(null)}
                  className="flex-1 px-4 py-2 bg-gray-700/50 text-white rounded-lg hover:bg-gray-600/50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => handleDeleteItem(deleteConfirmItem)}
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

        {/* Campaign Tree Modals */}
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

        {/* AdSet Modal */}
        {showAdSetModal && (
          <AdSetModal
            adSet={editingAdSet}
            campaigns={campaigns}
            parentCampaignId={parentCampaignId}
            onSave={handleSaveAdSet}
            onClose={() => {
              setShowAdSetModal(false);
              setEditingAdSet(null);
              setParentCampaignId(null);
            }}
          />
        )}

        {/* Ad Modal */}
        {showAdModal && (
          <AdModal
            ad={editingAd}
            adSets={adSets}
            parentAdSetId={parentAdSetId}
            onSave={handleSaveAd}
            onClose={() => {
              setShowAdModal(false);
              setEditingAd(null);
              setParentAdSetId(null);
            }}
          />
        )}

        {/* Campaign Item Details Modal */}
        {detailsItem && (
          <CampaignItemDetailsModal
            item={detailsItem}
            onClose={() => setDetailsItem(null)}
          />
        )}

        {/* Campaign Tree Delete Confirmation Modal */}
        {deleteConfirmItem && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-gray-800/95 backdrop-blur-lg border border-gray-700/50 rounded-xl max-w-md w-full p-6">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center">
                  <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">
                    Eliminar {deleteConfirmItem.type === 'campaign' ? 'Campaña' : deleteConfirmItem.type === 'adset' ? 'Ad Set' : 'Anuncio'}
                  </h3>
                  <p className="text-sm text-gray-400">Esta acción no se puede deshacer</p>
                </div>
              </div>
              <p className="text-gray-300 mb-6">
                ¿Estás seguro de que deseas eliminar <span className="font-semibold text-white">{deleteConfirmItem.name}</span>?
                {deleteConfirmItem.type === 'campaign' && ' Esto también eliminará todos los ad sets y anuncios asociados.'}
                {deleteConfirmItem.type === 'adset' && ' Esto también eliminará todos los anuncios asociados.'}
              </p>
              <div className="flex space-x-2">
                <button
                  onClick={() => setDeleteConfirmItem(null)}
                  className="flex-1 px-4 py-2 bg-gray-700/50 text-white rounded-lg hover:bg-gray-600/50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => handleDeleteItem(deleteConfirmItem)}
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

        {/* Grupos Modal */}
        {showGruposModal && (
          <GruposModal
            grupo={selectedGrupo}
            onSave={handleSaveGrupo}
            onClose={() => {
              setShowGruposModal(false);
              setSelectedGrupo(null);
            }}
          />
        )}

        {/* Punto de Venta Modal */}
        {showPuntoDeVentaModal && (
          <PuntoDeVentaModal
            puntoDeVenta={selectedPuntoDeVenta}
            onSave={handleSavePuntoDeVenta}
            onClose={() => {
              setShowPuntoDeVentaModal(false);
              setSelectedPuntoDeVenta(null);
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
              fetchProductFamilies(); // Refresh data after modal closes (needed for propagation)
            }}
          />
        )}

        {/* Copy Product Modal */}
        {showCopyModal && productToCopy && (
          <CopyProductModal
            product={productToCopy}
            onConfirm={handleCopyProduct}
            onCancel={() => {
              setShowCopyModal(false);
              setProductToCopy(null);
            }}
          />
        )}

        {/* Product Details Modal */}
        {showDetailsModal && productToShowDetails && (
          <ProductDetailsModal
            product={productToShowDetails}
            parentChain={productDetailsParentChain}
            onClose={() => {
              setShowDetailsModal(false);
              setProductToShowDetails(null);
              setProductDetailsParentChain([]);
            }}
          />
        )}

        {/* Import Products Modal */}
        {showImportModal && importTargetFamily && (
          <ImportProductsModal
            targetFamily={importTargetFamily}
            onClose={() => {
              setShowImportModal(false);
              setImportTargetFamily(null);
            }}
            onImport={() => {
              setShowImportModal(false);
              setImportTargetFamily(null);
              fetchProductFamilies();
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
