import React, { useState, useEffect } from "react";
import { useTranslation } from "../i18n";
import API from "../api";

function TrackedLinkGenerator({ psid, onClose }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState('product'); // 'product' | 'custom'
  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [trackedLink, setTrackedLink] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const [customUrl, setCustomUrl] = useState("");
  const [customProductName, setCustomProductName] = useState("");

  // Fetch products when search term changes (only in product mode)
  useEffect(() => {
    if (mode !== 'product') return;

    const fetchProducts = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = searchTerm ? `?search=${encodeURIComponent(searchTerm)}` : "";
        const res = await API.get(`/click-logs/products${params}`);
        if (res.data.success) {
          setProducts(res.data.products);
        }
      } catch (err) {
        console.error("Error fetching products:", err);
        setError(t('trackedLink.errorLoad'));
      } finally {
        setLoading(false);
      }
    };

    const debounce = setTimeout(fetchProducts, 300);
    return () => clearTimeout(debounce);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, mode]);

  // Generate tracked link
  const handleGenerateLink = async () => {
    if (mode === 'product' && !selectedProduct) return;
    if (mode === 'custom' && !customUrl.trim()) return;

    setGenerating(true);
    setError(null);
    try {
      const body = mode === 'product'
        ? {
            psid,
            productId: selectedProduct._id,
            productName: selectedProduct.name,
            originalUrl: selectedProduct.originalUrl
          }
        : {
            psid,
            originalUrl: customUrl.trim(),
            productName: customProductName.trim() || t('trackedLink.customDefault')
          };

      const res = await API.post("/click-logs/generate", body);

      if (res.data.success) {
        setTrackedLink(res.data.clickLog.trackedUrl);
        setCopied(false);
      } else {
        setError(res.data.error || t('trackedLink.errorGenerate'));
      }
    } catch (err) {
      console.error("Error generating link:", err);
      setError(t('trackedLink.errorGenerate'));
    } finally {
      setGenerating(false);
    }
  };

  // Copy to clipboard
  const handleCopy = async () => {
    if (!trackedLink) return;

    try {
      await navigator.clipboard.writeText(trackedLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Error copying:", err);
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = trackedLink;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Select a product
  const handleSelectProduct = (product) => {
    setSelectedProduct(product);
    setTrackedLink(null);
    setCopied(false);
  };

  // Switch mode
  const handleModeSwitch = (newMode) => {
    setMode(newMode);
    setTrackedLink(null);
    setCopied(false);
    setError(null);
  };

  const canGenerate = mode === 'product' ? !!selectedProduct : !!customUrl.trim();

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        backgroundColor: "#252525",
        borderRadius: "8px",
        padding: "1rem",
        marginTop: "1rem",
        border: "1px solid #3a3a3a"
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h4 style={{ margin: 0, color: "white", fontSize: "1rem" }}>
          {t('trackedLink.generateTitle')}
        </h4>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "#888",
            cursor: "pointer",
            fontSize: "1.2rem"
          }}
        >
          &times;
        </button>
      </div>

      {/* Mode Tabs */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <button
          onClick={() => handleModeSwitch('product')}
          style={{
            flex: 1,
            padding: "0.5rem",
            borderRadius: "4px",
            border: mode === 'product' ? "2px solid #2196f3" : "1px solid #3a3a3a",
            backgroundColor: mode === 'product' ? "#1a3a5f" : "#1a1a1a",
            color: mode === 'product' ? "#64b5f6" : "#888",
            cursor: "pointer",
            fontWeight: mode === 'product' ? "bold" : "normal",
            fontSize: "0.85rem"
          }}
        >
          {t('trackedLink.modeProduct')}
        </button>
        <button
          onClick={() => handleModeSwitch('custom')}
          style={{
            flex: 1,
            padding: "0.5rem",
            borderRadius: "4px",
            border: mode === 'custom' ? "2px solid #ff9800" : "1px solid #3a3a3a",
            backgroundColor: mode === 'custom' ? "#3d2900" : "#1a1a1a",
            color: mode === 'custom' ? "#ffb74d" : "#888",
            cursor: "pointer",
            fontWeight: mode === 'custom' ? "bold" : "normal",
            fontSize: "0.85rem"
          }}
        >
          {t('trackedLink.modeCustom')}
        </button>
      </div>

      {/* Product Mode */}
      {mode === 'product' && (
        <>
          {/* Search Input */}
          <input
            type="text"
            placeholder={t('trackedLink.searchProduct')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: "100%",
              padding: "0.5rem",
              borderRadius: "4px",
              border: "1px solid #3a3a3a",
              backgroundColor: "#1a1a1a",
              color: "white",
              marginBottom: "0.5rem",
              boxSizing: "border-box"
            }}
          />

          {/* Products List */}
          <div
            style={{
              maxHeight: "150px",
              overflowY: "auto",
              marginBottom: "1rem",
              border: "1px solid #3a3a3a",
              borderRadius: "4px"
            }}
          >
            {loading ? (
              <div style={{ padding: "1rem", color: "#888", textAlign: "center" }}>
                {t('trackedLink.loadingProducts')}
              </div>
            ) : products.length === 0 ? (
              <div style={{ padding: "1rem", color: "#888", textAlign: "center" }}>
                {t('trackedLink.noProducts')}
              </div>
            ) : (
              products.map((product) => (
                <div
                  key={product._id}
                  onClick={() => handleSelectProduct(product)}
                  style={{
                    padding: "0.75rem",
                    borderBottom: "1px solid #3a3a3a",
                    cursor: "pointer",
                    backgroundColor: selectedProduct?._id === product._id ? "#3a5a3a" : "transparent",
                    transition: "background-color 0.2s"
                  }}
                  onMouseEnter={(e) => {
                    if (selectedProduct?._id !== product._id) {
                      e.currentTarget.style.backgroundColor = "#2a2a2a";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (selectedProduct?._id !== product._id) {
                      e.currentTarget.style.backgroundColor = "transparent";
                    }
                  }}
                >
                  <div style={{ fontWeight: "bold", color: "white", fontSize: "0.9rem" }}>
                    {product.name}
                  </div>
                  {product.description && (
                    <div style={{ fontSize: "0.75rem", color: "#888", marginTop: "0.25rem" }}>
                      {product.description.substring(0, 80)}...
                    </div>
                  )}
                  {product.price && (
                    <div style={{ fontSize: "0.8rem", color: "#4caf50", marginTop: "0.25rem" }}>
                      ${product.price}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Selected Product Details */}
          {selectedProduct && (
            <div
              style={{
                backgroundColor: "#1a1a1a",
                padding: "0.75rem",
                borderRadius: "4px",
                marginBottom: "1rem"
              }}
            >
              <div style={{ display: "flex", gap: "0.75rem" }}>
                {selectedProduct.imageUrl && (
                  <img
                    src={selectedProduct.imageUrl}
                    alt={selectedProduct.name}
                    style={{
                      width: "60px",
                      height: "60px",
                      objectFit: "cover",
                      borderRadius: "4px"
                    }}
                  />
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: "bold", color: "white", fontSize: "0.9rem" }}>
                    {selectedProduct.name}
                  </div>
                  {selectedProduct.description && (
                    <div style={{ fontSize: "0.75rem", color: "#888", marginTop: "0.25rem" }}>
                      {selectedProduct.description.substring(0, 100)}...
                    </div>
                  )}
                  {selectedProduct.price && (
                    <div style={{ fontSize: "0.85rem", color: "#4caf50", marginTop: "0.25rem" }}>
                      ${selectedProduct.price}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Custom URL Mode */}
      {mode === 'custom' && (
        <>
          <input
            type="url"
            placeholder={t('trackedLink.customUrlPlaceholder')}
            value={customUrl}
            onChange={(e) => { setCustomUrl(e.target.value); setTrackedLink(null); setCopied(false); }}
            style={{
              width: "100%",
              padding: "0.5rem",
              borderRadius: "4px",
              border: "1px solid #3a3a3a",
              backgroundColor: "#1a1a1a",
              color: "white",
              marginBottom: "0.5rem",
              boxSizing: "border-box"
            }}
          />
          <input
            type="text"
            placeholder={t('trackedLink.customNamePlaceholder')}
            value={customProductName}
            onChange={(e) => setCustomProductName(e.target.value)}
            style={{
              width: "100%",
              padding: "0.5rem",
              borderRadius: "4px",
              border: "1px solid #3a3a3a",
              backgroundColor: "#1a1a1a",
              color: "white",
              marginBottom: "0.25rem",
              boxSizing: "border-box"
            }}
          />
          <div style={{ fontSize: "0.7rem", color: "#666", marginBottom: "1rem" }}>
            {t('trackedLink.customNameHint')}
          </div>
        </>
      )}

      {/* Generate Button */}
      {canGenerate && !trackedLink && (
        <button
          onClick={handleGenerateLink}
          disabled={generating}
          style={{
            width: "100%",
            padding: "0.75rem",
            backgroundColor: "#2196f3",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: generating ? "not-allowed" : "pointer",
            opacity: generating ? 0.6 : 1,
            fontWeight: "bold"
          }}
        >
          {generating ? t('trackedLink.generating') : t('trackedLink.generateBtn')}
        </button>
      )}

      {/* Generated Link with Copy Button */}
      {trackedLink && (
        <div style={{ marginTop: "0.5rem" }}>
          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              alignItems: "stretch"
            }}
          >
            <input
              type="text"
              value={trackedLink}
              readOnly
              style={{
                flex: 1,
                padding: "0.75rem",
                borderRadius: "4px",
                border: "1px solid #4caf50",
                backgroundColor: "#1a3a1a",
                color: "white",
                fontSize: "0.85rem"
              }}
            />
            <button
              onClick={handleCopy}
              style={{
                padding: "0.75rem 1rem",
                backgroundColor: copied ? "#4caf50" : "#ff9800",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontWeight: "bold",
                whiteSpace: "nowrap",
                minWidth: "100px"
              }}
            >
              {copied ? t('trackedLink.copiedBtn') : t('trackedLink.copyBtn')}
            </button>
          </div>
          <div style={{ fontSize: "0.75rem", color: "#888", marginTop: "0.5rem" }}>
            {t('trackedLink.pasteHint')}
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div
          style={{
            marginTop: "0.5rem",
            padding: "0.5rem",
            backgroundColor: "#5a1a1a",
            border: "1px solid #f44336",
            borderRadius: "4px",
            color: "#f44336",
            fontSize: "0.85rem"
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

export default TrackedLinkGenerator;
