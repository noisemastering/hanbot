import React, { useState, useEffect, useCallback } from "react";
import API from "../api";

const COLORS = {
  blue: "#3B82F6",
  green: "#10B981",
  amber: "#F59E0B",
};

function TrackedLinksView() {
  // Link generator state
  const [linkUrl, setLinkUrl] = useState("");
  const [linkProductName, setLinkProductName] = useState("");
  const [selectedAdId, setSelectedAdId] = useState("");
  const [adsList, setAdsList] = useState([]);
  const [generatedLink, setGeneratedLink] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  // Source breakdown
  const [sourceBreakdown, setSourceBreakdown] = useState([]);
  const [loading, setLoading] = useState(true);

  // Recent direct-ad links
  const [recentLinks, setRecentLinks] = useState([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [sourceRes, adsRes, recentRes] = await Promise.all([
        API.get("/click-logs/by-source"),
        API.get("/ads"),
        API.get("/click-logs?source=direct_ad&limit=20"),
      ]);
      setSourceBreakdown(sourceRes.data?.sources || []);
      setAdsList(adsRes.data?.data || []);
      setRecentLinks(recentRes.data?.clickLogs || []);
    } catch (err) {
      console.error("Error fetching data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const generateDirectAdLink = async () => {
    if (!linkUrl) return;
    setGenerating(true);
    try {
      const ad = adsList.find(a => a._id === selectedAdId);
      const res = await API.post("/click-logs/generate", {
        originalUrl: linkUrl,
        productName: linkProductName || null,
        adId: ad?.fbAdId || null,
        adSetId: ad?.adSetId?.fbAdSetId || null,
        campaignId: ad?.adSetId?.campaignId?.ref || null,
        source: "direct_ad"
      });
      setGeneratedLink(res.data.clickLog.trackedUrl);
      setCopySuccess(false);
      // Refresh recent links
      const recentRes = await API.get("/click-logs?source=direct_ad&limit=20");
      setRecentLinks(recentRes.data?.clickLogs || []);
    } catch (err) {
      console.error("Error generating link:", err);
    } finally {
      setGenerating(false);
    }
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400"></div>
          <p className="mt-4 text-gray-400">Cargando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-white">Links de seguimiento</h1>

      {/* Link Generator */}
      <div className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white">Generar link para anuncio directo</h2>
          <p className="text-sm text-gray-500">Para anuncios con CTA directo (sin Messenger). El link rastrea clicks y los asocia al anuncio.</p>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">URL destino *</label>
              <input
                type="url"
                value={linkUrl}
                onChange={e => setLinkUrl(e.target.value)}
                placeholder="https://articulo.mercadolibre.com.mx/..."
                className="w-full bg-gray-900/50 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Producto (opcional)</label>
              <input
                type="text"
                value={linkProductName}
                onChange={e => setLinkProductName(e.target.value)}
                placeholder="Malla sombra 90%"
                className="w-full bg-gray-900/50 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Anuncio (opcional)</label>
              <select
                value={selectedAdId}
                onChange={e => setSelectedAdId(e.target.value)}
                className="w-full bg-gray-900/50 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="">Sin anuncio</option>
                {adsList.map(ad => (
                  <option key={ad._id} value={ad._id}>
                    {ad.name}{ad.adSetId?.campaignId?.name ? ` — ${ad.adSetId.campaignId.name}` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={generateDirectAdLink}
              disabled={!linkUrl || generating}
              className="bg-green-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-all"
            >
              {generating ? "Generando..." : "Generar link"}
            </button>

            {generatedLink && (
              <div className="flex items-center gap-2 flex-1">
                <input
                  type="text"
                  value={generatedLink}
                  readOnly
                  className="flex-1 bg-gray-900 border border-green-500/50 rounded-lg px-3 py-2 text-green-400 text-sm font-mono"
                />
                <button
                  onClick={() => copyToClipboard(generatedLink)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    copySuccess
                      ? "bg-green-600 text-white"
                      : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  }`}
                >
                  {copySuccess ? "Copiado" : "Copiar"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Source Breakdown */}
      {sourceBreakdown.length > 0 && (
        <div className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl">
          <div className="px-6 py-4 border-b border-gray-700/50">
            <h2 className="text-lg font-semibold text-white">Ventas por canal</h2>
            <p className="text-sm text-gray-500">Messenger vs WhatsApp vs Anuncios directos</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-900/50">
                <tr className="text-left text-xs text-gray-400 uppercase">
                  <th className="px-6 py-3">Canal</th>
                  <th className="px-4 py-3 text-right">Links</th>
                  <th className="px-4 py-3 text-right">Clicks</th>
                  <th className="px-4 py-3 text-right">Click Rate</th>
                  <th className="px-4 py-3 text-right">Conv.</th>
                  <th className="px-4 py-3 text-right">Conv. Rate</th>
                  <th className="px-4 py-3 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {sourceBreakdown.map(s => (
                  <tr key={s.source} className="hover:bg-gray-700/20">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{
                          backgroundColor: s.source === "direct_ad" ? COLORS.amber : s.source === "whatsapp" ? COLORS.green : COLORS.blue
                        }} />
                        <span className="text-sm text-white font-medium">{s.label}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-300">{s.links.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-sm text-white font-medium">{s.clicks.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-sm text-gray-300">{s.clickRate}%</td>
                    <td className="px-4 py-3 text-right text-sm text-green-400 font-medium">{s.conversions}</td>
                    <td className="px-4 py-3 text-right text-sm text-gray-300">{s.conversionRate}%</td>
                    <td className="px-4 py-3 text-right text-sm text-white">${s.revenue.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Direct Ad Links */}
      <div className="bg-gray-800/50 backdrop-blur-lg border border-gray-700/50 rounded-xl">
        <div className="px-6 py-4 border-b border-gray-700/50">
          <h2 className="text-lg font-semibold text-white">Links directos recientes</h2>
        </div>
        <div className="overflow-x-auto">
          {recentLinks.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No hay links directos generados</p>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-900/50">
                <tr className="text-left text-xs text-gray-400 uppercase">
                  <th className="px-6 py-3">Producto</th>
                  <th className="px-4 py-3">URL destino</th>
                  <th className="px-4 py-3 text-center">Click</th>
                  <th className="px-4 py-3 text-center">Conv.</th>
                  <th className="px-4 py-3">Creado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {recentLinks.map(link => (
                  <tr key={link.clickId} className="hover:bg-gray-700/20">
                    <td className="px-6 py-3 text-sm text-white">{link.productName || "—"}</td>
                    <td className="px-4 py-3 text-sm text-gray-400 truncate max-w-[250px]">{link.originalUrl}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block w-2 h-2 rounded-full ${link.clicked ? "bg-green-400" : "bg-gray-600"}`} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block w-2 h-2 rounded-full ${link.converted ? "bg-green-400" : "bg-gray-600"}`} />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {new Date(link.createdAt).toLocaleDateString("es-MX", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default TrackedLinksView;
