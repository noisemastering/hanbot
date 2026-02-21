import React from "react";
import StatsCard from "../components/StatsCard";
import { useTranslation } from "../i18n";

function Home() {
  const { t } = useTranslation();
  return (
    <div>
      <h2>{t('overview.todayStats')}</h2>
      <div style={{ display: "flex", gap: "2rem", marginTop: "2rem" }}>
        <StatsCard title={t('overview.totalMessages')} value="—" />
        <StatsCard title={t('overview.uniqueUsers')} value="—" />
        <StatsCard title={t('overview.responseRate')} value="—" />
      </div>
      <p style={{ marginTop: "3rem", color: "#aaa" }}>
        {t('overview.loadingMessages')}
      </p>
    </div>
  );
}

export default Home;
