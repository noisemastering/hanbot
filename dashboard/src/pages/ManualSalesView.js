import React, { useState, useEffect, useCallback } from "react";
import API from "../api";
import { useTranslation } from "../i18n";

function ManualSalesView() {
  const { t, locale } = useTranslation();
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const fetchSales = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        correlationMethod: "manual",
        converted: "true",
        page: String(page),
        limit: "30"
      });
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);

      const res = await API.get(`/click-logs?${params}`);
      if (res.data.success) {
        setSales(res.data.clickLogs);
        setTotal(res.data.pagination?.total || 0);
        setTotalPages(res.data.pagination?.pages || 1);
      }
    } catch (err) {
      console.error("Error fetching manual sales:", err);
    } finally {
      setLoading(false);
    }
  }, [page, startDate, endDate]);

  useEffect(() => {
    fetchSales();
  }, [fetchSales]);

  // Compute summary stats
  const totalRevenue = sales.reduce((sum, s) => sum + (s.conversionData?.totalAmount || 0), 0);

  // Get current month sales from loaded data
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thisMonthSales = sales.filter(s => new Date(s.createdAt) >= monthStart);
  const thisMonthRevenue = thisMonthSales.reduce((sum, s) => sum + (s.conversionData?.totalAmount || 0), 0);

  return (
    <div>
      <h2 style={{ color: "white", marginBottom: "1.5rem", fontSize: "1.5rem", fontWeight: "bold" }}>
        {t('manualSales.title')}
      </h2>

      {/* Summary Cards */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        <div style={{
          flex: 1,
          minWidth: "180px",
          backgroundColor: "#252525",
          borderRadius: "8px",
          padding: "1rem",
          border: "1px solid #3a3a3a"
        }}>
          <div style={{ color: "#888", fontSize: "0.8rem", marginBottom: "0.5rem" }}>
            {t('manualSales.totalSales')}
          </div>
          <div style={{ color: "white", fontSize: "1.5rem", fontWeight: "bold" }}>
            {total}
          </div>
        </div>
        <div style={{
          flex: 1,
          minWidth: "180px",
          backgroundColor: "#252525",
          borderRadius: "8px",
          padding: "1rem",
          border: "1px solid #3a3a3a"
        }}>
          <div style={{ color: "#888", fontSize: "0.8rem", marginBottom: "0.5rem" }}>
            {t('manualSales.totalRevenue')}
          </div>
          <div style={{ color: "#4caf50", fontSize: "1.5rem", fontWeight: "bold" }}>
            ${totalRevenue.toLocaleString()}
          </div>
        </div>
        <div style={{
          flex: 1,
          minWidth: "180px",
          backgroundColor: "#252525",
          borderRadius: "8px",
          padding: "1rem",
          border: "1px solid #3a3a3a"
        }}>
          <div style={{ color: "#888", fontSize: "0.8rem", marginBottom: "0.5rem" }}>
            {t('manualSales.thisMonth')}
          </div>
          <div style={{ color: "#ff9800", fontSize: "1.5rem", fontWeight: "bold" }}>
            {thisMonthSales.length} - ${thisMonthRevenue.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Date Filters */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <label style={{ color: "#888", fontSize: "0.8rem", marginRight: "0.5rem" }}>
            {t('manualSales.from')}
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
            style={{
              padding: "6px 10px",
              borderRadius: "4px",
              border: "1px solid #3a3a3a",
              backgroundColor: "#1a1a1a",
              color: "white"
            }}
          />
        </div>
        <div>
          <label style={{ color: "#888", fontSize: "0.8rem", marginRight: "0.5rem" }}>
            {t('manualSales.to')}
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
            style={{
              padding: "6px 10px",
              borderRadius: "4px",
              border: "1px solid #3a3a3a",
              backgroundColor: "#1a1a1a",
              color: "white"
            }}
          />
        </div>
        {(startDate || endDate) && (
          <button
            onClick={() => { setStartDate(""); setEndDate(""); setPage(1); }}
            style={{
              padding: "6px 12px",
              backgroundColor: "#666",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "0.85rem"
            }}
          >
            {t('manualSales.clearFilter')}
          </button>
        )}
      </div>

      {/* Sales Table */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "2rem", color: "#888" }}>
          {t('common.loading')}
        </div>
      ) : sales.length === 0 ? (
        <div style={{ textAlign: "center", padding: "2rem", color: "#888" }}>
          {t('manualSales.noSales')}
        </div>
      ) : (
        <>
          <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #555" }}>
            <thead>
              <tr style={{ backgroundColor: "#1b3a1b", color: "lightgreen" }}>
                <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #555" }}>{t('manualSales.colDate')}</th>
                <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #555" }}>{t('manualSales.colCustomer')}</th>
                <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #555" }}>{t('manualSales.colProduct')}</th>
                <th style={{ padding: "10px", textAlign: "right", borderBottom: "2px solid #555" }}>{t('manualSales.colAmount')}</th>
                <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #555" }}>{t('manualSales.colCampaign')}</th>
                <th style={{ padding: "10px", textAlign: "left", borderBottom: "2px solid #555" }}>{t('manualSales.colNotes')}</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => (
                <tr key={sale._id} style={{ borderBottom: "1px solid #555" }}>
                  <td style={{ padding: "10px", color: "#e0e0e0", fontSize: "0.85rem" }}>
                    {new Date(sale.createdAt).toLocaleString(locale, {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                    })}
                  </td>
                  <td style={{ padding: "10px", color: "#e0e0e0", fontSize: "0.85rem" }}>
                    {sale.userName || sale.psid?.substring(0, 12) || '—'}
                  </td>
                  <td style={{ padding: "10px", color: "white", fontSize: "0.85rem", fontWeight: "bold" }}>
                    {sale.productName || sale.conversionData?.itemTitle || '—'}
                  </td>
                  <td style={{ padding: "10px", color: "#4caf50", fontSize: "0.9rem", fontWeight: "bold", textAlign: "right" }}>
                    ${(sale.conversionData?.totalAmount || 0).toLocaleString()}
                  </td>
                  <td style={{ padding: "10px", color: "#888", fontSize: "0.85rem" }}>
                    {sale.campaignId || '—'}
                  </td>
                  <td style={{ padding: "10px", color: "#888", fontSize: "0.8rem", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {sale.conversionData?.manualNotes || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: "1rem",
              marginTop: "1rem",
              padding: "0.75rem"
            }}>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                style={{
                  padding: "8px 16px",
                  backgroundColor: page <= 1 ? "#333" : "#4caf50",
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  cursor: page <= 1 ? "not-allowed" : "pointer",
                  opacity: page <= 1 ? 0.5 : 1,
                  fontSize: "0.9rem"
                }}
              >
                {t('common.previous')}
              </button>
              <span style={{ color: "#ccc", fontSize: "0.9rem" }}>
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                style={{
                  padding: "8px 16px",
                  backgroundColor: page >= totalPages ? "#333" : "#4caf50",
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  cursor: page >= totalPages ? "not-allowed" : "pointer",
                  opacity: page >= totalPages ? 0.5 : 1,
                  fontSize: "0.9rem"
                }}
              >
                {t('common.next')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default ManualSalesView;
