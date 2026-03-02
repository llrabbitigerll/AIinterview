import React, { useState } from 'react';
import { App as AntApp, ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import PreparePage from './pages/PreparePage';
import InterviewPage from './pages/InterviewPage';
import ReportPage from './pages/ReportPage';
import SettingsPage from './pages/SettingsPage';
import { useInterviewStore } from './stores/interviewStore';

type AppPage = 'prepare' | 'interview' | 'report';

const App: React.FC = () => {
  const phase = useInterviewStore((s) => s.phase);
  const appView = useInterviewStore((s) => s.appView);

  const currentPage: AppPage =
    phase === 'completed' ? 'report' :
    phase === 'idle' ? 'prepare' :
    'interview';

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#2563eb',
          borderRadius: 8,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif',
        },
      }}
    >
      <AntApp>
        <div className="app-container">
          {appView === 'settings' && <SettingsPage />}
          {appView === 'main' && currentPage === 'prepare' && <PreparePage />}
          {appView === 'main' && currentPage === 'interview' && <InterviewPage />}
          {appView === 'main' && currentPage === 'report' && <ReportPage />}
        </div>
      </AntApp>
    </ConfigProvider>
  );
};

export default App;
